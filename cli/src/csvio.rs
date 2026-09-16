use anyhow::Result;
use std::collections::HashMap;

pub const ENTRIES_CSV_HEADER: [&str; 8] = [
    "Project",
    "Task",
    "Description",
    "Start Date",
    "Start Time",
    "End Date",
    "End Time",
    "Duration",
];

/// Reads a CSV file into rows of `{lowercased header -> value}`, so lookups
/// don't depend on column order (matches the desktop app's importer).
pub fn read_rows(path: &std::path::Path) -> Result<Vec<HashMap<String, String>>> {
    let mut reader = csv::ReaderBuilder::new().flexible(true).from_path(path)?;
    let headers: Vec<String> = reader
        .headers()?
        .iter()
        .map(|h| h.trim().to_lowercase())
        .collect();

    let mut rows = Vec::new();
    for record in reader.records() {
        let record = record?;
        let mut row = HashMap::new();
        for (i, header) in headers.iter().enumerate() {
            row.insert(header.clone(), record.get(i).unwrap_or("").to_string());
        }
        rows.push(row);
    }
    Ok(rows)
}

pub fn get<'a>(row: &'a HashMap<String, String>, key: &str) -> Option<&'a str> {
    row.get(key).map(|s| s.trim()).filter(|s| !s.is_empty())
}
