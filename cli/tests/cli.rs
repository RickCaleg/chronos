use std::io::Write;
use std::process::{Command, Output, Stdio};

/// A throwaway database for one test, cleaned up on drop.
struct TestDb {
    _dir: tempfile::TempDir,
    path: std::path::PathBuf,
}

impl TestDb {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("chronos-test.db");
        TestDb { _dir: dir, path }
    }

    fn run(&self, args: &[&str]) -> Output {
        self.run_with_stdin(args, None)
    }

    fn run_with_stdin(&self, args: &[&str], stdin: Option<&str>) -> Output {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_chronos-cli"));
        cmd.env("CHRONOS_DB_PATH", &self.path).args(args);

        if let Some(input) = stdin {
            cmd.stdin(Stdio::piped());
            cmd.stdout(Stdio::piped());
            cmd.stderr(Stdio::piped());
            let mut child = cmd.spawn().unwrap();
            child.stdin.take().unwrap().write_all(input.as_bytes()).unwrap();
            child.wait_with_output().unwrap()
        } else {
            cmd.output().unwrap()
        }
    }

    fn ok(&self, args: &[&str]) -> String {
        let out = self.run(args);
        assert!(
            out.status.success(),
            "command {:?} failed: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8(out.stdout).unwrap()
    }

    fn list_json(&self) -> serde_json::Value {
        let stdout = self.ok(&["list", "--from", "2000-01-01", "--to", "2100-01-01", "--json"]);
        serde_json::from_str(&stdout).unwrap()
    }
}

#[test]
fn start_and_stop_creates_a_completed_entry() {
    let db = TestDb::new();
    db.ok(&["start", "Write tests", "--task", "#1"]);
    db.ok(&["stop"]);

    let entries = db.list_json();
    let entries = entries.as_array().unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["description"], "Write tests");
    assert_eq!(entries[0]["taskNumber"], "#1");
    assert_eq!(entries[0]["isRunning"], false);
    assert!(entries[0]["endTime"].is_string());
}

#[test]
fn starting_twice_fails() {
    let db = TestDb::new();
    db.ok(&["start", "First"]);
    let second = db.run(&["start", "Second"]);
    assert!(!second.status.success());
}

#[test]
fn stopping_with_nothing_running_fails() {
    let db = TestDb::new();
    let out = db.run(&["stop"]);
    assert!(!out.status.success());
}

#[test]
fn status_reports_the_running_entry() {
    let db = TestDb::new();
    db.ok(&["start", "Focus work"]);

    let status: serde_json::Value = serde_json::from_str(&db.ok(&["status", "--json"])).unwrap();
    assert_eq!(status["running"], true);
    assert_eq!(status["entry"]["description"], "Focus work");
}

#[test]
fn edit_resolves_a_short_id_prefix_and_actually_updates_the_row() {
    let db = TestDb::new();
    db.ok(&["add", "Original", "--start", "09:00", "--end", "10:00"]);

    let entries = db.list_json();
    let full_id = entries[0]["id"].as_str().unwrap().to_string();
    let short_id = &full_id[..8];

    db.ok(&["edit", short_id, "--description", "Renamed"]);

    let entries = db.list_json();
    assert_eq!(entries.as_array().unwrap().len(), 1, "edit must not create a duplicate row");
    assert_eq!(entries[0]["id"], full_id);
    assert_eq!(entries[0]["description"], "Renamed");
}

#[test]
fn delete_resolves_a_short_id_prefix_and_actually_removes_the_row() {
    let db = TestDb::new();
    db.ok(&["add", "To delete", "--start", "09:00", "--end", "10:00"]);

    let entries = db.list_json();
    let short_id = &entries[0]["id"].as_str().unwrap()[..8];

    db.ok(&["delete", short_id, "--yes"]);

    let entries = db.list_json();
    assert_eq!(entries.as_array().unwrap().len(), 0);
}

#[test]
fn edit_duration_keeps_start_fixed_and_recomputes_end() {
    let db = TestDb::new();
    db.ok(&["add", "Task", "--start", "09:00", "--end", "09:15"]);
    let id = db.list_json()[0]["id"].as_str().unwrap().to_string();

    db.ok(&["edit", &id, "--duration", "0:30:00"]);

    let entries = db.list_json();
    assert_eq!(entries[0]["durationSeconds"], 1800);
}

#[test]
fn edit_rejects_end_and_duration_together() {
    let db = TestDb::new();
    db.ok(&["add", "Task", "--start", "09:00", "--end", "09:15"]);
    let id = db.list_json()[0]["id"].as_str().unwrap().to_string();

    let out = db.run(&["edit", &id, "--end", "10:00", "--duration", "0:30:00"]);
    assert!(!out.status.success());
}

