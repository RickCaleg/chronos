use rusqlite::Row;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub color: String,
    pub alias: Option<String>,
    pub archived: bool,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

impl Project {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Project {
            id: row.get("id")?,
            name: row.get("name")?,
            color: row.get("color")?,
            alias: row.get("alias")?,
            archived: row.get::<_, i64>("archived")? != 0,
            created_at: row.get("created_at")?,
        })
    }

    /// How the project is displayed everywhere in the app: "CODE - Name", or just "Name".
    pub fn label(&self) -> String {
        match &self.alias {
            Some(alias) if !alias.is_empty() => format!("{} - {}", alias, self.name),
            _ => self.name.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeEntry {
    pub id: String,
    pub description: String,
    #[serde(rename = "taskNumber")]
    pub task_number: Option<String>,
    #[serde(rename = "projectId")]
    pub project_id: Option<String>,
    #[serde(rename = "startTime")]
    pub start_time: String,
    #[serde(rename = "endTime")]
    pub end_time: Option<String>,
    #[serde(rename = "durationSeconds")]
    pub duration_seconds: Option<i64>,
    #[serde(rename = "isRunning")]
    pub is_running: bool,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

impl TimeEntry {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(TimeEntry {
            id: row.get("id")?,
            description: row.get("description")?,
            task_number: row.get("task_number")?,
            project_id: row.get("project_id")?,
            start_time: row.get("start_time")?,
            end_time: row.get("end_time")?,
            duration_seconds: row.get("duration_seconds")?,
            is_running: row.get::<_, i64>("is_running")? != 0,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}
