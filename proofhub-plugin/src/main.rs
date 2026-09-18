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
use std::io::{Read, Write};

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
        list_id: Option<String>,
        task_id: Option<String>,
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

    let result = dispatch(&client, request);
    log_debug(&input, &result);
    finish(result);
}

/// Troubleshooting aid for exactly the kind of bug that motivated it: a
/// push "succeeding" but silently not doing what the request asked for
/// (e.g. logging at the project level instead of a specific task). Only
/// writes anything if the main app set `CHRONOS_PROOFHUB_LOG_PATH` when it
/// spawned this process (it always does — see `run_plugin` in
/// src-tauri/src/proofhub_plugin.rs); overwrites the file each call rather
/// than appending, so it's always "what just happened," not an
/// ever-growing history. The API key is redacted before anything touches
/// disk.
fn log_debug(raw_input: &str, result: &Result<Value, PluginError>) {
    let Ok(log_path) = std::env::var("CHRONOS_PROOFHUB_LOG_PATH") else {
        return;
    };

    let mut request_for_log: Value = serde_json::from_str(raw_input).unwrap_or(Value::Null);
    if let Some(obj) = request_for_log.as_object_mut() {
        obj.insert("apiKey".to_string(), Value::String("<redacted>".to_string()));
    }

    let response_for_log = match result {
        Ok(data) => json!({ "ok": true, "data": data }),
        Err(err) => json!({ "ok": false, "error": { "status": err.status, "message": err.message } }),
    };

    let line = json!({ "request": request_for_log, "response": response_for_log });
    let pretty = serde_json::to_string_pretty(&line).unwrap_or_else(|_| line.to_string());
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).write(true).truncate(true).open(&log_path) {
        let _ = writeln!(file, "{pretty}");
    }
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
                extract_list(&body, &["tasks"]).into_iter().map(normalize_task_item).collect(),
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
            // The full response (not just `id`) so the debug log can show
            // exactly what ProofHub echoed back for list_id/task_id — the
            // frontend only reads `.id` off this, extra fields are harmless.
            let mut result = json!({ "id": stringify_id(body.get("id")) });
            if let Some(obj) = result.as_object_mut() {
                obj.insert("raw".to_string(), body);
            }
            Ok(result)
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
            list_id,
            task_id,
        } => {
            let body = put(
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
                    list_id.as_deref(),
                    task_id.as_deref(),
                ),
            )?;
            Ok(body)
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

    // Confirmed via CHRONOS_PROOFHUB_LOG_PATH debug logging: ProofHub signals
    // at least some failures (e.g. a bad API key) with an HTTP 200 and
    // `{"success": false, "status": false, "message": "..."}` in the body,
    // not a non-2xx status code — an HTTP-level success is necessary but
    // not sufficient. This is also the leading suspect for the
    // "push succeeded but the task link silently didn't happen" report: a
    // rejected/invalid task_id could plausibly come back the same way,
    // previously treated as a full success because only `status.is_success()`
    // was checked.
    let body_says_failure = body.get("success").and_then(Value::as_bool) == Some(false)
        || body.get("status").and_then(Value::as_bool) == Some(false);

    if status.is_success() && !body_says_failure {
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

/// Tasks specifically carry a `ticket` field distinct from `id` — `ticket`
/// is the small, sequential, "#1234"-style number ProofHub's own UI shows
/// the user (confirmed via ProofHub's help center: sequential per account,
/// prefixed with "#" in the UI); `id` is a large opaque internal identifier
/// with no relation to that number, and is what the API actually needs as
/// `task_id`. Chronos users type/see the `ticket` value, never the `id` —
/// see sync.ts's `resolveTaskId` for where the lookup from one to the
/// other happens.
fn normalize_task_item(item: &Value) -> Value {
    json!({
        "id": stringify_id(item.get("id")),
        "title": item.get("title").and_then(Value::as_str).unwrap_or("").to_string(),
        "ticket": stringify_id(item.get("ticket")),
    })
}

fn stringify_id(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}
