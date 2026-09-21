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
use reqwest::{Method, StatusCode};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};

const USER_AGENT: &str = "Chronos (richardson.saconi@outlook.com)";

/// `/alltodo`'s maximum (and default) page size.
const TASK_PAGE_SIZE: usize = 100;

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
    /// Resolves a task's `#ticket` (what users see and type) to the `id`
    /// and list the API needs. There's no lookup-by-ticket endpoint
    /// (ProofHub/api_v3#25), so this pages through the project's tasks.
    #[serde(rename_all = "camelCase")]
    FindTask {
        subdomain: String,
        api_key: String,
        project_id: String,
        ticket: String,
    },
    /// Creates the time entry, or updates it in place when `time_id` is
    /// given *and* still exists in ProofHub — a time entry deleted on the
    /// ProofHub side is recreated instead of failing, which is what makes
    /// "send again" work after cleaning up entries there by hand.
    #[serde(rename_all = "camelCase")]
    UpsertEntry {
        subdomain: String,
        api_key: String,
        project_id: String,
        timesheet_id: String,
        time_id: Option<String>,
        logged_hours: u32,
        logged_mins: u32,
        date: String,
        status: String,
        description: String,
        list_id: Option<String>,
        task_id: Option<String>,
    },
    /// Reports whether each given time entry still exists in ProofHub, and
    /// its logged time/date if so — how Chronos notices entries deleted or
    /// edited there by hand (ProofHub has no webhooks).
    #[serde(rename_all = "camelCase")]
    CheckEntries {
        subdomain: String,
        api_key: String,
        entries: Vec<EntryRef>,
    },
    /// The current user's time entries in a timesheet dated `since` or
    /// later — how Chronos finds entries that exist in ProofHub but not in
    /// Chronos. Teammates' entries (`by_me: false`) are left out.
    #[serde(rename_all = "camelCase")]
    ListEntries {
        subdomain: String,
        api_key: String,
        project_id: String,
        timesheet_id: String,
        since: String,
    },
    /// Removes a time entry Chronos created earlier that no longer
    /// represents anything (see `planDay` in src/integrations/proofhub/plan.ts).
    /// Already-gone entries count as success.
    #[serde(rename_all = "camelCase")]
    DeleteEntry {
        subdomain: String,
        api_key: String,
        project_id: String,
        timesheet_id: String,
        time_id: String,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EntryRef {
    project_id: String,
    timesheet_id: String,
    time_id: String,
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
        Request::FindTask {
            subdomain,
            api_key,
            project_id,
            ticket,
        } => {
            // Open tasks first — nearly always where time is being logged,
            // and usually a single page — then completed ones.
            for completed in ["false", "true"] {
                let mut start = 0;
                loop {
                    let body = get(
                        client,
                        &subdomain,
                        &api_key,
                        &format!("/alltodo?projects={project_id}&completed={completed}&start={start}&limit={TASK_PAGE_SIZE}"),
                    )?;
                    let page = extract_list(&body, &["tasks"]);
                    if let Some(task) = page.iter().find(|t| stringify_id(t.get("ticket")) == ticket) {
                        return Ok(json!({
                            "id": stringify_id(task.get("id")),
                            "listId": stringify_id(task.get("list").and_then(|l| l.get("id"))),
                        }));
                    }
                    if page.len() < TASK_PAGE_SIZE {
                        break;
                    }
                    start += TASK_PAGE_SIZE;
                }
            }
            Ok(Value::Null)
        }
        Request::UpsertEntry {
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
            let collection = format!("/projects/{project_id}/timesheets/{timesheet_id}/time");
            let body = time_entry_body(
                &project_id,
                &timesheet_id,
                logged_hours,
                logged_mins,
                &date,
                &status,
                &description,
                list_id.as_deref(),
                task_id.as_deref(),
            );
            let existing = match time_id {
                Some(id) if time_entry_exists(client, &subdomain, &api_key, &collection, &id)? => Some(id),
                _ => None,
            };
            let (id, raw) = match existing {
                Some(id) => {
                    let raw = send(client, Method::PUT, &subdomain, &api_key, &format!("{collection}/{id}"), Some(&body))?;
                    (id, raw)
                }
                None => {
                    let raw = send(client, Method::POST, &subdomain, &api_key, &collection, Some(&body))?;
                    (stringify_id(raw.get("id")), raw)
                }
            };
            if id.is_empty() {
                return Err(PluginError::internal(
                    "ProofHub accepted the time entry but didn't return its id.".to_string(),
                ));
            }
            // The full response too, so the debug log shows exactly what
            // ProofHub echoed back for list_id/task_id.
            Ok(json!({ "id": id, "raw": raw }))
        }
        Request::CheckEntries {
            subdomain,
            api_key,
            entries,
        } => {
            // One listing per timesheet covers most ids in a single request.
            // Whether that listing pages isn't confirmed, so an id missing
            // from it is looked up on its own (the confirmed-behaviour check
            // in `time_entry_exists`) before being reported as deleted.
            let mut listings: HashMap<String, HashMap<String, Value>> = HashMap::new();
            let mut results = Vec::with_capacity(entries.len());
            for entry in entries {
                let collection = format!("/projects/{}/timesheets/{}/time", entry.project_id, entry.timesheet_id);
                if !listings.contains_key(&collection) {
                    let body = get(client, &subdomain, &api_key, &collection)?;
                    let by_id = extract_list(&body, &["time_entries"])
                        .into_iter()
                        .map(|item| (stringify_id(item.get("id")), item.clone()))
                        .collect();
                    listings.insert(collection.clone(), by_id);
                }
                let found = match listings[&collection].get(&entry.time_id) {
                    Some(item) => Some(item.clone()),
                    None => {
                        let body = get(client, &subdomain, &api_key, &format!("{collection}/{}", entry.time_id))?;
                        (stringify_id(body.get("id")) == entry.time_id).then_some(body)
                    }
                };
                results.push(json!({
                    "projectId": entry.project_id,
                    "timesheetId": entry.timesheet_id,
                    "timeId": entry.time_id,
                    "exists": found.is_some(),
                    "loggedHours": found.as_ref().and_then(|f| as_number(f.get("logged_hours"))),
                    "loggedMins": found.as_ref().and_then(|f| as_number(f.get("logged_mins"))),
                    "date": found
                        .as_ref()
                        .and_then(|f| f.get("date"))
                        .and_then(Value::as_str)
                        .map(|d| d.chars().take(10).collect::<String>()),
                }));
            }
            Ok(Value::Array(results))
        }
        Request::ListEntries {
            subdomain,
            api_key,
            project_id,
            timesheet_id,
            since,
        } => {
            let body = get(client, &subdomain, &api_key, &format!("/projects/{project_id}/timesheets/{timesheet_id}/time"))?;
            let entries = extract_list(&body, &["time_entries"])
                .into_iter()
                // Documented on every entry; treated as mine if ever absent.
                .filter(|item| item.get("by_me").and_then(Value::as_bool) != Some(false))
                .filter_map(|item| {
                    let date: String = item.get("date").and_then(Value::as_str)?.chars().take(10).collect();
                    (date >= since).then(|| {
                        json!({
                            "projectId": project_id,
                            "timesheetId": timesheet_id,
                            "timeId": stringify_id(item.get("id")),
                            "date": date,
                            "loggedHours": as_number(item.get("logged_hours")),
                            "loggedMins": as_number(item.get("logged_mins")),
                            "description": item.get("description").and_then(Value::as_str).unwrap_or(""),
                            "taskId": item.get("task").and_then(|t| t.get("id")).map(|id| stringify_id(Some(id))),
                        })
                    })
                })
                .collect();
            Ok(Value::Array(entries))
        }
        Request::DeleteEntry {
            subdomain,
            api_key,
            project_id,
            timesheet_id,
            time_id,
        } => {
            let collection = format!("/projects/{project_id}/timesheets/{timesheet_id}/time");
            if time_entry_exists(client, &subdomain, &api_key, &collection, &time_id)? {
                send(client, Method::DELETE, &subdomain, &api_key, &format!("{collection}/{time_id}"), None)?;
            }
            Ok(Value::Null)
        }
    }
}

