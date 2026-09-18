# Contributing to Chronos

Thanks for considering a contribution! This is a small, focused project — the goal is to keep it simple, not to grow it into a full Clockify clone.

## Setup

```sh
npm install
npm run tauri dev
```

You'll need Node.js 20+, a stable Rust toolchain, and the platform prerequisites listed in [Tauri's docs](https://tauri.app/start/prerequisites/).

## Before opening a PR

- `npm run build` (TypeScript + Vite) and `cargo check --workspace` should both pass cleanly.
- If you touch `cli/`, also run `cargo test -p chronos-cli` and `cargo clippy -p chronos-cli --all-targets`. The desktop app and the CLI both talk to the same SQLite schema (defined once in `src-tauri/src/lib.rs`'s migrations, mirrored idempotently in `cli/src/db.rs::ensure_schema`) — if you change the schema, update both, and never edit an already-shipped migration's SQL text (it's checksummed; add a new migration instead).
- If you touch any user-facing string, add it to **both** `src/i18n/locales/en.json` and `src/i18n/locales/pt-BR.json`. A key present in only one language will silently fall back to English for the other.
- The UI follows a deliberately squared design system: corners use `rounded-[2px]` (or `rounded-[1px]` for small color swatches), not Tailwind's `rounded-lg`/`rounded-xl` scale. Colors are always the CSS custom properties in `src/index.css` (`var(--color-*)`), never hardcoded Tailwind colors — the whole point is that light/dark/Omarchy themes recolor the entire app without touching component code.
- Every interactive element needs a visible `focus-visible` state and to be reachable/operable by keyboard alone — this app is designed to be fully usable without a mouse.
- Keep new features consistent with the "local-first, no telemetry" principle: no user data ever leaves the device unless the user explicitly opts in. There are two deliberate exceptions today: the updater, which makes a GET request to GitHub to check the latest release tag (sends nothing about the user or their data); and the optional ProofHub integration (`docs/proofhub-integration.md`), which only downloads/contacts anything after the user clicks Install in Settings. If you're changing either, check the relevant doc (`docs/CLI.md`/README for the updater, `docs/proofhub-integration.md` for ProofHub) first.

## Releasing

Before tagging, move the [CHANGELOG.md](CHANGELOG.md) `[Unreleased]` entries under a new `## [x.y.z] - YYYY-MM-DD` heading (leave a fresh empty `[Unreleased]` above it). The release workflow extracts that section by tag version and uses it as the GitHub release body, so a release without a changelog entry just falls back to a generic "see commit history" message.

See the [README](README.md#publishing-a-release) for the day-to-day `git tag` steps. The release workflow signs every build with a keypair generated via `tauri signer generate`; the private half lives only as the `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repo secrets (plus a backup the maintainer keeps outside the repo — never commit it). The public half is the `pubkey` in `src-tauri/tauri.conf.json`'s `plugins.updater` config, which is not secret and is what every installed copy of Chronos uses to verify an update before installing it.

If the private key is ever lost, generate a new pair, update the repo secrets and the `pubkey` in `tauri.conf.json`, and know that every previously-installed copy of Chronos will stop being able to verify new releases — they'd need a fresh manual install to pick up the new key.

The ProofHub plugin binary is signed with a **separate** keypair (`PLUGIN_SIGNING_PRIVATE_KEY` / `PLUGIN_SIGNING_PRIVATE_KEY_PASSWORD` repo secrets, public half embedded in `src-tauri/src/proofhub_plugin.rs`) so a compromise of one key can't be used against the other. Signing itself happens via `xtask/src/sign_plugin.rs` rather than the `rsign`/`minisign` CLIs, since those only accept the decryption password through an interactive TTY prompt, which CI doesn't have. See `docs/proofhub-integration.md` section 3.4 for the full rationale.

## Reporting bugs / suggesting features

Open a GitHub issue with steps to reproduce (for bugs) or the use case you're trying to solve (for features). Screenshots help.
