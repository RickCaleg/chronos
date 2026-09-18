//! Stateless ProofHub API bridge. One invocation = one action: reads a
//! single JSON request from stdin, makes the corresponding ProofHub API
//! call(s), writes a single JSON envelope to stdout, exits.
//!
//! Deliberately has no database access and no credential storage of its
//! own — the caller (Chronos's main process) hands it credentials fresh on
//! every call via stdin and never persists anything here. See
//! docs/proofhub-integration.md sections 3 and 5 for why.
//!
//! ProofHub's exact JSON response envelope shape (e.g. whether `GET
//! /projects` returns a bare array or `{"projects": [...]}`) isn't fully
//! pinned down from the public docs alone — `extract_list` below is
//! deliberately tolerant of either, to be validated against a real
//! ProofHub account during Phase 1 testing.

use reqwest::blocking::{Client, Response};
use reqwest::StatusCode;
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::Read;

const USER_AGENT: &str = "Chronos (richardson.saconi@outlook.com)";

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "kebab-case")]
enum Request {
    #[serde(rename_all = "camelCase")]
    TestConnection { subdomain: String, api_key: String },
    #[serde(rename_all = "camelCase")]
    ListProjects { subdomain: String, api_key: String },
    #[serde(rename_all = "camelCase")]
    ListTimesheets {
        subdomain: String,
        api_key: String,
        project_id: String,
    },
    #[serde(rename_all = "camelCase")]
    CreateTimesheet {
        subdomain: String,
        api_key: String,
        project_id: String,
        title: String,
    },
    #[serde(rename_all = "camelCase")]
    ListTodolists {
        subdomain: String,
        api_key: String,
        project_id: String,
    },
    #[serde(rename_all = "camelCase")]
    ListTasks {
        subdomain: String,
        api_key: String,
        project_id: String,
        todolist_id: String,
    },
    #[serde(rename_all = "camelCase")]
    PushEntry {
        subdomain: String,
        api_key: String,
        project_id: String,
        timesheet_id: String,
        logged_hours: u32,
        logged_mins: u32,
        date: String,
        status: String,
        description: String,
        list_id: Option<String>,
        task_id: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    UpdateEntry {
        subdomain: String,
        api_key: String,
        project_id: String,
        timesheet_id: String,
        time_id: String,
        logged_hours: u32,
        logged_mins: u32,
        date: String,
        status: String,
        description: String,
    },
}

struct PluginError {
    status: Option<u16>,
    message: String,
}

impl PluginError {
    fn network(err: reqwest::Error) -> Self {
        PluginError {
            status: None,
            message: format!("network error: {err}"),
        }
    }

