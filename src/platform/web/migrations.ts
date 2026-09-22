// Mirrors `migrations()` in src-tauri/src/lib.rs (same order, same SQL), so a
// JSON backup moves between the desktop and web builds without conversion.
// A new desktop migration must be appended here too. The version reached is
// tracked in `PRAGMA user_version`.
export const MIGRATIONS: string[] = [
  `CREATE TABLE projects (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     color TEXT NOT NULL,
     archived INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL
   );

   CREATE TABLE time_entries (
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

   CREATE INDEX idx_time_entries_start_time ON time_entries(start_time);
   CREATE INDEX idx_time_entries_project_id ON time_entries(project_id);

   CREATE TABLE settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );`,

  `ALTER TABLE projects ADD COLUMN alias TEXT;`,

  `CREATE TABLE tags (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL UNIQUE,
     created_at TEXT NOT NULL
   );

   CREATE TABLE entry_tags (
     entry_id TEXT NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
     tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
     PRIMARY KEY (entry_id, tag_id)
   );

   CREATE INDEX idx_entry_tags_tag_id ON entry_tags(tag_id);`,

  `ALTER TABLE time_entries ADD COLUMN proofhub_time_entry_id TEXT;
   ALTER TABLE time_entries ADD COLUMN proofhub_synced_at TEXT;`,

  `ALTER TABLE time_entries ADD COLUMN note TEXT;`,
];
