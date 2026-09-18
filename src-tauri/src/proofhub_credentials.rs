//! At-rest storage for the ProofHub subdomain + API key.
//!
//! Deliberately NOT the `settings` SQLite table and NOT `localStorage`:
//! both are swept into JSON backups (`exportJsonBackup`/`performAutoBackup`
//! query `settings` too... actually they don't, but the DB *file* itself
//! could still be copied by hand) — see docs/proofhub-integration.md
//! section 5. This lives in its own encrypted file, outside every export
//! path, decrypted only in memory, only in this process, only right before
//! a `proofhub_plugin_call`. The plugin binary itself never touches this
//! file — credentials are handed to it fresh on stdin per call.

use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;

#[derive(Serialize, Deserialize)]
pub(crate) struct StoredCredentials {
    pub(crate) subdomain: String,
    pub(crate) api_key: String,
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn key_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("proofhub-credentials.key"))
}

fn blob_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("proofhub-credentials.enc"))
}

#[cfg(unix)]
fn restrict_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    if let Ok(metadata) = fs::metadata(path) {
        let mut perms = metadata.permissions();
        perms.set_mode(0o600);
        let _ = fs::set_permissions(path, perms);
    }
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path) {}

fn load_or_create_key(path: &Path) -> Result<[u8; KEY_LEN], String> {
    if let Ok(bytes) = fs::read(path) {
        if bytes.len() == KEY_LEN {
            let mut key = [0u8; KEY_LEN];
            key.copy_from_slice(&bytes);
            return Ok(key);
        }
    }
    let mut key = [0u8; KEY_LEN];
    rand::rngs::OsRng.fill_bytes(&mut key);
    fs::write(path, key).map_err(|e| e.to_string())?;
    restrict_permissions(path);
    Ok(key)
}

fn encrypt(key: &[u8; KEY_LEN], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new(key.into());
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|_| "failed to encrypt the ProofHub credentials".to_string())?;
    let mut out = nonce_bytes.to_vec();
    out.extend(ciphertext);
    Ok(out)
}

fn decrypt(key: &[u8; KEY_LEN], blob: &[u8]) -> Result<Vec<u8>, String> {
    if blob.len() < NONCE_LEN {
        return Err("the stored ProofHub credentials are corrupt".to_string());
    }
    let (nonce_bytes, ciphertext) = blob.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new(key.into());
    cipher
        .decrypt(Nonce::from_slice(nonce_bytes), ciphertext)
        .map_err(|_| "failed to decrypt the stored ProofHub credentials".to_string())
}

/// Used internally by `proofhub_plugin::proofhub_plugin_call` — never
/// exposed to the frontend as a command (see the module doc comment).
pub(crate) fn load_credentials(app: &AppHandle) -> Result<Option<StoredCredentials>, String> {
    let Ok(blob) = fs::read(blob_path(app)?) else {
        return Ok(None);
    };
    let key = load_or_create_key(&key_path(app)?)?;
    let plaintext = decrypt(&key, &blob)?;
    serde_json::from_slice(&plaintext)
        .map(Some)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn proofhub_save_credentials(app: AppHandle, subdomain: String, api_key: String) -> Result<(), String> {
    let key = load_or_create_key(&key_path(&app)?)?;
    let payload = serde_json::to_vec(&StoredCredentials { subdomain, api_key }).map_err(|e| e.to_string())?;
    let blob = encrypt(&key, &payload)?;
    let path = blob_path(&app)?;
    fs::write(&path, blob).map_err(|e| e.to_string())?;
    restrict_permissions(&path);
    Ok(())
}

/// Returns only the subdomain (non-secret) so Settings can show "Connected
/// to acmecorp.proofhub.com" — never the API key itself.
#[tauri::command]
pub fn proofhub_connection_status(app: AppHandle) -> Result<Option<String>, String> {
    Ok(load_credentials(&app)?.map(|c| c.subdomain))
}

#[tauri::command]
pub fn proofhub_clear_credentials(app: AppHandle) -> Result<(), String> {
    let _ = fs::remove_file(blob_path(&app)?);
    let _ = fs::remove_file(key_path(&app)?);
    Ok(())
}
