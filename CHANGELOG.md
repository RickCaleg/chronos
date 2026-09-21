# Changelog

All notable changes to Chronos are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]
### Added
- Chronos checks ProofHub on its own for sent entries that were deleted or changed there: when the app opens, and every 30 minutes while it's open, for the last 30 days. Such entries turn red without anyone clicking "Check". Only when the ProofHub plugin is connected. It's a few requests per run.
### Fixed
- Pressing Ctrl+Enter while editing (saving a note, a form in a popover, the command palette) also started an empty timer, or stopped the running one. The Ctrl+Enter timer shortcut now ignores keys typed in other fields. Enter in an empty timer field no longer starts a timer with no description either.

## [0.5.11] - 2026-09-21
### Added
- A summary strip above the list shows today's and this week's totals (the running timer included), with a "Commands (Ctrl K)" button and the manual entry button.
- The ProofHub tab lists every day of the last 30 with something unsent, with Send per day and "Send all". The ProofHub tab in the top menu shows how many are pending, from any screen. Alt+4 opens that tab.
- Manual entries: the "Manual entry" button in the summary strip (also "Add an entry by hand" in the command palette) adds a finished entry with its own start, end, task, project and tags. It's kept apart from the timer bar and doesn't affect a running timer or what's typed there. The start is pre-filled with the end of today's last entry, so a gap is filled in one step, and the end with the current time. `chronos-cli add` already did this.
### Changed
- The row actions (copy, delete, and the note button when there's no note) only appear on hover or keyboard focus, so the list no longer shows a column of identical icons. The ProofHub status icon is still always visible.
- Each day header has an always-visible ProofHub pill: "Send N" while something is unsent (red when something was deleted or changed in ProofHub), and a quiet "Sent" otherwise. Before, the send button only appeared on hover.
- The ProofHub tab is organized into sections (Sending, Project mappings, Options, debug log), with the connection status in the header. Disconnecting now asks first.
- Settings are grouped into Appearance, System, Integrations, and Data and backup. Language, theme and list grouping share one card.
- The timer's clock is dimmed while nothing is running.

## [0.5.10] - 2026-09-21
### Added
- A group of rows can be edited as a whole: clicking it opens an editor for the task/description, project and tags of every entry in it, and can also delete them all. Tags you add or remove there apply to all entries, and tags only some entries have are kept. Times stay per entry. `chronos-cli edit` takes several ids for the same kind of change, plus `--add-tags`/`--remove-tags`.
### Changed
- Clicking a group row now opens its editor. Expanding and collapsing it is done with the chevron.

## [0.5.9] - 2026-09-21
### Added
- "Check sent entries" in the ProofHub tab now also compares the other way. It lists your ProofHub entries in the mapped timesheets from the last 30 days that no Chronos entry was sent as (logged by hand there, or left over from an old send), and each can be deleted in ProofHub from there. Teammates' entries are ignored.
- A group row has its own note, editable inline like a single entry's, which sets the note of every entry in the group. When the entries' notes differ, the group row says so.
- A running timer can be discarded without being saved, from the trash button next to Stop, from the command palette, or with `chronos-cli discard`.
### Changed
- The ProofHub description now follows these rules. An entry with a note sends the note. Without a note, it sends nothing when the time is logged on a task, since ProofHub already shows the task, and the entry's name otherwise. With "group pushes by day" on, entries with the same note are summed together, and ones with a different note are sent separately.
- The "continue" (▶) button moved to the left of each row as a round, filled control. On the right it looked too much like the ProofHub send button.
- Confirmations (delete, reset, resend, discard…) are now shown inside Chronos instead of as system dialogs, with a button that names the action. Destructive ones start with Cancel focused. File pickers are still the system's.

## [0.5.8] - 2026-09-21
### Added
- Every entry can have a note about what was done, shown in small text under its row and edited right there, from the row's note button or by clicking the note. This works inside grouped rows too. When sending to ProofHub, the note is used as the description instead of the entry's name. With "group pushes by day" on, an entry with a note is sent on its own, and the entries without one are still summed together.
- Notes are included in exports: JSON backups and a new "Note" column at the end of the CSV, from both the app and `chronos-cli`. Both CSV importers read it back.
- `chronos-cli` now covers everything in the app that isn't desktop-only:
  - Tags: `--tags` on `start`/`add`/`edit`, `list --tag`, and a `tags` command (list, add, rename, remove).
  - Notes: `--note` on `start`/`add`/`edit`.
  - `restart` continues an existing entry, like the app's ▶ button.
  - `list --summary` prints the app's "copy day" text.
  - `edit --start` works on the running entry.
  - `list` shows tags and notes.
### Fixed
- `chronos-cli` JSON backups lost data: the tags, and the record of what was already sent to ProofHub. Importing a backup through the CLI dropped both, and restoring one made the app offer to send everything again. Both now round-trip, and `reset` also erases tags.
- Editing or deleting an entry through `chronos-cli` didn't mark it (or the rest of its grouped push) for resending to ProofHub like the app does. It now does.
- Automatic backups left out the tag list, so restoring one removed every tag from the restored entries. Automatic backups now include tags, like manual ones, and restoring an older automatic backup rebuilds the tags from its entries.
- Editing a sent entry (description, times, project) didn't show it as needing a resend until Chronos was restarted. It now does right away.

## [0.5.7] - 2026-09-21
### Added
- Chronos can now check ProofHub for entries deleted or changed there by hand, which it had no way of knowing about. Use the new check button in a day's header, "Check" in an entry's edit popup, or "Check sent entries" in the ProofHub tab (last 30 days). An entry deleted in ProofHub then shows a red send icon, and one with other hours or another date shows a red update icon. The day's send button also picks them up. Checks only run when you ask.
- An entry's edit popup has a ProofHub section showing its status in words, with Send/Send again, Check, and "Forget it was sent" (Chronos treats it as never sent, without touching ProofHub).
### Changed
- The ✓ on a sent row or day now turns into a resend icon on hover, so it's clear that it can be clicked to send again.
- A collapsed group of rows now always shows the ProofHub button. Before, it only did with "group pushes by day" on, so with it off you had to expand the group to send or resend.
### Fixed
- Editing a stopped entry while another timer was running: typing in the start (or end/duration) field sent the text to the description instead. The edit popup jumped focus back to its first field on every tick of the running timer; it now focuses it only when it opens.

## [0.5.6] - 2026-09-19
### Fixed
- Every launch opened a new Chronos instance with its own tray icon, piling up on Linux (seen on Omarchy). Only one instance runs now; launching it again just brings the existing window to the front (the autostart's `--minimized` launch stays hidden).
- AppImage looking too small on Omarchy/Hyprland with a fractional monitor scale (e.g. 1.6). Omarchy leaves XWayland unscaled and relies on the integer `GDK_SCALE`, which the 0.3.3 fix stripped. On Hyprland with `xwayland:force_zero_scaling`, `GDK_SCALE` is now kept and the fractional remainder (monitor scale ÷ `GDK_SCALE`) is applied as webview zoom.

## [0.5.5] - 2026-09-18
### Changed
- Reworked ProofHub sending around one consistent model (see `docs/proofhub-integration.md` §8). Each row and each day's button send whatever isn't in ProofHub yet, and with "group pushes by day" on, a group is always sent with its full total.
- The ✓ on an already-sent row or day is now clickable and sends it again. Entries deleted in ProofHub are recreated, and changed ones are overwritten.
- Task linking is now a single switch per project ("log time on the task by its #number") and finds the task in any of the project's task lists, instead of requiring one list to be picked.
- Sending a day is faster: no fixed delay between entries, and ProofHub rate limits are waited out only when actually hit.
### Fixed
- Resending an entry whose ProofHub entry had been deleted there failed. It's now recreated.
- With grouped pushes, editing one entry of an already-sent group and resending it overwrote the group's ProofHub total with that single entry's hours, and a new same-task entry on the same day was sent as a separate ProofHub entry instead of joining its group's total.
- Switching "group pushes by day" on or off, or re-mapping a project to another timesheet, could leave the old ProofHub entries behind and count those hours twice. The old entries are now removed when the day is resent.
- Deleting one entry of a grouped push left the ProofHub total including its time. The rest of the group is now marked for resending.
- A task created in ProofHub after Chronos was opened wasn't found until a restart.
- "Send day" failures now say what went wrong instead of only how many failed.

## [0.5.4] - 2026-09-18
### Fixed
- The ProofHub plugin never updated along with the app: after an auto-update the old plugin kept running, which broke 0.5.3's task linking with "task wasn't found in the configured task list" (the older plugin didn't return the task's ticket number). The plugin is now automatically brought to the same version as Chronos on launch, and a mismatched plugin is never run.

## [0.5.3] - 2026-09-18
### Added
- Optional "group pushes by day": sums same-task/description/project entries into one ProofHub push instead of one per Chronos entry.
- A "Debug log" in the ProofHub tab showing the exact request/response of the last ProofHub call, for diagnosing pushes that don't behave as expected.
### Fixed
- Task-level linking was silently dropped on every re-push ("out of sync" retry) — the plugin's update-entry action never actually read the task/list id fields the app was already sending.
- ProofHub responses that fail with an HTTP 200 and `success: false` in the body (confirmed for a bad API key) were being treated as successful pushes.
- Task-level linking never actually worked: the task number typed in Chronos (ProofHub's `ticket` field) was sent straight through as the API's `task_id`, but those are different, unrelated numbers. Now resolved from `ticket` to the real `id` before every push.

## [0.5.2] - 2026-09-18
### Changed
- ProofHub now gets its own top-level tab (once installed) instead of living inside Settings, and its remote project/timesheet/task-list data is cached instead of refetched on every visit.
### Fixed
- Settings feeling extremely slow on Windows due to the ProofHub plugin binary flashing a console window on every spawn.

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
