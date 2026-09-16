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