    fn internal(message: String) -> Self {
        PluginError {
            status: None,
            message,
        }
    }
}

fn main() {
    let mut input = String::new();
    if let Err(err) = std::io::stdin().read_to_string(&mut input) {
        finish(Err(PluginError::internal(format!(
            "failed to read stdin: {err}"
        ))));
    }

    let request: Request = match serde_json::from_str(&input) {
        Ok(request) => request,
        Err(err) => finish(Err(PluginError::internal(format!(
            "invalid request: {err}"
        )))),
    };

    let client = match Client::builder().user_agent(USER_AGENT).build() {
        Ok(client) => client,
        Err(err) => finish(Err(PluginError::internal(format!(
            "failed to build HTTP client: {err}"
        )))),
    };

    finish(dispatch(&client, request));
}

/// Prints the JSON envelope and exits — the single point where the process
/// terminates, so every code path (including early stdin/parse failures)
/// still produces valid JSON on stdout for the caller to parse.
fn finish(result: Result<Value, PluginError>) -> ! {
    let (envelope, failed) = match result {
        Ok(data) => (json!({ "ok": true, "data": data }), false),
        Err(err) => (
            json!({ "ok": false, "error": { "status": err.status, "message": err.message } }),
            true,
        ),
    };
    println!("{envelope}");
    std::process::exit(if failed { 1 } else { 0 });
}

fn dispatch(client: &Client, request: Request) -> Result<Value, PluginError> {
    match request {
        Request::TestConnection { subdomain, api_key } => {
            get(client, &subdomain, &api_key, "/projects")?;
            Ok(Value::Null)
        }
        Request::ListProjects { subdomain, api_key } => {
            let body = get(client, &subdomain, &api_key, "/projects")?;
            Ok(Value::Array(
                extract_list(&body, &["projects"]).into_iter().map(normalize_item).collect(),
            ))
        }
        Request::ListTimesheets {
            subdomain,
            api_key,
            project_id,
        } => {
            let body = get(
                client,
                &subdomain,
                &api_key,
                &format!("/projects/{project_id}/timesheets"),
            )?;
            Ok(Value::Array(
                extract_list(&body, &["timesheets"]).into_iter().map(normalize_item).collect(),
            ))
        }
        Request::CreateTimesheet {
            subdomain,
            api_key,
            project_id,
            title,
        } => {
            let body = post(
                client,
                &subdomain,
                &api_key,
                &format!("/projects/{project_id}/timesheets"),
                &json!({ "title": title, "private": false }),
            )?;
            Ok(normalize_item(&body))
        }
        Request::ListTodolists {
            subdomain,
            api_key,
            project_id,
        } => {
            let body = get(
                client,
                &subdomain,
                &api_key,
                &format!("/projects/{project_id}/todolists"),
            )?;
            Ok(Value::Array(
                extract_list(&body, &["todolists"]).into_iter().map(normalize_item).collect(),
            ))
        }
        Request::ListTasks {
            subdomain,
            api_key,
            project_id,
            todolist_id,
        } => {
            let body = get(
                client,
                &subdomain,
                &api_key,
                &format!("/projects/{project_id}/todolists/{todolist_id}/tasks"),
            )?;
            Ok(Value::Array(
                extract_list(&body, &["tasks"]).into_iter().map(normalize_item).collect(),
            ))
        }
        Request::PushEntry {
            subdomain,
            api_key,
            project_id,
            timesheet_id,
            logged_hours,
            logged_mins,
            date,
            status,
            description,
            list_id,
            task_id,
        } => {
            let body = post(
                client,
                &subdomain,
                &api_key,
                &format!("/projects/{project_id}/timesheets/{timesheet_id}/time"),
                &time_entry_body(
                    &project_id,
                    &timesheet_id,
                    logged_hours,
                    logged_mins,
                    &date,
                    &status,
                    &description,
                    list_id.as_deref(),
                    task_id.as_deref(),
                ),
            )?;
            Ok(json!({ "id": stringify_id(body.get("id")) }))
        }
        Request::UpdateEntry {
            subdomain,
            api_key,
            project_id,
            timesheet_id,
            time_id,
            logged_hours,
            logged_mins,
            date,
            status,
            description,
        } => {
            put(
                client,
                &subdomain,
                &api_key,
                &format!("/projects/{project_id}/timesheets/{timesheet_id}/time/{time_id}"),
                &time_entry_body(
                    &project_id,
                    &timesheet_id,
                    logged_hours,
                    logged_mins,
                    &date,
                    &status,
                    &description,
                    None,
                    None,
                ),
            )?;
            Ok(Value::Null)
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn time_entry_body(
    project_id: &str,
    timesheet_id: &str,
    logged_hours: u32,
    logged_mins: u32,
    date: &str,
    status: &str,
    description: &str,
    list_id: Option<&str>,
    task_id: Option<&str>,
) -> Value {
    let mut body = json!({
        "project": project_id,
        "timesheet_id": timesheet_id,
        "logged_hours": logged_hours,
        "logged_mins": logged_mins,
        "date": date,
        "status": status,
        "description": description,
    });
    if let (Some(list_id), Some(task_id)) = (list_id, task_id) {
        body["list_id"] = json!(list_id);
        body["task_id"] = json!(task_id);
    }
    body
}

fn base_url(subdomain: &str) -> String {
    format!("https://{subdomain}.proofhub.com/api/v3")
}

fn get(client: &Client, subdomain: &str, api_key: &str, path: &str) -> Result<Value, PluginError> {
    let response = client
        .get(format!("{}{}", base_url(subdomain), path))
        .header("X-API-KEY", api_key)
        .send()
        .map_err(PluginError::network)?;
    handle_response(response)
}

fn post(
    client: &Client,
    subdomain: &str,
    api_key: &str,
    path: &str,
    body: &Value,
) -> Result<Value, PluginError> {
    let response = client
        .post(format!("{}{}", base_url(subdomain), path))
        .header("X-API-KEY", api_key)
        .header("Content-Type", "application/json")
        .json(body)
        .send()
        .map_err(PluginError::network)?;
    handle_response(response)
}

fn put(
    client: &Client,
    subdomain: &str,
    api_key: &str,
    path: &str,
    body: &Value,
) -> Result<Value, PluginError> {
    let response = client
        .put(format!("{}{}", base_url(subdomain), path))
        .header("X-API-KEY", api_key)
        .header("Content-Type", "application/json")
        .json(body)
        .send()
        .map_err(PluginError::network)?;
    handle_response(response)
}

fn handle_response(response: Response) -> Result<Value, PluginError> {
    let status: StatusCode = response.status();
    let text = response.text().unwrap_or_default();
    let body: Value = serde_json::from_str(&text).unwrap_or(Value::Null);

    if status.is_success() {
        return Ok(body);
    }

    let message = body
        .get("message")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("ProofHub returned HTTP {}", status.as_u16()));
    Err(PluginError {
        status: Some(status.as_u16()),
        message,
    })
}

/// Tolerates either a bare array response or one nested under one of
/// `keys` (e.g. `{"projects": [...]}`) — ProofHub's exact envelope shape
/// per endpoint isn't confirmed from the public docs alone.
fn extract_list<'a>(body: &'a Value, keys: &[&str]) -> Vec<&'a Value> {
    if let Some(array) = body.as_array() {
        return array.iter().collect();
    }
    for key in keys {
        if let Some(array) = body.get(key).and_then(Value::as_array) {
            return array.iter().collect();
        }
    }
    Vec::new()
}

fn normalize_item(item: &Value) -> Value {
    json!({
        "id": stringify_id(item.get("id")),
        "title": item.get("title").and_then(Value::as_str).unwrap_or("").to_string(),
    })
}

fn stringify_id(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}
