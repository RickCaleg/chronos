use crate::csvio::{self, ENTRIES_CSV_HEADER};
use crate::model::{Project, TimeEntry};
use crate::pasteparse::{match_project_by_alias, parse_pasted_entry};
use crate::timefmt;
use crate::{Command, ExportFormat, ImportFormat, ProjectsCommand};
use anyhow::{anyhow, bail, Context, Result};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::io::Write;
use std::path::Path;

const PALETTE: [&str; 8] = [
    "#6366f1", "#ec4899", "#f59e0b", "#10b981", "#0ea5e9", "#8b5cf6", "#ef4444", "#14b8a6",
];

pub fn run(conn: &Connection, command: Command) -> Result<()> {
    match command {
        Command::Start { description, task, project, at } => cmd_start(conn, description, task, project, at),
        Command::Stop => cmd_stop(conn),
        Command::Status { json } => cmd_status(conn, json),
        Command::List { today, yesterday, date, from, to, project, json } => {
            cmd_list(conn, today, yesterday, date, from, to, project, json)
        }
        Command::Add { description, start, end, task, project } => cmd_add(conn, description, start, end, task, project),
        Command::Edit { id, description, task, project, start, end, duration } => {
            cmd_edit(conn, id, description, task, project, start, end, duration)
        }
        Command::Delete { id, yes } => cmd_delete(conn, id, yes),
        Command::Projects { action } => cmd_projects(conn, action),
        Command::Export { format, output } => cmd_export(conn, format, output),
        Command::Import { format, input, yes } => cmd_import(conn, format, input, yes),
        Command::Reset { yes } => cmd_reset(conn, yes),
        Command::DbPath => {
            println!("{}", conn.path().unwrap_or("(in-memory)"));
            Ok(())
        }
    }
}

// ---------- shared helpers ----------

fn list_projects(conn: &Connection, include_archived: bool) -> Result<Vec<Project>> {
    let sql = if include_archived {
        "SELECT * FROM projects ORDER BY archived ASC, name COLLATE NOCASE ASC"
    } else {
        "SELECT * FROM projects WHERE archived = 0 ORDER BY name COLLATE NOCASE ASC"
    };
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], Project::from_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn resolve_project(conn: &Connection, needle: &str) -> Result<Project> {
    let all = list_projects(conn, true)?;
    let needle_lower = needle.to_lowercase();
    let matches: Vec<&Project> = all
        .iter()
        .filter(|p| {
            p.id == needle
                || p.name.to_lowercase() == needle_lower
                || p.alias.as_deref().map(|a| a.to_lowercase()) == Some(needle_lower.clone())
        })
        .collect();
    match matches.len() {
        1 => Ok(matches[0].clone()),
        0 => Err(anyhow!("no project matches \"{needle}\" (by id, name, or code)")),
        _ => Err(anyhow!("\"{needle}\" matches more than one project; use its exact id")),
    }
}

fn get_running_entry(conn: &Connection) -> Result<Option<TimeEntry>> {
    let mut stmt = conn.prepare("SELECT * FROM time_entries WHERE is_running = 1 LIMIT 1")?;
    let mut rows = stmt.query_map([], TimeEntry::from_row)?;
    Ok(rows.next().transpose()?)
}

/// Resolves an entry by its full id or by any unique prefix of it (the way
/// `chronos-cli list` prints ids, and the way `git` resolves short hashes).
fn get_entry(conn: &Connection, id_prefix: &str) -> Result<TimeEntry> {
    let mut stmt = conn.prepare("SELECT * FROM time_entries WHERE id LIKE ?1 || '%'")?;
    let rows = stmt.query_map(params![id_prefix], TimeEntry::from_row)?;
    let matches: Vec<TimeEntry> = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    match matches.len() {
        1 => Ok(matches.into_iter().next().unwrap()),
        0 => Err(anyhow!("no entry with id \"{id_prefix}\"")),
        _ => Err(anyhow!("\"{id_prefix}\" matches more than one entry; use more characters")),
    }
}

fn confirm(prompt: &str) -> Result<bool> {
    print!("{prompt} [y/N] ");
    std::io::stdout().flush()?;
    let mut input = String::new();
    std::io::stdin().read_line(&mut input)?;
    Ok(matches!(input.trim().to_lowercase().as_str(), "y" | "yes"))
}

