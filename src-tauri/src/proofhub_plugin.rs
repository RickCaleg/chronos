//! Install/uninstall/status/bridge commands for the downloaded ProofHub
//! plugin binary (`chronos-proofhub-plugin`). See
//! docs/proofhub-integration.md section 3 for the full rationale: the
//! ProofHub API client is a separate, signature-verified binary, not
//! code compiled into this app, so nothing ProofHub-specific exists on
//! the machine before the user clicks Install.

use serde::Serialize;
use serde_json::Value;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Manager};

use crate::proofhub_credentials;

const REPO: &str = "RickCaleg/chronos";

/// Dedicated signing key for the downloaded plugin binaries, separate from
/// the app's own auto-updater key so a compromise of one can't be used
/// against the other. PLACEHOLDER: generating the real keypair and
/// registering its secret half in CI is a deliberate, confirmed step (see
/// docs/proofhub-integration.md section 13, item 1) — until that happens,
/// every install attempt fails signature verification by design rather
/// than silently accepting an unsigned binary.
const PLUGIN_PUBLIC_KEY_B64: &str = "REPLACE_ME_ONCE_THE_PLUGIN_SIGNING_KEYPAIR_IS_GENERATED";

fn asset_name() -> Result<&'static str, String> {
    if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        Ok("chronos-proofhub-plugin-linux-x86_64")
    } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        Ok("chronos-proofhub-plugin-windows-x86_64.exe")
    } else {
        Err("The ProofHub integration isn't available for this platform yet.".to_string())
    }
}

fn local_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "chronos-proofhub-plugin.exe"
    } else {
        "chronos-proofhub-plugin"
    }
}

fn plugin_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("plugins");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn binary_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(plugin_dir(app)?.join(local_binary_name()))
}

fn version_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(plugin_dir(app)?.join("VERSION"))
}

#[derive(Serialize)]
pub struct PluginStatus {
    installed: bool,
    version: Option<String>,
}

#[tauri::command]
pub fn proofhub_plugin_status(app: AppHandle) -> Result<PluginStatus, String> {
    let path = binary_path(&app)?;
    if !path.exists() {
        return Ok(PluginStatus { installed: false, version: None });
    }
    let version = std::fs::read_to_string(version_path(&app)?).ok();
    Ok(PluginStatus { installed: true, version })
}

/// Downloads the platform-matching plugin binary + its `.minisig` from the
/// SAME GitHub release tag as this running app's own version (keeps the
/// plugin's request/response shape in lockstep with the app with no
/// separate version-negotiation needed), verifies the signature, and only
/// then writes it to disk.
#[tauri::command]
pub fn proofhub_plugin_install(app: AppHandle) -> Result<(), String> {
    let asset = asset_name()?;
    let version = app.package_info().version.to_string();
    let base = format!("https://github.com/{REPO}/releases/download/v{version}");
    let binary_url = format!("{base}/{asset}");
    let sig_url = format!("{binary_url}.minisig");

    let client = reqwest::blocking::Client::builder()
        .user_agent(format!("Chronos/{version}"))
        .build()
        .map_err(|e| e.to_string())?;

    let binary_bytes = client
        .get(&binary_url)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Couldn't download the ProofHub plugin: {e}"))?
        .bytes()
        .map_err(|e| e.to_string())?;

    let signature_text = client
        .get(&sig_url)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Couldn't download the ProofHub plugin's signature: {e}"))?
        .text()
        .map_err(|e| e.to_string())?;

    let public_key = minisign_verify::PublicKey::from_base64(PLUGIN_PUBLIC_KEY_B64)
        .map_err(|e| format!("Invalid embedded plugin signing key: {e}"))?;
    let signature = minisign_verify::Signature::decode(&signature_text)
        .map_err(|e| format!("Invalid plugin signature file: {e}"))?;
    public_key
        .verify(&binary_bytes, &signature, false)
        .map_err(|_| "The downloaded plugin failed signature verification and was not installed.".to_string())?;

    let path = binary_path(&app)?;
    std::fs::write(&path, &binary_bytes).map_err(|e| e.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&path).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&path, perms).map_err(|e| e.to_string())?;
    }

    std::fs::write(version_path(&app)?, &version).map_err(|e| e.to_string())?;
    Ok(())
}

/// Removes the downloaded binary. Deliberately does not touch saved
/// credentials or already-synced entries' metadata — "uninstall the
/// plugin" and "disconnect the account" are distinct actions.
#[tauri::command]
pub fn proofhub_plugin_uninstall(app: AppHandle) -> Result<(), String> {
    let _ = std::fs::remove_file(binary_path(&app)?);
    let _ = std::fs::remove_file(version_path(&app)?);
    Ok(())
}

/// The single generic bridge every ProofHub-aware UI action goes through.
/// `action`/`payload` describe the request (see proofhub-plugin/src/main.rs
/// for the exact shapes); credentials are injected here, server-side, from
/// the encrypted store — the frontend never has access to them.
#[tauri::command]
pub fn proofhub_plugin_call(app: AppHandle, action: String, payload: Value) -> Result<Value, String> {
    let path = binary_path(&app)?;
    if !path.exists() {
        return Err("The ProofHub plugin isn't installed.".to_string());
    }
    let creds = proofhub_credentials::load_credentials(&app)?
        .ok_or_else(|| "ProofHub isn't connected yet.".to_string())?;

    let mut request = match payload {
        Value::Object(map) => map,
        _ => serde_json::Map::new(),
    };
    request.insert("action".to_string(), Value::String(action));
    request.insert("subdomain".to_string(), Value::String(creds.subdomain));
    request.insert("apiKey".to_string(), Value::String(creds.api_key));

    let mut child = Command::new(&path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Couldn't start the ProofHub plugin: {e}"))?;

    {
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| "Couldn't open the ProofHub plugin's stdin.".to_string())?;
        let bytes = serde_json::to_vec(&Value::Object(request)).map_err(|e| e.to_string())?;
        stdin.write_all(&bytes).map_err(|e| e.to_string())?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("The ProofHub plugin didn't respond: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let envelope: Value = serde_json::from_str(&stdout)
        .map_err(|_| "The ProofHub plugin returned an unreadable response.".to_string())?;

    if envelope.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(envelope.get("data").cloned().unwrap_or(Value::Null))
    } else {
        let message = envelope
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("The ProofHub request failed.")
            .to_string();
        Err(message)
    }
}