/// `GET .../time/{id}` for an id that doesn't exist (e.g. deleted in
/// ProofHub) doesn't 404 — confirmed against the real API, it returns the
/// timesheet's whole `{"time_entries": [...]}` listing instead. So "exists"
/// means the response is that one entry, with a matching `id`.
fn time_entry_exists(
    client: &Client,
    subdomain: &str,
    api_key: &str,
    collection: &str,
    time_id: &str,
) -> Result<bool, PluginError> {
    let body = send(client, Method::GET, subdomain, api_key, &format!("{collection}/{time_id}"), None)?;
    Ok(stringify_id(body.get("id")) == time_id)
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
    send(client, Method::GET, subdomain, api_key, path, None)
}

/// ProofHub allows 25 requests per 10 seconds per account. Rather than
/// pacing every call up front (which made "send day" slow for the common
/// case of a handful of entries), requests go out at full speed and a 429
/// is waited out and retried.
const RATE_LIMIT_RETRIES: u32 = 3;

fn send(
    client: &Client,
    method: Method,
    subdomain: &str,
    api_key: &str,
    path: &str,
    body: Option<&Value>,
) -> Result<Value, PluginError> {
    let url = format!("{}{}", base_url(subdomain), path);
    let mut attempt = 0;
    loop {
        // Content-Type on every request, bodyless ones included: ProofHub
        // rejects a DELETE without it ("INCOMPLETE HEADERS", as an HTTP 200).
        let mut request = client
            .request(method.clone(), &url)
            .header("X-API-KEY", api_key)
            .header("Content-Type", "application/json");
        if let Some(body) = body {
            request = request.json(body);
        }
        let response = request.send().map_err(PluginError::network)?;
        if response.status() == StatusCode::TOO_MANY_REQUESTS && attempt < RATE_LIMIT_RETRIES {
            attempt += 1;
            let wait = response
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(10);
            std::thread::sleep(std::time::Duration::from_secs(wait.min(15)));
            continue;
        }
        return handle_response(response);
    }
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

/// A count ProofHub may send as a number or a numeric string.
fn as_number(value: Option<&Value>) -> Option<u64> {
    match value {
        Some(Value::Number(n)) => n.as_u64(),
        Some(Value::String(s)) => s.trim().parse().ok(),
        _ => None,
    }
}

fn stringify_id(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}