fn require_confirm(yes: bool, prompt: &str) -> Result<()> {
    if !yes && !confirm(prompt)? {
        bail!("aborted");
    }
    Ok(())
}

fn print_json<T: Serialize>(value: &T) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}

// ---------- timer ----------

fn cmd_start(conn: &Connection, description: String, task: Option<String>, project: Option<String>, at: String) -> Result<()> {
    if get_running_entry(conn)?.is_some() {
        bail!("a timer is already running; run `chronos-cli stop` first");
    }

    let project_id = match project {
        Some(p) => Some(resolve_project(conn, &p)?.id),
        None => None,
    };
    let start_time = timefmt::to_iso(timefmt::parse_datetime(&at)?);
    let id = uuid::Uuid::new_v4().to_string();
    let now = timefmt::now_iso();

    conn.execute(
        "INSERT INTO time_entries
            (id, description, task_number, project_id, start_time, end_time, duration_seconds, is_running, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, 1, ?6, ?6)",
        params![id, description, task, project_id, start_time, now],
    )?;

    println!("Started \"{description}\" at {}", timefmt::format_local(&start_time));
    Ok(())
}

fn cmd_stop(conn: &Connection) -> Result<()> {
    let running = get_running_entry(conn)?.ok_or_else(|| anyhow!("no timer is running"))?;
    let end_time = timefmt::now_iso();
    let duration = timefmt::duration_between(&running.start_time, &end_time)?;

    conn.execute(
        "UPDATE time_entries SET end_time = ?1, duration_seconds = ?2, is_running = 0, updated_at = ?3 WHERE id = ?4",
        params![end_time, duration, timefmt::now_iso(), running.id],
    )?;

    println!(
        "Stopped \"{}\" — {}",
        running.description,
        timefmt::format_duration_human(duration)
    );
    Ok(())
}

#[derive(Serialize)]
struct StatusOutput {
    running: bool,
    entry: Option<TimeEntry>,
    #[serde(rename = "elapsedSeconds")]
    elapsed_seconds: Option<i64>,
}

fn cmd_status(conn: &Connection, json: bool) -> Result<()> {
    let running = get_running_entry(conn)?;
    let elapsed = running
        .as_ref()
        .map(|e| timefmt::duration_between(&e.start_time, &timefmt::now_iso()))
        .transpose()?;

    if json {
        return print_json(&StatusOutput { running: running.is_some(), entry: running, elapsed_seconds: elapsed });
    }

    match (running, elapsed) {
        (Some(entry), Some(elapsed)) => {
            let project = match &entry.project_id {
                Some(id) => list_projects(conn, true)?.into_iter().find(|p| &p.id == id).map(|p| p.label()),
                None => None,
            };
            println!(
                "Running: {}{} — {} ({})",
                entry.task_number.as_deref().map(|t| format!("{t} ")).unwrap_or_default(),
                entry.description,
                timefmt::format_duration_hms(elapsed),
                project.unwrap_or_else(|| "no project".to_string())
            );
        }
        _ => println!("No timer running."),
    }
    Ok(())
}

// ---------- entries ----------