#[test]
fn project_alias_is_shown_before_the_name_and_resolves_by_code() {
    let db = TestDb::new();
    db.ok(&["projects", "add", "Website Redesign", "--alias", "WEB"]);
    db.ok(&["add", "Fix bug", "--start", "09:00", "--end", "10:00", "--project", "WEB"]);

    let projects: serde_json::Value = serde_json::from_str(&db.ok(&["projects", "list", "--json"])).unwrap();
    assert_eq!(projects[0]["alias"], "WEB");

    let entries = db.list_json();
    assert_eq!(entries[0]["projectId"], projects[0]["id"]);
}

#[test]
fn reset_without_yes_and_declined_confirmation_keeps_data() {
    let db = TestDb::new();
    db.ok(&["add", "Keep me", "--start", "09:00", "--end", "10:00"]);

    let out = db.run_with_stdin(&["reset"], Some("n\n"));
    assert!(!out.status.success());

    assert_eq!(db.list_json().as_array().unwrap().len(), 1);
}

#[test]
fn reset_with_yes_erases_everything() {
    let db = TestDb::new();
    db.ok(&["projects", "add", "Demo"]);
    db.ok(&["add", "Entry", "--start", "09:00", "--end", "10:00"]);

    db.ok(&["reset", "--yes"]);

    assert_eq!(db.list_json().as_array().unwrap().len(), 0);
    let projects: serde_json::Value = serde_json::from_str(&db.ok(&["projects", "list", "--all", "--json"])).unwrap();
    assert_eq!(projects.as_array().unwrap().len(), 0);
}

#[test]
fn clockify_import_splits_embedded_task_and_learns_the_project_alias() {
    let db = TestDb::new();
    let mut csv_file = tempfile::NamedTempFile::new().unwrap();
    writeln!(
        csv_file,
        "\"Projeto\",\"Descrição\",\"Tarefa\",\"Data de início\",\"Hora de início\",\"Data de término\",\"Hora de término\"\n\
         \"Circle\",\"#123 - MRK - Fix the thing\",\"\",\"16/09/2026\",\"09:00:00\",\"16/09/2026\",\"09:30:00\""
    )
    .unwrap();

    db.ok(&["import", "--format", "clockify", csv_file.path().to_str().unwrap()]);

    let entries = db.list_json();
    assert_eq!(entries[0]["taskNumber"], "#123");
    assert_eq!(entries[0]["description"], "Fix the thing");

    let projects: serde_json::Value = serde_json::from_str(&db.ok(&["projects", "list", "--json"])).unwrap();
    assert_eq!(projects[0]["alias"], "MRK");
}

fn first_id(db: &TestDb) -> String {
    db.list_json()[0]["id"].as_str().unwrap().to_string()
}

fn tag_names(entry: &serde_json::Value) -> Vec<String> {
    entry["tags"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_string()).collect()
}

#[test]
fn add_with_tags_and_note_shows_them_in_list() {
    let db = TestDb::new();
    db.ok(&["add", "Review", "--start", "09:00", "--end", "10:00", "--tags", "meeting, Billable,meeting", "--note", "Went over the PR"]);

    let entries = db.list_json();
    assert_eq!(tag_names(&entries[0]), vec!["Billable", "meeting"]);
    assert_eq!(entries[0]["note"], "Went over the PR");

    let table = db.ok(&["list", "--from", "2000-01-01", "--to", "2100-01-01"]);
    assert!(table.contains("[Billable, meeting]"), "{table}");
    assert!(table.contains("Went over the PR"), "{table}");
}

#[test]
fn edit_replaces_tags_and_empty_strings_clear_tags_and_note() {
    let db = TestDb::new();
    db.ok(&["add", "Task", "--start", "09:00", "--end", "10:00", "--tags", "a,b", "--note", "x"]);
    let id = first_id(&db);

    db.ok(&["edit", &id, "--tags", "c"]);
    assert_eq!(tag_names(&db.list_json()[0]), vec!["c"]);

    db.ok(&["edit", &id, "--tags", "", "--note", ""]);
    let entry = &db.list_json()[0];
    assert!(entry["tags"].as_array().unwrap().is_empty());
    assert!(entry["note"].is_null());
}

#[test]
fn list_filters_by_tag() {
    let db = TestDb::new();
    db.ok(&["add", "Tagged", "--start", "09:00", "--end", "10:00", "--tags", "client"]);
    db.ok(&["add", "Untagged", "--start", "10:00", "--end", "11:00"]);

    let out = db.ok(&["list", "--from", "2000-01-01", "--to", "2100-01-01", "--tag", "CLIENT", "--json"]);
    let entries: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(entries.as_array().unwrap().len(), 1);
    assert_eq!(entries[0]["description"], "Tagged");
}

