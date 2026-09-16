use crate::model::Project;

pub struct ParsedEntryText {
    pub task_number: String,
    pub alias_token: Option<String>,
    pub description: String,
}

/// Mirrors the desktop app's paste-autofill rule: "TASK - ALIAS - description"
/// or "TASK - description". Used when importing rows (e.g. from Clockify)
/// that don't have a task number of their own but embed one in the text.
pub fn parse_pasted_entry(text: &str) -> Option<ParsedEntryText> {
    let trimmed = text.trim();
    let (task_number, remainder) = split_first_dash(trimmed)?;
    if !task_number.starts_with('#') || task_number.contains(char::is_whitespace) {
        return None;
    }

    if let Some((alias, description)) = split_first_dash(&remainder) {
        Some(ParsedEntryText {
            task_number,
            alias_token: Some(alias),
            description,
        })
    } else {
        Some(ParsedEntryText {
            task_number,
            alias_token: None,
            description: remainder,
        })
    }
}

/// Splits "A - B" into ("A", "B") on the first " - " separator (dashes
/// optionally surrounded by whitespace), trimming both sides.
fn split_first_dash(text: &str) -> Option<(String, String)> {
    let idx = text.find('-')?;
    let left = text[..idx].trim();
    let right = text[idx + 1..].trim();
    if left.is_empty() || right.is_empty() {
        return None;
    }
    Some((left.to_string(), right.to_string()))
}

pub fn match_project_by_alias<'a>(token: &str, projects: &'a [Project]) -> Option<&'a Project> {
    let clean = token.replace(['[', ']'], "");
    let clean = clean.trim().to_lowercase();
    if clean.is_empty() {
        return None;
    }
    projects
        .iter()
        .find(|p| p.alias.as_deref().map(|a| a.to_lowercase()) == Some(clean.clone()))
        .or_else(|| projects.iter().find(|p| p.name.to_lowercase() == clean))
        .or_else(|| projects.iter().find(|p| p.name.to_lowercase().contains(&clean)))
}