#[allow(clippy::too_many_arguments)]
fn cmd_list(
    conn: &Connection,
    today: bool,
    yesterday: bool,
    date: Option<String>,
    from: Option<String>,
    to: Option<String>,
    project: Option<String>,
    json: bool,
) -> Result<()> {
    let (range_start, range_end) = if let (Some(from), Some(to)) = (&from, &to) {
        (timefmt::to_iso(timefmt::parse_datetime(from)?), timefmt::to_iso(timefmt::parse_datetime(to)?))
    } else if let Some(date) = &date {
        let day = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").context("--date must be yyyy-MM-dd")?;
        timefmt::local_day_range_utc(day)?
    } else if yesterday {
        timefmt::local_day_range_utc(timefmt::today_local() - chrono::Duration::days(1))?
    } else {
        // today is the default when nothing else is specified
        let _ = today;
        timefmt::local_day_range_utc(timefmt::today_local())?
    };

    let project_filter = project.map(|p| resolve_project(conn, &p)).transpose()?;

    let mut sql = "SELECT * FROM time_entries WHERE start_time >= ?1 AND start_time < ?2".to_string();
    let mut query_params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(range_start), Box::new(range_end)];
    if let Some(p) = &project_filter {
        sql.push_str(" AND project_id = ?3");
        query_params.push(Box::new(p.id.clone()));
    }
    sql.push_str(" ORDER BY start_time ASC");

    let mut stmt = conn.prepare(&sql)?;
    let param_refs: Vec<&dyn rusqlite::ToSql> = query_params.iter().map(|b| b.as_ref()).collect();
    let entries: Vec<TimeEntry> = stmt.query_map(param_refs.as_slice(), TimeEntry::from_row)?.collect::<rusqlite::Result<_>>()?;

    if json {
        return print_json(&entries);
    }

    if entries.is_empty() {
        println!("No entries.");
        return Ok(());
    }

    let projects = list_projects(conn, true)?;
    let project_label = |id: &Option<String>| -> String {
        id.as_ref()
            .and_then(|id| projects.iter().find(|p| &p.id == id))
            .map(|p| p.label())
            .unwrap_or_else(|| "-".to_string())
    };

    let mut total = 0i64;
    for e in &entries {
        let duration = e.duration_seconds.unwrap_or(0);
        total += duration;
        let task = e.task_number.clone().unwrap_or_default();
        println!(
            "{:<8}  {:<38}  {:<10}  {:<20}  {:>10}  {}",
            e.id.chars().take(8).collect::<String>(),
            truncate(&e.description, 38),
            task,
            project_label(&e.project_id),
            timefmt::format_duration_human(duration),
            timefmt::format_local(&e.start_time),
        );
    }
    println!("\nTotal: {}", timefmt::format_duration_human(total));
    Ok(())
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(max.saturating_sub(1)).collect::<String>())
    }
}

