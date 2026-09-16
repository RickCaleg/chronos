# Chronos

A manual time tracker for people who just want to press play, work, and press stop — 100% local, offline, and open source. Built as a lightweight alternative to Clockify for people who don't need a team dashboard, just an honest log of their own time.

[![CI](https://github.com/RickCaleg/chronos/actions/workflows/ci.yml/badge.svg)](https://github.com/RickCaleg/chronos/actions/workflows/ci.yml)
![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows-lightgrey)

## Features

- **Manual timer** — description, optional task number, project, play/stop. Nothing automatic, nothing guessed.
- **Edit time freely** — change the start time while the timer is running, or the start, end, and/or total duration after it's stopped. Editing duration keeps the start fixed and recalculates the end (and vice versa), matching the convention most time-tracking tools use.
- **Plain-text date/time editing** — no calendar widgets. Type `2026-01-31 14:30:00`, or just `14:30` to change the time and keep the same day.
- **Projects with color and a short code** — give a project a code (e.g. `MRK`) and it shows as `MRK - Project Name` everywhere.
- **Paste autofill** — paste `#1234 - MRK - Fix login bug` into the task or description field and it splits into task, project, and description automatically. The same rule applies when importing CSVs.
- **Group similar entries** — entries with the same task, description, and project on the same day collapse into one row with a total, expandable to see each session.
- **Import / export** — full JSON backup, CSV export/import, and a dedicated Clockify CSV importer (matches Clockify's pt-BR export columns and applies the same paste-autofill rule to fill in task/project when they're embedded in the description).
- **Fully keyboard-driven** — `Ctrl+Enter` starts/stops the timer, `Alt+1/2/3` switches tabs, `Enter` saves in editors, `Esc` closes popovers, arrow keys navigate autocomplete.
- **Bilingual** — English and Portuguese (pt-BR), switchable in Settings.
- **Theme-aware** — light, dark, follows the OS, or (on Linux) follows your [Omarchy](https://omarchy.org) theme live.
- **Native by platform** — native title bar on Windows, native GTK decorations on Linux desktop environments, no title bar at all under a standalone window manager (Hyprland, sway, i3, ...).
- **Your data stays yours** — a local SQLite database, no network calls, no telemetry, no account.

## Tech stack

[Tauri 2](https://tauri.app) (Rust) · [React 19](https://react.dev) + TypeScript · [Tailwind CSS 4](https://tailwindcss.com) · SQLite · [Zustand](https://github.com/pmndrs/zustand) · [i18next](https://www.i18next.com)

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org) 20+
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- The platform dependencies for [Tauri 2](https://tauri.app/start/prerequisites/) (on Linux, this is mainly `webkit2gtk` and friends — the linked page has the exact package names per distro)

### Development

```sh
npm install
npm run tauri dev
```

### Building a release binary

```sh
npm run tauri build
```

The installer/binary is produced under `src-tauri/target/release/bundle/`.

### Publishing a release

Pushing a tag matching `v*` (e.g. `v0.1.0`) triggers the [release workflow](.github/workflows/release.yml), which builds installers for Linux and Windows and attaches them to a **draft** GitHub release for review before publishing:

```sh
git tag v0.1.0
git push origin v0.1.0
```

## Data & backups

Everything lives in a local SQLite database (in the OS's standard app-data directory — nothing is ever synced or uploaded). Use **Settings → Data** to:

- Export a full JSON backup (and import it back on any machine)
- Export/import entries as CSV
- Import directly from a Clockify CSV export
- Erase everything and start fresh

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for how to set up the project and what to keep in mind before opening a PR.

## License

[MIT](LICENSE)