#[test]
fn tags_can_be_added_renamed_and_removed() {
    let db = TestDb::new();
    db.ok(&["tags", "add", "urgent"]);
    db.ok(&["add", "Task", "--start", "09:00", "--end", "10:00", "--tags", "Urgent"]);
    let tags: serde_json::Value = serde_json::from_str(&db.ok(&["tags", "list", "--json"])).unwrap();
    assert_eq!(tags.as_array().unwrap().len(), 1, "same name in another case reuses the tag");

    db.ok(&["tags", "rename", "urgent", "asap"]);
    assert_eq!(tag_names(&db.list_json()[0]), vec!["asap"]);

    db.ok(&["tags", "remove", "asap", "--yes"]);
    assert!(db.list_json()[0]["tags"].as_array().unwrap().is_empty());
    assert!(db.ok(&["tags", "list"]).contains("No tags."));
}

#[test]
fn json_backup_round_trip_keeps_tags_notes_and_proofhub_state() {
    let db = TestDb::new();
    let backup = r##"{
      "version": 1, "exportedAt": "2026-09-21T12:00:00.000Z",
      "projects": [],
      "tags": [{"id": "t1", "name": "client", "createdAt": "2026-09-01T00:00:00.000Z"}],
      "timeEntries": [{
        "id": "e1", "description": "Sent", "taskNumber": "#7", "projectId": null,
        "startTime": "2026-09-20T12:00:00.000Z", "endTime": "2026-09-20T13:00:00.000Z",
        "durationSeconds": 3600, "isRunning": false,
        "createdAt": "2026-09-20T12:00:00.000Z", "updatedAt": "2026-09-20T13:00:00.000Z",
        "tags": [{"id": "t1", "name": "client", "createdAt": "2026-09-01T00:00:00.000Z"}],
        "proofhubTimeEntryId": "1/2/3", "proofhubSyncedAt": "2026-09-20T14:00:00.000Z",
        "note": "Did the thing"
      }]
    }"##;
    let file = db._dir.path().join("in.json");
    std::fs::write(&file, backup).unwrap();
    db.ok(&["import", "--format", "json", file.to_str().unwrap(), "--yes"]);

    let exported = db._dir.path().join("out.json");
    db.ok(&["export", "--output", exported.to_str().unwrap()]);
    db.ok(&["reset", "--yes"]);
    db.ok(&["import", "--format", "json", exported.to_str().unwrap(), "--yes"]);

    let entry = &db.list_json()[0];
    assert_eq!(tag_names(entry), vec!["client"]);
    assert_eq!(entry["note"], "Did the thing");
    assert_eq!(entry["proofhubTimeEntryId"], "1/2/3");
    assert_eq!(entry["proofhubSyncedAt"], "2026-09-20T14:00:00.000Z");
}

#[test]
fn importing_a_backup_without_a_tag_list_rebuilds_it_from_the_entries() {
    let db = TestDb::new();
    let backup = r##"{
      "version": 1, "exportedAt": "2026-09-21T12:00:00.000Z", "projects": [],
      "timeEntries": [{
        "id": "e1", "description": "Old auto backup", "taskNumber": null, "projectId": null,
        "startTime": "2026-09-20T12:00:00.000Z", "endTime": "2026-09-20T13:00:00.000Z",
        "durationSeconds": 3600, "isRunning": false,
        "createdAt": "2026-09-20T12:00:00.000Z", "updatedAt": "2026-09-20T13:00:00.000Z",
        "tags": [{"id": "t9", "name": "internal", "createdAt": "2026-09-01T00:00:00.000Z"}]
      }]
    }"##;
    let file = db._dir.path().join("auto.json");
    std::fs::write(&file, backup).unwrap();
    db.ok(&["import", "--format", "json", file.to_str().unwrap(), "--yes"]);

    assert_eq!(tag_names(&db.list_json()[0]), vec!["internal"]);
    assert!(db.ok(&["tags", "list"]).contains("internal"));
}

