use anyhow::{Context, Result};
use rusqlite::Connection;
use std::path::{Path, PathBuf};

/// Resolves the same SQLite file the desktop app uses.
///
/// Priority: `--db` flag > `CHRONOS_DB_PATH` env var > the OS config directory
/// Tauri resolves for the app's identifier (`~/.config/com.richardson.chronos/chronos.db`
/// on Linux, `%APPDATA%\com.richardson.chronos\chronos.db` on Windows).
pub fn resolve_db_path(override_path: Option<PathBuf>) -> Result<PathBuf> {
    if let Some(path) = override_path {
        return Ok(path);
    }
    if let Ok(path) = std::env::var("CHRONOS_DB_PATH") {
        return Ok(PathBuf::from(path));
    }
    let config_dir = dirs::config_dir().context("could not determine the OS config directory")?;
    Ok(config_dir.join("com.richardson.chronos").join("chronos.db"))
}

pub fn open(path: &Path) -> Result<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }
    let conn = Connection::open(path)
        .with_context(|| format!("failed to open database at {}", path.display()))?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;")?;
    ensure_schema(&conn)?;
    Ok(conn)
}

/// Idempotent schema setup. Mirrors the desktop app's migrations exactly, but
/// never touches the app's own `_sqlx_migrations` bookkeeping table — this
/// only ever runs `CREATE TABLE IF NOT EXISTS`, so it's a no-op against a
/// database the desktop app already created and migrated.
fn ensure_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            color TEXT NOT NULL,
            archived INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            alias TEXT
        );

        CREATE TABLE IF NOT EXISTS time_entries (
            id TEXT PRIMARY KEY,
            description TEXT NOT NULL DEFAULT '',
            task_number TEXT,
            project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
            start_time TEXT NOT NULL,
            end_time TEXT,
            duration_seconds INTEGER,
            is_running INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_time_entries_start_time ON time_entries(start_time);
        CREATE INDEX IF NOT EXISTS idx_time_entries_project_id ON time_entries(project_id);

        CREATE TABLE IF NOT EXISTS tags (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS entry_tags (
            entry_id TEXT NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
            tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
            PRIMARY KEY (entry_id, tag_id)
        );

        CREATE INDEX IF NOT EXISTS idx_entry_tags_tag_id ON entry_tags(tag_id);
        "#,
    )?;

    // Safety net for a database created before the `alias` column existed.
    let has_alias: bool = conn
        .prepare("SELECT 1 FROM pragma_table_info('projects') WHERE name = 'alias'")?
        .exists([])?;
    if !has_alias {
        conn.execute("ALTER TABLE projects ADD COLUMN alias TEXT", [])?;
    }

    // Safety net for a database created before the ProofHub sync-tracking
    // columns existed. The CLI never populates or reads these — this is
    // purely to keep the schema shape consistent for a database the CLI
    // might create first (see docs/proofhub-integration.md section 4.1).
    let has_proofhub_sync: bool = conn
        .prepare("SELECT 1 FROM pragma_table_info('time_entries') WHERE name = 'proofhub_synced_at'")?
        .exists([])?;
    if !has_proofhub_sync {
        conn.execute("ALTER TABLE time_entries ADD COLUMN proofhub_time_entry_id TEXT", [])?;
        conn.execute("ALTER TABLE time_entries ADD COLUMN proofhub_synced_at TEXT", [])?;
    }

    Ok(())
}