fn cmd_add(conn: &Connection, description: String, start: String, end: String, task: Option<String>, project: Option<String>) -> Result<()> {
    let start_iso = timefmt::to_iso(timefmt::parse_datetime(&start)?);
    let end_iso = timefmt::to_iso(timefmt::parse_datetime(&end)?);
    if end_iso <= start_iso {
        bail!("end must be after start");
    }
    let duration = timefmt::duration_between(&start_iso, &end_iso)?;
    let project_id = match project {
        Some(p) => Some(resolve_project(conn, &p)?.id),
        None => None,
    };
    let id = uuid::Uuid::new_v4().to_string();
    let now = timefmt::now_iso();

    conn.execute(
        "INSERT INTO time_entries
            (id, description, task_number, project_id, start_time, end_time, duration_seconds, is_running, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?8)",
        params![id, description, task, project_id, start_iso, end_iso, duration, now],
    )?;

    println!("Added entry {id} ({})", timefmt::format_duration_human(duration));
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn cmd_edit(
    conn: &Connection,
    id: String,
    description: Option<String>,
    task: Option<String>,
    project: Option<String>,
    start: Option<String>,
    end: Option<String>,
    duration: Option<String>,
) -> Result<()> {
    if duration.is_some() && end.is_some() {
        bail!("pass either --end or --duration, not both");
    }

    let entry = get_entry(conn, &id)?;
    if entry.is_running && (start.is_some() || end.is_some() || duration.is_some()) {
        bail!("this entry is still running; stop it first, or only edit --description/--task/--project");
    }

    let mut new_start = entry.start_time.clone();
    let mut new_end = entry.end_time.clone();

    if let Some(start) = &start {
        new_start = timefmt::to_iso(timefmt::parse_datetime(start)?);
    }
    if let Some(end) = &end {
        new_end = Some(timefmt::to_iso(timefmt::parse_datetime(end)?));
    }
    if let Some(duration_text) = &duration {
        let seconds = timefmt::parse_duration_input(duration_text)?;
        new_end = Some(timefmt::add_seconds(&new_start, seconds)?);
    }

    let new_end = new_end.ok_or_else(|| anyhow!("entry has no end time"))?;
    if new_end <= new_start {
        bail!("end must be after start");
    }
    let new_duration = timefmt::duration_between(&new_start, &new_end)?;

    let project_id = match &project {
        Some(p) if p.is_empty() => None,
        Some(p) => Some(resolve_project(conn, p)?.id),
        None => entry.project_id.clone(),
    };

    let entry_id = entry.id.clone();
    conn.execute(
        "UPDATE time_entries SET
            description = ?1, task_number = ?2, project_id = ?3,
            start_time = ?4, end_time = ?5, duration_seconds = ?6, updated_at = ?7
         WHERE id = ?8",
        params![
            description.unwrap_or(entry.description),
            task.or(entry.task_number),
            project_id,
            new_start,
            new_end,
            new_duration,
            timefmt::now_iso(),
            entry_id,
        ],
    )?;

    println!("Updated entry {entry_id}");
    Ok(())
}

fn cmd_delete(conn: &Connection, id: String, yes: bool) -> Result<()> {
    let entry = get_entry(conn, &id)?;
    require_confirm(yes, &format!("Delete \"{}\"?", entry.description))?;
    conn.execute("DELETE FROM time_entries WHERE id = ?1", params![entry.id])?;
    println!("Deleted {}", entry.id);
    Ok(())
}

// ---------- projects ----------

fn cmd_projects(conn: &Connection, action: ProjectsCommand) -> Result<()> {
    match action {
        ProjectsCommand::List { all, json } => {
            let projects = list_projects(conn, all)?;
            if json {
                return print_json(&projects);
            }
            if projects.is_empty() {
                println!("No projects.");
                return Ok(());
            }
            for p in &projects {
                let archived = if p.archived { " (archived)" } else { "" };
                println!("{}  {}{}", p.id, p.label(), archived);
            }
            Ok(())
        }
        ProjectsCommand::Add { name, color, alias } => {
            let color = color.unwrap_or_else(|| PALETTE[list_projects(conn, true).map(|p| p.len()).unwrap_or(0) % PALETTE.len()].to_string());
            let id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO projects (id, name, color, alias, archived, created_at) VALUES (?1, ?2, ?3, ?4, 0, ?5)",
                params![id, name, color, alias, timefmt::now_iso()],
            )?;
            println!("Created project {id} ({name})");
            Ok(())
        }
        ProjectsCommand::Rename { project, new_name } => {
            let p = resolve_project(conn, &project)?;
            conn.execute("UPDATE projects SET name = ?1 WHERE id = ?2", params![new_name, p.id])?;
            println!("Renamed to \"{new_name}\"");
            Ok(())
        }
        ProjectsCommand::Alias { project, alias } => {
            let p = resolve_project(conn, &project)?;
            conn.execute("UPDATE projects SET alias = ?1 WHERE id = ?2", params![alias, p.id])?;
            println!("Set code \"{alias}\" on \"{}\"", p.name);
            Ok(())
        }
        ProjectsCommand::Color { project, color } => {
            let p = resolve_project(conn, &project)?;
            conn.execute("UPDATE projects SET color = ?1 WHERE id = ?2", params![color, p.id])?;
            println!("Set color {color} on \"{}\"", p.name);
            Ok(())
        }
        ProjectsCommand::Archive { project } => set_archived(conn, &project, true),
        ProjectsCommand::Unarchive { project } => set_archived(conn, &project, false),
        ProjectsCommand::Remove { project, yes } => {
            let p = resolve_project(conn, &project)?;
            require_confirm(yes, &format!("Delete project \"{}\"? Its entries will keep it as unassigned.", p.name))?;
            conn.execute("UPDATE time_entries SET project_id = NULL WHERE project_id = ?1", params![p.id])?;
            conn.execute("DELETE FROM projects WHERE id = ?1", params![p.id])?;
            println!("Deleted \"{}\"", p.name);
            Ok(())
        }
    }
}

fn set_archived(conn: &Connection, project: &str, archived: bool) -> Result<()> {
    let p = resolve_project(conn, project)?;
    conn.execute("UPDATE projects SET archived = ?1 WHERE id = ?2", params![archived as i64, p.id])?;
    println!("{} \"{}\"", if archived { "Archived" } else { "Unarchived" }, p.name);
    Ok(())
}

// ---------- data: export / import / reset ----------

#[derive(Serialize, serde::Deserialize)]
struct Backup {
    version: u8,
    #[serde(rename = "exportedAt")]
    exported_at: String,
    projects: Vec<Project>,
    #[serde(rename = "timeEntries")]
    time_entries: Vec<TimeEntry>,
}