#[test]
fn editing_content_unsyncs_from_proofhub_but_tags_do_not() {
    let db = TestDb::new();
    let backup = r##"{"version": 1, "exportedAt": "2026-09-21T12:00:00.000Z", "projects": [], "timeEntries": [
      {"id": "e1", "description": "A", "taskNumber": null, "projectId": null,
       "startTime": "2026-09-20T12:00:00.000Z", "endTime": "2026-09-20T13:00:00.000Z", "durationSeconds": 3600,
       "isRunning": false, "createdAt": "2026-09-20T12:00:00.000Z", "updatedAt": "2026-09-20T13:00:00.000Z",
       "proofhubTimeEntryId": "1/2/3", "proofhubSyncedAt": "2026-09-20T14:00:00.000Z"},
      {"id": "e2", "description": "B", "taskNumber": null, "projectId": null,
       "startTime": "2026-09-20T14:00:00.000Z", "endTime": "2026-09-20T15:00:00.000Z", "durationSeconds": 3600,
       "isRunning": false, "createdAt": "2026-09-20T14:00:00.000Z", "updatedAt": "2026-09-20T15:00:00.000Z",
       "proofhubTimeEntryId": "1/2/3", "proofhubSyncedAt": "2026-09-20T14:00:00.000Z"}
    ]}"##;
    let file = db._dir.path().join("in.json");
    std::fs::write(&file, backup).unwrap();
    db.ok(&["import", "--format", "json", file.to_str().unwrap(), "--yes"]);

    db.ok(&["edit", "e1", "--tags", "x"]);
    assert!(db.list_json()[0]["proofhubSyncedAt"].is_string(), "tags aren't sent to ProofHub");

    db.ok(&["edit", "e1", "--note", "details"]);
    assert!(db.list_json()[0]["proofhubSyncedAt"].is_null());

    // Deleting e1 leaves e2 alone in the ProofHub entry they shared: resend it.
    db.ok(&["delete", "e1", "--yes"]);
    let entries = db.list_json();
    assert_eq!(entries[0]["id"], "e2");
    assert!(entries[0]["proofhubSyncedAt"].is_null());
}

#[test]
fn restart_stops_the_running_entry_and_copies_the_fields() {
    let db = TestDb::new();
    db.ok(&["projects", "add", "Acme", "--alias", "ACM"]);
    db.ok(&["add", "Old work", "--start", "09:00", "--end", "10:00", "--task", "#5", "--project", "ACM"]);
    let old_id = first_id(&db);
    db.ok(&["start", "Something else"]);

    db.ok(&["restart", &old_id[..8]]);

    let status: serde_json::Value = serde_json::from_str(&db.ok(&["status", "--json"])).unwrap();
    assert_eq!(status["entry"]["description"], "Old work");
    assert_eq!(status["entry"]["taskNumber"], "#5");
    assert!(status["entry"]["projectId"].is_string());
    let entries = db.list_json();
    let stopped = entries.as_array().unwrap().iter().find(|e| e["description"] == "Something else").unwrap();
    assert_eq!(stopped["isRunning"], false);
}

#[test]
fn a_running_entry_can_have_its_start_moved_but_not_an_end() {
    let db = TestDb::new();
    db.ok(&["start", "Running", "--at", "2026-01-01 08:00"]);
    let id = first_id(&db);

    db.ok(&["edit", &id, "--start", "2026-01-01 07:30"]);
    let status: serde_json::Value = serde_json::from_str(&db.ok(&["status", "--json"])).unwrap();
    assert!(status["entry"]["startTime"].as_str().unwrap().starts_with("2026-01-01"));
    assert_eq!(status["running"], true);

    assert!(!db.run(&["edit", &id, "--end", "2026-01-01 09:00"]).status.success());
    assert!(!db.run(&["edit", &id, "--start", "2999-01-01 09:00"]).status.success());
}

#[test]
fn reset_also_removes_tags() {
    let db = TestDb::new();
    db.ok(&["add", "Task", "--start", "09:00", "--end", "10:00", "--tags", "a"]);
    db.ok(&["reset", "--yes"]);
    assert!(db.ok(&["tags", "list"]).contains("No tags."));
}

#[test]
fn summary_prints_the_copy_day_text() {
    let db = TestDb::new();
    db.ok(&["projects", "add", "Acme", "--alias", "ACM"]);
    db.ok(&["add", "Fix login", "--start", "2026-03-04 09:00", "--end", "2026-03-04 10:00", "--task", "#12", "--project", "ACM"]);
    db.ok(&["add", "Fix login", "--start", "2026-03-04 11:00", "--end", "2026-03-04 12:00", "--task", "#12", "--project", "ACM"]);
    db.ok(&["add", "Standup", "--start", "2026-03-04 12:00", "--end", "2026-03-04 12:15"]);

    let out = db.ok(&["list", "--date", "2026-03-04", "--summary"]);
    assert_eq!(out.trim_end(), "04/03\n - Standup\n - #12 - ACM - Fix login");
}

