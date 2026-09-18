//! CI-only: signs an arbitrary file with a minisign keypair, entirely
//! non-interactively. Neither the `rsign` CLI nor the `minisign` CLI accept
//! the decryption password except via an interactive TTY prompt, which a CI
//! runner doesn't have — this uses the `minisign` crate's library API
//! instead, reading the key and its password from generic env vars so this
//! one binary works for every keypair this project signs with:
//! - the ProofHub plugin binaries (`PLUGIN_SIGNING_PRIVATE_KEY`/`_PASSWORD`,
//!   see docs/proofhub-integration.md section 3.4)
//! - re-signing the AppImage after `packaging/appimage/strip-bundled-libs.sh`
//!   patches it (`TAURI_SIGNING_PRIVATE_KEY`/`_PASSWORD`, the app's own
//!   existing updater key — see release.yml)
//!
//! The workflow maps whichever repo secret is relevant for the call onto
//! `SIGNING_PRIVATE_KEY`/`SIGNING_PRIVATE_KEY_PASSWORD` before invoking this.
//!
//! The secret key env var holds the key in the same base64-wrapped form
//! `tauri signer generate` produces — decoded here before handing it to the
//! minisign crate, which expects the raw two-line "untrusted comment / key"
//! text.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::env;
use std::fs;
use std::io::Cursor;

fn main() {
    let mut args = env::args().skip(1);
    let input_path = args.next().unwrap_or_else(|| usage());
    let output_path = args.next().unwrap_or_else(|| usage());

    let key_b64 = env::var("SIGNING_PRIVATE_KEY").expect("SIGNING_PRIVATE_KEY is not set");
    let password = env::var("SIGNING_PRIVATE_KEY_PASSWORD").expect("SIGNING_PRIVATE_KEY_PASSWORD is not set");

    let key_raw = STANDARD
        .decode(key_b64.trim())
        .expect("SIGNING_PRIVATE_KEY isn't valid base64");
    let key_str = String::from_utf8(key_raw).expect("decoded secret key isn't valid UTF-8");

    let secret_key = minisign::SecretKeyBox::from_string(&key_str)
        .expect("SIGNING_PRIVATE_KEY isn't a valid minisign secret key")
        .into_secret_key(Some(password))
        .expect("wrong SIGNING_PRIVATE_KEY_PASSWORD or corrupt key");

    let data = fs::read(&input_path).unwrap_or_else(|e| panic!("failed to read {input_path}: {e}"));
    let signature_box = minisign::sign(None, &secret_key, Cursor::new(data), None, None)
        .expect("signing failed")
        .into_string();

    fs::write(&output_path, signature_box).unwrap_or_else(|e| panic!("failed to write {output_path}: {e}"));
    println!("Signed {input_path} -> {output_path}");
}

fn usage() -> ! {
    eprintln!("usage: sign-file <input-file> <output-sig-file>");
    std::process::exit(1);
}
