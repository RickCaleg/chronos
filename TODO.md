# TODO / Roadmap

Features under consideration, roughly in priority order. This is a living
document — update it as work happens (adjust notes, reorder, add/remove
items) rather than treating it as fixed. Once something ships, drop it from
here; the details live in [CHANGELOG.md](CHANGELOG.md) instead.

Keep new features in scope: local-first, no telemetry, fully keyboard-operable,
and simple — this is a manual time tracker, not a full Clockify clone (see
[CONTRIBUTING.md](CONTRIBUTING.md)).

## 1. System tray icon + global hotkey

Minimize to tray instead of quitting; a global keyboard shortcut starts/stops
the timer without focusing the window.

- Rust: `tauri::tray::TrayIconBuilder` for the icon/menu (Show/Hide, Start/Stop
  — dynamic label, Quit); `tauri-plugin-global-shortcut` for the hotkey.
- Override the window's close event (`on_close_requested` +
  `api.prevent_close()`) to hide instead of quit; only the tray's "Quit" (or
  an explicit shortcut) actually exits.
- Linux tray needs `libayatana-appindicator3-dev` at build time — already in
  `.github/workflows/release.yml`'s Linux deps from earlier prep.
- Must degrade gracefully where there's no tray protocol available (bare
  window managers without a status bar widget): app still works, hotkey
  still works, it just won't show an icon anywhere.
- Hotkey should probably be user-configurable in Settings, with a sane
  default (e.g. Ctrl+Alt+Space) that's unlikely to collide with WM bindings.

## 2. Start with system (minimized to tray)

A Settings toggle to launch Chronos on login, optionally starting hidden in
the tray rather than showing the window.

- Depends on #1 — starting minimized is only useful once there's a tray icon
  to bring the window back from.
- Use `tauri-plugin-autostart` (official plugin) rather than hand-rolling
  per-OS logic — it already covers Windows (registry Run key) and Linux
  (XDG autostart `.desktop` entry) autostart registration.
- "Start minimized" needs a launch flag/arg the app checks on startup to
  decide whether to call `window.show()` immediately or wait for the tray.

## 3. Reports tab (new top-level tab)

A new "Reports" entry in the top nav (alongside Timer/Projects/Settings):
totals per project over a date range (this week/last week/this month/custom),
reusing existing project colors and duration formatting.

- Pure aggregation over data that already exists — no new tracking mechanics.
- Consider a CSV export of the report, consistent with existing export
  patterns in Settings.
- Open question: does the weekly calendar view (#5) live as a second mode
  inside this same tab, or does it get its own nav entry? Leaning toward a
  view-switcher inside "Reports" to avoid crowding the top nav.

## 4. Search/filter in the records list

A filter bar above the records list: free-text (description/task), project,
and date range. Works alongside the existing day-grouping.

## 5. Weekly calendar/timeline view

A visual weekly grid (days as columns, entries drawn as blocks proportional
to their start/end time) for reviewing a week at a glance.

- The most expensive UI to build on this list — custom layout, not a
  reusable pattern from elsewhere in the app.
- See open question under #3 about where this lives in the nav.

## 6. Command palette (Ctrl+K)

A fuzzy-searchable modal listing available actions (start/stop timer, jump to
a view, new project, export backup, switch project, ...), reinforcing the
app's existing 100%-keyboard-operable design.

- Needs a small registry of "commands" (label, icon, handler) that both the
  palette and (eventually) any future keyboard-shortcut cheat sheet could
  share.

## 7. Tags

A second, cross-cutting categorization axis alongside projects.

- New SQL migration (never edit the existing ones — see CONTRIBUTING.md):
  `tags` table + `entry_tags` join table.
- UI: tag chips on entries; integrates with the search/filter in #4.
- `chronos-cli`'s schema mirror (`cli/src/db.rs::ensure_schema`) needs the
  same tables, idempotently, matching the existing dual-maintenance pattern.
- Lowest priority — project + alias/code + task already covers most
  categorization needs; only worth it if it turns out to be a real gap in
  practice.
