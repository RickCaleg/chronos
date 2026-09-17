# TODO / Roadmap

Features under consideration, roughly in priority order. This is a living
document — update it as work happens (adjust notes, reorder, add/remove
items) rather than treating it as fixed. Once something ships, drop it from
here; the details live in [CHANGELOG.md](CHANGELOG.md) instead.

Keep new features in scope: local-first, no telemetry, fully keyboard-operable,
and simple — this is a manual time tracker, not a full Clockify clone (see
[CONTRIBUTING.md](CONTRIBUTING.md)).

Shipped in 0.4.0: system tray + global shortcut, start-with-system
(minimized to tray), command palette, and tags.

## 1. Reports tab (new top-level tab)

A new "Reports" entry in the top nav (alongside Timer/Projects/Settings):
totals per project over a date range (this week/last week/this month/custom),
reusing existing project colors and duration formatting.

- Pure aggregation over data that already exists — no new tracking mechanics.
- Consider a CSV export of the report, consistent with existing export
  patterns in Settings.
- Open question: does the weekly calendar view (#3) live as a second mode
  inside this same tab, or does it get its own nav entry? Leaning toward a
  view-switcher inside "Reports" to avoid crowding the top nav.

## 2. Search/filter in the records list

A filter bar above the records list: free-text (description/task), project,
tag, and date range. Works alongside the existing day-grouping.

## 3. Weekly calendar/timeline view

A visual weekly grid (days as columns, entries drawn as blocks proportional
to their start/end time) for reviewing a week at a glance.

- The most expensive UI to build on this list — custom layout, not a
  reusable pattern from elsewhere in the app.
- See open question under #1 about where this lives in the nav.
