# Changelog

All notable changes to Chronos are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.5.1] - 2026-09-18
### Added
- `packaging/appimage/install.sh` — downloads the AppImage, sets up a `.desktop` entry + icon so it shows up in your app launcher. See the README's Installing section.
### Changed
- ProofHub task-level linking is now per-entry (via each entry's own `#task-number`) instead of one fixed task per project mapping, and the "create a timesheet" convenience button was removed.
### Fixed
- In-app updates failing with a confusing "Failed to install package" on Linux installs other than the AppImage (.deb/.rpm/AUR) — self-update only works for AppImage; other installs now get a link to the releases page instead.
- The AppImage crashing on launch (blank window) with "Could not create default EGL display: EGL_BAD_PARAMETER" on hosts with a newer Mesa than what linuxdeploy bundled — a few over-bundled system libraries are now stripped and the AppImage re-signed as part of the release build.

## [0.5.0] - 2026-09-17
### Added
- Optional ProofHub integration: install a signed companion plugin from Settings to push logged hours into ProofHub projects/timesheets. Off and invisible until installed — see `docs/proofhub-integration.md`.
- Per-entry "send to ProofHub" and a "send day" batch action once a project is mapped.
- Optional per-project linking to a specific ProofHub task, and a distinct "out of sync" status after editing an already-sent entry.

## [0.4.0] - 2026-09-17
### Added
- Optional automatic backups to a folder of your choice, with a configurable schedule and retention count.
- System tray icon, with a configurable global shortcut to start/stop the timer from anywhere. Closing the window now minimizes to the tray instead of quitting.
- Optional "start with system" (minimized to tray).
- Command palette (`Ctrl+K`) for quick access to common actions.
- Tags — a second, freeform label on entries alongside projects, with autocomplete.
### Fixed
- "Today" sorting last in the records list when it had no finished entries yet (only a running timer).

## [0.3.7] - 2026-09-17
### Fixed
- The AUR `PKGBUILD` (`packaging/aur/`) reliably failed to build under `makepkg` specifically (never with a plain `cargo`/`npm` toolchain): `makepkg.conf`'s injected `RUSTFLAGS` (debug-info/frame-pointer flags, for its automatic debug-package splitting) and LTO-enabled `LDFLAGS`/`CFLAGS`/`CXXFLAGS` broke linking of any binary here that embeds bundled SQLite (the app itself, `sqlx-macros`, and `chronos-cli`), producing `undefined symbol` errors for basic SQLite functions. The 0.3.5/0.3.6 `sqlx`/`libsqlite3-sys` version bumps were real fixes for a related but different bug — this was the actual cause of builds still failing afterward. The `PKGBUILD` now unsets those variables for its build steps.
- A `package()` bug in the same `PKGBUILD` (missing `mkdir` before extracting the bundled `.deb`) that would fail even after the build itself succeeded.
- Switched `PKGBUILD`'s source from a GitHub-generated tarball to a git clone pinned to the release tag, since GitHub doesn't guarantee those tarball checksums stay stable and a downloaded release archive could otherwise carry a stale copy of packaging fixes made after that tag existed.

This release contains no app code changes — 0.3.6's functionality is identical — it exists solely so the current release has a working `PKGBUILD` bundled in it.

## [0.3.6] - 2026-09-17
### Fixed
- From-source Linux builds could still fail to link with `undefined symbol: sqlite3_unlock_notify`, even with the 0.3.5 fix in place. Updated `sqlx` to 0.8.6 (pulling in `libsqlite3-sys` 0.30.1) and `rusqlite` to 0.32.1 to match.

## [0.3.5] - 2026-09-16
### Fixed
- Attempted fix for the `sqlite3_unlock_notify` linking issue (see 0.3.6 for the actual fix) by adding `libsqlite3-sys`'s `unlock_notify` feature alongside `bundled`. Necessary but not sufficient on its own.

## [0.3.4] - 2026-09-16
### Fixed
- Attempted fix for the `sqlite3_unlock_notify` linking issue by also forcing `libsqlite3-sys`'s bundled feature under `[build-dependencies]` (superseded by the real fix in 0.3.6 — this alone wasn't sufficient).

## [0.3.3] - 2026-09-16
### Fixed
- AppImage builds appearing roughly 2x too large on Omarchy/Hyprland (and other fractional-scaled Wayland compositors). The AppImage bundler forces `GDK_BACKEND=x11` to dodge an unrelated Wayland webview crash; under XWayland, `GDK_SCALE` stacks with the compositor's own auto-scaling for non-native clients. Now stripped when that x11 override is active.
### Added
- Documented installing on Arch Linux via the in-repo AUR `PKGBUILD` directly (`makepkg -si`), since AUR registration is temporarily closed.

## [0.3.2] - 2026-09-16
### Fixed
- Editing the description/task while a timer was running didn't visually update the field (it updated the database but not the on-screen value, and could drop fast keystrokes).
### Added
- The current day's total now always includes the running timer's elapsed time, updating live.
- A copy button on each day's header (visible on hover/focus) that copies a plain-text summary of that day's entries.

## [0.3.1] - 2026-09-16
### Fixed
- Clean/from-scratch builds failing to link against the system SQLite (`undefined symbol: sqlite3_unlock_notify`) by forcing `libsqlite3-sys`'s `bundled` feature.
### Added
- `bundle.category` set in `tauri.conf.json` so the generated Linux `.desktop` file gets a proper freedesktop category.
- Initial AUR packaging (`packaging/aur/PKGBUILD`).

## [0.3.0]
### Added
- Auto-updates: Chronos checks GitHub Releases for new versions and can download/install them in-app.
- Merged task-number + description into a single field with live `#` detection and autocomplete (selecting a suggestion also fills in the project).
- A play/restart button on each history row to start a new timer from an existing entry.
### Fixed
- The running timer's elapsed counter not resetting after stopping.
- The entry edit popover rendering underneath the top bar.

## [0.2.0]
### Added
- `chronos-cli`, a standalone command-line companion for terminal use, scripted backups, and integrating Chronos into window-manager/Omarchy status bars. See `docs/CLI.md`.

## [0.1.0]
- First release: manual time tracking with start/stop and editable start/end/duration, projects, CSV/JSON import and export, English and Portuguese (pt-BR) localization, light/dark/Omarchy theming, and full keyboard operability.