fn all_entries(conn: &Connection) -> Result<Vec<TimeEntry>> {
    let mut stmt = conn.prepare("SELECT * FROM time_entries ORDER BY start_time DESC")?;
    let rows = stmt.query_map([], TimeEntry::from_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn write_output(output: Option<&Path>, contents: &str) -> Result<()> {
    match output {
        None => print!("{contents}"),
        Some(path) if path == Path::new("-") => print!("{contents}"),
        Some(path) => {
            std::fs::write(path, contents).with_context(|| format!("failed to write {}", path.display()))?;
            println!("Wrote {}", path.display());
        }
    }
    Ok(())
}

fn cmd_export(conn: &Connection, format: ExportFormat, output: Option<std::path::PathBuf>) -> Result<()> {
    match format {
        ExportFormat::Json => {
            let backup = Backup {
                version: 1,
                exported_at: timefmt::now_iso(),
                projects: list_projects(conn, true)?,
                time_entries: all_entries(conn)?,
            };
            write_output(output.as_deref(), &serde_json::to_string_pretty(&backup)?)
        }
        ExportFormat::Csv => {
            let projects = list_projects(conn, true)?;
            let mut wtr = csv::Writer::from_writer(vec![]);
            wtr.write_record(ENTRIES_CSV_HEADER)?;
            for e in all_entries(conn)?.into_iter().filter(|e| !e.is_running) {
                let project_name = e
                    .project_id
                    .as_ref()
                    .and_then(|id| projects.iter().find(|p| &p.id == id))
                    .map(|p| p.name.clone())
                    .unwrap_or_default();
                let end = e.end_time.clone().unwrap_or_default();
                wtr.write_record([
                    project_name,
                    e.task_number.unwrap_or_default(),
                    e.description,
                    local_date(&e.start_time),
                    local_time(&e.start_time),
                    local_date(&end),
                    local_time(&end),
                    e.duration_seconds.unwrap_or(0).to_string(),
                ])?;
            }
            let csv_text = String::from_utf8(wtr.into_inner()?)?;
            write_output(output.as_deref(), &csv_text)
        }
    }
}

fn local_date(iso: &str) -> String {
    timefmt::format_local(iso).split(' ').next().unwrap_or("").to_string()
}
fn local_time(iso: &str) -> String {
    timefmt::format_local(iso).split(' ').nth(1).unwrap_or("").to_string()
}

fn cmd_import(conn: &Connection, format: ImportFormat, input: std::path::PathBuf, yes: bool) -> Result<()> {
    match format {
        ImportFormat::Json => {
            require_confirm(yes, "Importing a JSON backup replaces ALL current data. Continue?")?;
            let text = std::fs::read_to_string(&input)?;
            let backup: Backup = serde_json::from_str(&text).context("invalid backup file")?;
            replace_all(conn, &backup.projects, &backup.time_entries)?;
            println!("Imported {} projects and {} entries", backup.projects.len(), backup.time_entries.len());
            Ok(())
        }
        ImportFormat::Csv => import_csv(conn, &input, false),
        ImportFormat::Clockify => import_csv(conn, &input, true),
    }
}

fn replace_all(conn: &Connection, projects: &[Project], entries: &[TimeEntry]) -> Result<()> {
    conn.execute("DELETE FROM time_entries", [])?;
    conn.execute("DELETE FROM projects", [])?;
    for p in projects {
        conn.execute(
            "INSERT INTO projects (id, name, color, alias, archived, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![p.id, p.name, p.color, p.alias, p.archived as i64, p.created_at],
        )?;
    }
    for e in entries {
        conn.execute(
            "INSERT INTO time_entries
                (id, description, task_number, project_id, start_time, end_time, duration_seconds, is_running, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                e.id, e.description, e.task_number, e.project_id, e.start_time, e.end_time,
                e.duration_seconds, e.is_running as i64, e.created_at, e.updated_at,
            ],
        )?;
    }
    Ok(())
}

fn find_or_create_project(conn: &Connection, projects: &mut Vec<Project>, name: &str) -> Result<String> {
    if let Some(p) = projects.iter().find(|p| p.name.to_lowercase() == name.to_lowercase()) {
        return Ok(p.id.clone());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let color = PALETTE[projects.len() % PALETTE.len()].to_string();
    let now = timefmt::now_iso();
    conn.execute(
        "INSERT INTO projects (id, name, color, alias, archived, created_at) VALUES (?1, ?2, ?3, NULL, 0, ?4)",
        params![id, name, color, now],
    )?;
    projects.push(Project { id: id.clone(), name: name.to_string(), color, alias: None, archived: false, created_at: now });
    Ok(id)
}

fn import_csv(conn: &Connection, path: &std::path::Path, clockify: bool) -> Result<()> {
    let rows = csvio::read_rows(path)?;
    let mut projects = list_projects(conn, true)?;
    let mut imported = 0u32;

    for row in rows {
        let (start_iso, end_iso) = if clockify {
            let sd = csvio::get(&row, "data de início");
            let st = csvio::get(&row, "hora de início");
            let ed = csvio::get(&row, "data de término").or(sd);
            let et = csvio::get(&row, "hora de término");
            match (sd, st, ed, et) {
                (Some(sd), Some(st), Some(ed), Some(et)) => {
                    (parse_br_datetime(sd, st), parse_br_datetime(ed, et))
                }
                _ => continue,
            }
        } else {
            let sd = csvio::get(&row, "start date");
            let st = csvio::get(&row, "start time");
            let ed = csvio::get(&row, "end date").or(sd);
            let et = csvio::get(&row, "end time");
            match (sd, st, ed, et) {
                (Some(sd), Some(st), Some(ed), Some(et)) => (
                    timefmt::parse_datetime(&format!("{sd} {st}")).ok().map(timefmt::to_iso),
                    timefmt::parse_datetime(&format!("{ed} {et}")).ok().map(timefmt::to_iso),
                ),
                _ => continue,
            }
        };

        let (Some(start_iso), Some(end_iso)) = (start_iso, end_iso) else { continue };
        if end_iso <= start_iso {
            continue;
        }

        let project_name = csvio::get(&row, if clockify { "projeto" } else { "project" });
        let mut project_id = match project_name {
            Some(name) => Some(find_or_create_project(conn, &mut projects, name)?),
            None => None,
        };

        let raw_task = csvio::get(&row, if clockify { "tarefa" } else { "task" }).map(str::to_string);
        let raw_description = csvio::get(&row, if clockify { "descrição" } else { "description" }).unwrap_or("").to_string();

        let (task_number, description) = match &raw_task {
            Some(t) => (Some(t.clone()), raw_description),
            None => match parse_pasted_entry(&raw_description) {
                Some(parsed) => {
                    if project_id.is_none() {
                        if let Some(alias) = &parsed.alias_token {
                            if let Some(matched) = match_project_by_alias(alias, &projects) {
                                project_id = Some(matched.id.clone());
                            }
                        }
                    }
                    (Some(parsed.task_number), parsed.description)
                }
                None => (None, raw_description),
            },
        };

        // Persist a freshly-learned alias onto the resolved project, same as the desktop importer.
        if let (Some(pid), Some(parsed_alias)) = (&project_id, extract_alias_if_new(&raw_task, &row, clockify)) {
            if let Some(p) = projects.iter_mut().find(|p| &p.id == pid) {
                if p.alias.is_none() {
                    conn.execute("UPDATE projects SET alias = ?1 WHERE id = ?2", params![parsed_alias, pid])?;
                    p.alias = Some(parsed_alias);
                }
            }
        }

        let duration = timefmt::duration_between(&start_iso, &end_iso)?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = timefmt::now_iso();
        conn.execute(
            "INSERT INTO time_entries
                (id, description, task_number, project_id, start_time, end_time, duration_seconds, is_running, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?8)",
            params![id, description, task_number, project_id, start_iso, end_iso, duration, now],
        )?;
        imported += 1;
    }

    println!("Imported {imported} entries");
    Ok(())
}

fn extract_alias_if_new(raw_task: &Option<String>, row: &std::collections::HashMap<String, String>, clockify: bool) -> Option<String> {
    if raw_task.is_some() {
        return None;
    }
    let description = csvio::get(row, if clockify { "descrição" } else { "description" })?;
    parse_pasted_entry(description)?.alias_token
}

fn parse_br_datetime(date: &str, time: &str) -> Option<String> {
    let dm = date.trim();
    let parts: Vec<&str> = dm.split('/').collect();
    if parts.len() != 3 {
        return None;
    }
    let iso_date = format!("{}-{:0>2}-{:0>2}", parts[2], parts[1], parts[0]);
    timefmt::parse_datetime(&format!("{iso_date} {}", time.trim())).ok().map(timefmt::to_iso)
}

fn cmd_reset(conn: &Connection, yes: bool) -> Result<()> {
    require_confirm(yes, "Delete ALL projects and time entries? This cannot be undone.")?;
    conn.execute("DELETE FROM time_entries", [])?;
    conn.execute("DELETE FROM projects", [])?;
    println!("All data erased");
    Ok(())
}