#[test]
fn csv_export_and_import_carry_the_note() {
    let db = TestDb::new();
    db.ok(&["add", "Task", "--start", "2026-03-04 09:00", "--end", "2026-03-04 10:00", "--note", "Line, with comma"]);
    let csv_path = db._dir.path().join("out.csv");
    db.ok(&["export", "--format", "csv", "--output", csv_path.to_str().unwrap()]);
    let csv = std::fs::read_to_string(&csv_path).unwrap();
    assert!(csv.lines().next().unwrap().ends_with(",Note"), "{csv}");

    db.ok(&["reset", "--yes"]);
    db.ok(&["import", "--format", "csv", csv_path.to_str().unwrap()]);
    assert_eq!(db.list_json()[0]["note"], "Line, with comma");
}

#[test]
fn a_database_the_app_has_not_migrated_yet_works_without_the_note_column() {
    let db = TestDb::new();
    db.ok(&["add", "Task", "--start", "09:00", "--end", "10:00"]);
    // Simulate an app database from before migration 5.
    let conn = rusqlite::Connection::open(&db.path).unwrap();
    conn.execute("ALTER TABLE time_entries DROP COLUMN note", []).unwrap();
    drop(conn);

    let entry = &db.list_json()[0];
    assert!(entry["note"].is_null());
    let id = entry["id"].as_str().unwrap().to_string();
    let out = db.run(&["edit", &id, "--note", "x"]);
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("desktop app"));
    db.ok(&["edit", &id, "--description", "Still editable"]);

    let conn = rusqlite::Connection::open(&db.path).unwrap();
    let has_note: bool = conn
        .prepare("SELECT 1 FROM pragma_table_info('time_entries') WHERE name = 'note'")
        .unwrap()
        .exists([])
        .unwrap();
    assert!(!has_note, "the CLI must not add the column to an existing table");
}

#[test]
fn discard_throws_the_running_timer_away() {
    let db = TestDb::new();
    db.ok(&["add", "Kept", "--start", "09:00", "--end", "10:00"]);
    db.ok(&["start", "Oops", "--tags", "x"]);

    let declined = db.run_with_stdin(&["discard"], Some("n\n"));
    assert!(!declined.status.success());
    assert_eq!(db.list_json().as_array().unwrap().len(), 2);

    db.ok(&["discard", "--yes"]);
    let entries = db.list_json();
    assert_eq!(entries.as_array().unwrap().len(), 1);
    assert_eq!(entries[0]["description"], "Kept");
    assert!(db.ok(&["status"]).contains("No timer running."));
    assert!(!db.run(&["discard", "--yes"]).status.success());
}

#[test]
fn edit_with_several_ids_applies_to_all_like_a_group() {
    let db = TestDb::new();
    db.ok(&["projects", "add", "Acme", "--alias", "ACM"]);
    db.ok(&["add", "Login", "--start", "09:00", "--end", "10:00", "--tags", "a,only-first"]);
    db.ok(&["add", "Login", "--start", "11:00", "--end", "12:00", "--tags", "a"]);
    let entries = db.list_json();
    let ids: Vec<String> = entries.as_array().unwrap().iter().map(|e| e["id"].as_str().unwrap()[..8].to_string()).collect();

    db.ok(&["edit", &ids[0], &ids[1], "--description", "Login flow", "--project", "ACM", "--add-tags", "b", "--remove-tags", "A"]);

    let entries = db.list_json();
    for e in entries.as_array().unwrap() {
        assert_eq!(e["description"], "Login flow");
        assert!(e["projectId"].is_string());
        assert!(!tag_names(e).contains(&"a".to_string()));
        assert!(tag_names(e).contains(&"b".to_string()));
    }
    assert!(tag_names(&entries[0]).contains(&"only-first".to_string()), "tags only some entries had are kept");
}

#[test]
fn edit_with_several_ids_refuses_times_and_is_all_or_nothing() {
    let db = TestDb::new();
    db.ok(&["add", "One", "--start", "09:00", "--end", "10:00"]);
    db.ok(&["add", "Two", "--start", "11:00", "--end", "12:00"]);
    let entries = db.list_json();
    let a = entries[0]["id"].as_str().unwrap().to_string();
    let b = entries[1]["id"].as_str().unwrap().to_string();

    assert!(!db.run(&["edit", &a, &b, "--start", "08:00"]).status.success());
    assert!(!db.run(&["edit", &a, "no-such-id", "--description", "Changed"]).status.success());
    assert_eq!(db.list_json()[0]["description"], "One", "nothing is changed when one id is unknown");
    assert!(!db.run(&["edit", &a, "--tags", "x", "--add-tags", "y"]).status.success());
}
