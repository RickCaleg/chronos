# ProofHub integration — design & implementation plan

Status: **planning only, nothing implemented yet.** This document is the
detailed design for an optional "plugin" that pushes logged Chronos time
entries into ProofHub projects/tasks. It exists so implementation can proceed
in reviewable phases without re-deriving the ProofHub API shape or the
security tradeoffs each time.

## 1. Goal and scope

Let a user who tracks time in Chronos send finished entries to ProofHub
without leaving the app or re-typing anything. Scope is deliberately
one-directional and manual-first, consistent with Chronos being a *manual*
tracker:

- **Chronos → ProofHub only.** No pulling ProofHub tasks/comments back into
  Chronos beyond what's needed to populate pickers (project/task lists for
  mapping). No two-way sync, no conflict resolution.
- **User-triggered pushes, not automatic.** Matches how Chronos treats every
  other write today (starting/stopping timers, saving edits) — nothing
  happens to a user's ProofHub account without an explicit click.
- **Opt-in and invisible when off.** A user who never enables it should see
  no new UI, no extra settings clutter, no network calls, no extra rows in
  exports.

This is the second deliberate exception to "local-first, no telemetry" after
the GitHub-releases updater (documented in `CONTRIBUTING.md`) — it must be
presented the same way: off by default, one clear toggle, and a documented
statement of exactly what leaves the device and to where.

## 2. ProofHub's actual API (researched, not assumed)

This section exists because the naive assumption — "POST hours to a task
ID" — is wrong, and finding that out during implementation would mean
redesigning the data model mid-flight. All of this is from ProofHub's
official public API docs (`github.com/ProofHub/api_v3`) and their help
center; the older `api_v1` repo exists but is superseded and unused here.

### 2.1 Access and auth

- REST/JSON API, versioned in the URL path: **`v3`**.
- Base URL is **per-account**: `https://{companyurl}.proofhub.com/api/v3/`.
  Chronos needs the user's ProofHub subdomain, not just a key — this is a
  second required field, not optional.
- Auth is a per-user API key sent as an `X-API-KEY` header. Every logged-in
  ProofHub user can self-generate one from their profile icon → **"API
  access"** (no admin/paid-tier gate found).
- Two more headers are mandatory on every request or ProofHub rejects them:
  - `User-Agent: Chronos (richardson.saconi@outlook.com)` (or similar) — a
    request without one gets `400`.
  - `Content-Type: application/json` on `POST`/`PUT` — missing it gets `415`.
- Resetting the key in ProofHub's UI invalidates the old one immediately,
  with no warning to connected apps. Chronos must treat `401`/`403` as "the
  key is dead, ask the user to reconnect," not as a transient error to retry.

### 2.2 Resource hierarchy

ProofHub's hierarchy is **project → todolist → task**, and — this is the
part that changes the design — **time entries are not attached to a task
directly**. They're attached to a **timesheet**, a separate resource that
lives under a project (a time-tracking "bucket," e.g. one per project, or
one per deliverable). A timesheet has its own title/estimate/assignees.

| Resource | Endpoint (relative to base URL) |
|---|---|
| List projects | `GET /projects` |
| List task lists in a project | `GET /projects/{projectId}/todolists` |
| List tasks in a task list | `GET /projects/{projectId}/todolists/{todolistId}/tasks` |
| List timesheets in a project | `GET /projects/{projectId}/timesheets` |
| Create a timesheet | `POST /projects/{projectId}/timesheets` |
| List time entries in a timesheet | `GET /projects/{projectId}/timesheets/{timesheetId}/time` |
| **Create a time entry** | `POST /projects/{projectId}/timesheets/{timesheetId}/time` |
| Update / delete a time entry | `PUT`/`DELETE /projects/{projectId}/timesheets/{timesheetId}/time/{timeId}` |
| List people | `GET /people` |

**Creating a time entry** (`POST .../time`) body:

```json
{
  "project": "123",
  "timesheet_id": "456",
  "logged_hours": 1,
  "logged_mins": 30,
  "date": "2026-09-17",
  "status": "billable",
  "description": "Chronos: fix login redirect",
  "list_id": "789",
  "task_id": "321"
}
```

- Required: `project`, `timesheet_id`, and at least one of
  `logged_hours`/`logged_mins`.
- `status` is `"billable"` or `"none"`.
- Task-level attribution is **optional and two-part**: `task_id` only takes
  effect together with `list_id` (the todolist it belongs to). Without
  both, the entry still logs against the project/timesheet, just without a
  task link — this is an acceptable degraded mode, not a failure.

**Practical consequence for Chronos's design**: pushing one entry is a
3-hop lookup plus one write — resolve the ProofHub project → resolve (or
create) a timesheet inside it → optionally resolve a todolist+task for
task-level linking → `POST .../time`. The mapping Chronos stores per
project must therefore hold a **timesheet id**, not just a project id.

### 2.3 Rate limits

**25 requests / 10 seconds** per account+IP (from the official README). Over
that, ProofHub returns `429` with a `Retry-After` header. Batch pushes (see
§7.2) must serialize requests with a small delay and honor `Retry-After` on
a `429` rather than hammering it — at 25/10s a day's worth of entries (a
handful) will never realistically hit this, but a "push everything since I
started using Chronos" bulk backfill could.

### 2.4 What's not there

- **No webhooks.** Confirmed absent from the official docs — any sync stays
  one-way and pull-free; nothing to design around for ProofHub-initiated
  events.
- **No official SDK or maintained client library** in any language, and no
  public Postman collection. Chronos calls the REST endpoints directly;
  there's no wrapper crate to depend on.
- **CORS is a non-issue**, because these calls belong in the Rust backend
  (a new `#[tauri::command]`, the same shape as the existing updater's
  GitHub Releases call), never in the webview's JS context.

## 3. Data model changes

Two additions, kept intentionally small — every schema change here has to
be mirrored in both `src-tauri/src/lib.rs` migrations and
`cli/src/db.rs::ensure_schema` per `CONTRIBUTING.md`, so minimizing surface
area minimizes that duplicated upkeep.

### 3.1 New migration (version 4): sync tracking on `time_entries`

```sql
ALTER TABLE time_entries ADD COLUMN proofhub_time_entry_id TEXT;
ALTER TABLE time_entries ADD COLUMN proofhub_synced_at TEXT;
```

Both nullable, both `NULL` until a push succeeds. `proofhub_time_entry_id`
is what ProofHub's API hands back on a successful `POST .../time` — storing
it is what makes "already synced" a real fact instead of a guess, and is
also what a future "undo"/`DELETE` would need. `proofhub_synced_at` drives
the sync-status badge (§7) and lets an edit made *after* a push visibly
fall out of sync (see §7.3).

Mirror in `cli/src/db.rs::ensure_schema` with the same
`pragma_table_info`-guarded `ALTER TABLE ... ADD COLUMN` pattern already
used there for `projects.alias` — the CLI never populates or reads these
columns, this is purely to keep the schema shape consistent for a database
the CLI might create first.

### 3.2 No new tables — reuse the existing (currently unused) `settings` table

`src-tauri/src/lib.rs` migration 1 already created a generic
`settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)` table that nothing in
the codebase reads or writes today. That's exactly the shape needed for
the ProofHub project/timesheet mapping — small, low-cardinality (bounded by
the user's own project count), and not "tracked data" in the sense that
tags or entries are. Proposed keys (all JSON-encoded values):

| key | value shape |
|---|---|
| `proofhub.enabled` | `"true"` / `"false"` |
| `proofhub.subdomain` | `"acmecorp"` |
| `proofhub.projectMap` | `{"<chronosProjectId>": {"proofhubProjectId": "123", "timesheetId": "456", "timesheetTitle": "Chronos time", "defaultBillable": true, "todolistId": "789"}}` |

Why not a dedicated `proofhub_project_map` table: it would need its own
migration and its own CLI mirror for something that is genuinely
app-configuration, not user time-tracking data — the `settings` table
exists for precisely this and using it avoids schema growth for no benefit.

**This table is deliberately excluded from backups.** Both
`exportJsonBackup()` (`src/lib/exportImport.ts`) and `performAutoBackup()`
(`src/lib/autoBackup.ts`) already do targeted `SELECT`s (`listProjects`,
`listEntries`, `listTags`) rather than dumping the whole database — neither
touches `settings`, so nothing here needs to change to keep the mapping out
of backup files. This is a property to preserve, not just a coincidence:
losing the mapping on restore is an acceptable, easily-redone inconvenience;
leaking it would not be (see §4 for why the API key specifically must never
land here at all).

### 3.3 A new `src/db/proofhubSettings.ts` module

Thin `get`/`set` wrapper around `SELECT/INSERT OR REPLACE INTO settings`,
JSON-encoding/decoding the values above. No new Zustand store is strictly
required — a `useProofHubStore` mirroring `useAutoBackupStore`'s shape
(hydrate on load, one setter per field) is still the right call for
consistency with how every other cross-cutting setting in the app works,
just backed by this DB module instead of `localStorage` for the
non-secret fields.

## 4. Credential storage — where the API key actually lives

This is the one piece of this feature that isn't "make it work," it's
"make it work without creating a new way to leak a credential." Two
existing facts make the naive approach unsafe:

- Every other Chronos setting lives in `localStorage`, which is trivially
  readable by anything with local access and is not designed to hold
  secrets.
- The `settings` SQLite table (§3.2) is a reasonable home for the
  *mapping*, but the app's DB file itself has no encryption at rest, and a
  user could reasonably copy/back up their `chronos.db` file by hand
  (outside Chronos's own export flow) without realizing it now contains a
  live API credential.

The API key must live somewhere that is (a) never touched by any export or
backup code path, and (b) not plaintext-readable by a casual `cat`.

### 4.1 Options considered

**A — OS keychain (Rust `keyring` crate)**, wrapping macOS Keychain,
Windows Credential Manager, and Secret Service/libsecret on Linux. This is
the textbook-correct answer and what most desktop CLI tools do (`gh`,
`git-credential-manager`, etc.). The problem is specifically *this
project's own distribution channel*: Chronos ships via AUR to minimal
window-manager Linux setups (Hyprland/Omarchy, the maintainer's own
environment), where a Secret Service provider (`gnome-keyring`,
`kwallet`, `keepassxc`) is often not running by default. `keyring` calls
fail outright on a machine with no Secret Service daemon — the exact kind
of native-dependency fragility this project already spent several releases
fighting (`libayatana-appindicator`, bundled SQLite linking under
`makepkg`). Adopting it as the *only* path risks reproducing that pattern.

**B — `tauri-plugin-stronghold`**, the official encrypted-vault plugin.
Cross-platform, no OS keychain daemon dependency, but its vault is unlocked
with a password — meaning either the user types a master password (bad UX
for a single API key) or Chronos derives one silently, which is most of the
complexity of option C without option C's simplicity.

**C — A local encrypted file**, outside the SQLite DB and outside
`localStorage`, e.g. `proofhub-credentials.enc` in the same Tauri app-config
directory the DB already lives in (`~/.config/com.richardson.chronos/` on
Linux). Encrypted with a key that itself lives in a sibling file with
restrictive permissions (`0600`, Unix; default ACL is fine on Windows since
it's already scoped to the user profile). This defends against exactly the
realistic threats here — accidental inclusion in a backup/export, a casual
`cat` of a config directory, syncing `~/.config` into a cloud-synced dotfiles
repo — without depending on a Secret Service daemon existing.

### 4.2 Recommendation

**Ship C for v1**, then offer A as an **optional upgrade in a later phase**,
detected at runtime: if `keyring` can successfully read/write a test entry
on this machine, offer a one-time "use your system keychain instead" switch
in Settings; otherwise stay on the encrypted file with no error shown to
the user (this should never be a hard failure — it's a nice-to-have, not a
requirement). This mirrors the two-tier fallback pattern several other
cross-platform CLI tools use for exactly this reason, and avoids adding a
new native dependency (and a new AUR `depends=()` entry to babysit) before
it's proven necessary.

Implementation shape for C: a `#[tauri::command] proofhub_save_credentials`
and `proofhub_load_credentials` pair in Rust, using a small symmetric cipher
(`aes-gcm` crate is fine, already a transitive dependency family via other
Tauri plugins) keyed by 32 random bytes generated once on first save and
written to a sibling file with `0600` perms. This is deliberately *not*
"perfect" security — a determined local attacker with filesystem access as
the same user can already read anything Chronos itself can read, same as
every other desktop app's local credential storage — it is specifically
scoped to stop the credential from silently riding along in a JSON backup,
a cloud-synced folder, or a support screenshot of `chronos.db`'s contents.

The API key **never** enters `src/db/proofhubSettings.ts`, the `settings`
table, `localStorage`, or any Zustand store's persisted state — it's fetched
into memory only when a push is about to happen, entirely on the Rust side,
and the frontend never receives it back (write-only from the JS
perspective: "save this key," never "give me the key").

## 5. Settings UX — the "plugin" surface

New collapsible section in Settings, placed after "Startup & shortcuts,"
titled **"Integrations."** ProofHub is the only entry; the section itself
is written generically enough that a second integration wouldn't need a
restructure, but nothing generic is built ahead of that actually happening
(no plugin-registry abstraction for a population of one).

1. **Off state (default):** a single `Switch`, "Enable ProofHub
   integration," off. Nothing else renders. The React component for
   everything below this point is lazy-loaded (`React.lazy`) so its code
   isn't even in the bundle path a non-user hits.
2. **On, not yet connected:** two fields — "ProofHub subdomain" (with a
   hint: "the part before `.proofhub.com` in your ProofHub URL") and "API
   key" (password-masked `Input`, with a link to ProofHub's own "API
   access" profile page for where to find it). A "Test & connect" button
   calls `GET /projects` with the given credentials; success stores them
   (§4) and reveals step 3, failure shows the raw HTTP status inline
   ("401 — check your API key," "Couldn't reach `{subdomain}.proofhub.com`
   — check the subdomain").
3. **Connected — project mapping table:** one row per non-archived Chronos
   project, each with:
   - A dropdown of ProofHub projects (from the `GET /projects` call already
     made).
   - A dropdown of that ProofHub project's timesheets (`GET
     /projects/{id}/timesheets`, fetched on ProofHub-project selection), plus
     a **"Create 'Chronos time' timesheet"** button that does the `POST` for
     the common case of a user who hasn't set one up.
   - An optional todolist+task pair, for users who want task-level
     attribution — a nested "Link to a specific task" disclosure, since most
     users will be fine logging at the project/timesheet level.
   - A default billable toggle (billable/none), applied as the default on
     every push from that project, overridable per push (§7).
   Chronos projects with no mapping set are simply not pushable — their
   entries show no sync affordance in the Records view at all, so a
   half-configured integration doesn't clutter unrelated projects.
4. **A "Disconnect" action** that deletes the stored credential (§4) and the
   `proofhub.*` settings keys, and flips the enable switch off. This does
   **not** touch `proofhub_time_entry_id`/`proofhub_synced_at` on already-
   pushed entries — that history is harmless local metadata once
   disconnected, consistent with not deleting user data as a side effect of
   an unrelated action.

## 6. Chronos → ProofHub entity mapping

| Chronos concept | ProofHub concept | Notes |
|---|---|---|
| Project | Project + Timesheet | A Chronos project maps to one ProofHub project **and** one timesheet inside it (§2.2) — both are stored per mapping. |
| Task number / description | Time entry `description` | Chronos already merges these into one field in the UI; sent verbatim as the entry's description, prefixed with nothing special (no forced "Chronos:" tag, keep it clean — the user can already see it came from Chronos via `list_id`/`task_id` if task-linked). |
| Tags | *(not sent)* | ProofHub time entries have no tag concept; tags stay Chronos-only metadata. Revisit only if a real need shows up — no speculative mapping. |
| Start/end time | *(not sent, only duration)* | ProofHub's time-entry model is duration-based (`logged_hours`/`logged_mins` + a `date`), not start/end timestamps — Chronos computes the duration from its own `duration_seconds` and floors/rounds to whole minutes. |
| Duration | `logged_hours` + `logged_mins` | Converted from `duration_seconds`. |
| Entry's calendar day | `date` | `YYYY-MM-DD`, from the entry's local start time. |
| (mapping's default) | `status` (billable/none) | Per-project default, overridable per push. |
| task_number match (optional) | `list_id` + `task_id` | Best-effort only if the project mapping has task-level linking configured (§5.3) — never required for a push to succeed. |

## 7. Push UX

### 7.1 Per-entry manual push

Every finished (non-running) entry whose project has a ProofHub mapping
gets a small sync-status affordance in `EntryRow`/`GroupedEntryRow`, next to
the existing tag chips:

- **Unsynced:** a subtle "send" icon button, `title="Send to ProofHub"`.
  Click → pushes just that entry, on success sets
  `proofhub_time_entry_id`/`proofhub_synced_at` and swaps the icon to a
  filled checkmark.
- **Synced:** a filled checkmark, `title="Synced to ProofHub on {date}"`.
  Not clickable by default (re-push would create a duplicate ProofHub time
  entry — ProofHub has no natural dedupe key beyond the id it assigns).
- **Error:** a small warning icon after a failed push, `title` showing the
  reason (auth vs. network vs. validation), clickable to retry.

### 7.2 Batch push (per day)

The day-group header already has a copy-to-clipboard button
(`RecordsView.tsx`); add a matching **"Send day to ProofHub"** button next
to it, visible only if at least one unsynced, mapped entry exists that day.
Clicking shows a confirmation summary first (「Send 3 entries, 4h 15m total,
across 2 projects」) before firing requests sequentially with a small
delay between them (§2.3's rate limit), showing a progress count and
continuing past individual failures rather than aborting the whole batch —
each entry's own row reflects its own final status per §7.1 either way.

No "send week" / "send everything" bulk action in v1 — a day's worth is the
natural unit given Chronos's own day-grouped UI, and a full-history
backfill is a rare, one-time action better done by repeatedly using the
per-day button than by building a separate bulk-sync screen for a not
demonstrated need.

### 7.3 Edits after a push

Editing an already-synced entry (via `EntryEditPopover`) does **not**
auto-repush. It clears `proofhub_synced_at` (but keeps
`proofhub_time_entry_id`) and the row's badge changes to a distinct
"out of sync" state (e.g. checkmark with a small dot) — clicking it now
does a `PUT` (update) against the stored `proofhub_time_entry_id` instead of
a `POST`, since ProofHub already has a matching entry. Deleting a
Chronos entry that was previously synced does **not** delete it from
ProofHub automatically — Chronos has no reliable way to know that's
actually wanted, and silently deleting data in a third-party system the
user didn't directly act on inside that system is out of scope; at most,
surface a one-time toast noting the entry existed on ProofHub too.

### 7.4 No auto-push on stop

Deliberately not building an "automatically send every entry to ProofHub
the moment I stop the timer" mode for v1. It's the most surprising option
for a tool whose entire identity is "manual, you're always in control," and
it removes the moment where a user would naturally catch a
wrong project/description before it leaves the device. Worth revisiting
only if real usage of the manual/batch flow shows people want it — not
worth speculatively building now.

## 8. Error handling

| Condition | Behavior |
|---|---|
| `401`/`403` (bad/reset key) | Mark integration "disconnected" in the UI (distinct from the user-initiated Disconnect in §5.4 — same state, different entry point), surface "Your ProofHub connection needs to be reconnected" with a direct path back to Settings. Stop attempting further pushes until reconnected. |
| `429` (rate limit) | Honor `Retry-After`; in a batch push, pause and resume rather than failing the remaining entries. |
| `4xx` validation (e.g. missing/invalid `timesheet_id` because it was deleted on the ProofHub side after mapping) | Surface the specific field/message ProofHub returns; point back to the project mapping in Settings to fix it. |
| Network failure (offline, DNS, timeout) | Treat as retryable; leave the entry's status as unsynced (never invent a fake "synced" state on ambiguous failure — if the request's success is unknown, the entry is treated as still needing a push, since a false "unsynced" is a re-click, while a false "synced" is a silently missing hour in ProofHub). |
| ProofHub returns a `201` but the local DB write fails right after (e.g. disk full) | Rare, but: the push already happened on ProofHub's side. Log this distinctly so a support conversation can tell "never sent" from "sent but not recorded locally" apart — don't silently swallow it as a generic failure, since retrying would double-log the hours. |

## 9. Architecture / file layout

Kept in its own directory on both sides so the "opt-in plugin" framing is
also true of the source tree, not just the UI — easy to audit, easy to
rip out if it doesn't pan out:

- **Rust:** `src-tauri/src/proofhub.rs` — the HTTP client (using the
  `reqwest` crate, a new dependency; nothing existing in this codebase
  makes outbound HTTP calls from Rust today apart from the updater plugin's
  own internal client, which isn't reusable here), the credential
  encrypt/decrypt commands from §4.2, and the `#[tauri::command]` functions
  the frontend calls (`proofhub_test_connection`, `proofhub_list_projects`,
  `proofhub_list_timesheets`, `proofhub_create_timesheet`,
  `proofhub_list_todolists`, `proofhub_list_tasks`, `proofhub_push_entry`,
  `proofhub_save_credentials`, `proofhub_load_credentials`,
  `proofhub_clear_credentials`). Registered in `lib.rs`'s
  `invoke_handler!` alongside the existing tray/shortcut commands.
- **React:** `src/integrations/proofhub/` — `ProofHubSettings.tsx` (§5,
  lazy-loaded), `useProofHubStore.ts` (non-secret settings, §3.3),
  `syncBadge.tsx` shared by `EntryRow`/`GroupedEntryRow` (§7.1), and the
  day-header "Send day" button's logic (§7.2). `src/db/proofhubSettings.ts`
  stays under `db/` alongside the other DB modules for consistency with
  `db/tags.ts`, `db/projects.ts`, etc.
- **New capability entries** in `src-tauri/capabilities/default.json`: none
  expected — the HTTP calls happen entirely in Rust command handlers, not
  via a JS-side `@tauri-apps/plugin-http` capability, so there's no new
  webview-facing permission surface to grant.

## 10. i18n

Every new string (Settings section, field labels/hints, sync-status
tooltips, error messages, confirmation dialogs) needs both
`src/i18n/locales/en.json` and `pt-BR.json` entries under a new
`proofhub.*` namespace, per `CONTRIBUTING.md`. Not enumerated key-by-key
here since the exact copy will settle during implementation — noted so it
isn't missed at review time.

## 11. Phased implementation plan

**Phase 1 — connect + manual push (the MVP that delivers the user's actual
ask):**
- Migration v4 (§3.1) + CLI mirror.
- Credential storage (§4, option C only).
- Settings UI through step 3 of §5 (enable → connect → per-project mapping,
  including "create timesheet" convenience).
- Per-entry manual push + sync badge (§7.1) + error handling (§8).
- This alone satisfies "consigo lançar as horas do Chronos nas tasks e
  projetos do ProofHub" — everything after this is refinement, not the core
  ask.

**Phase 2 — batch push + task-level linking:**
- "Send day to ProofHub" (§7.2).
- Optional todolist+task mapping and `list_id`/`task_id` on push (§5.3,
  §6).
- Re-sync flow for edited entries (§7.3).

**Phase 3 — optional hardening, only if warranted by real use:**
- OS-keychain upgrade path (§4.2's option A) as an opt-in switch once a
  file-based credential has shipped and proven itself.
- Revisit auto-push-on-stop (§7.4) only if requested.

## 12. Open questions (need the user's call before/during Phase 1)

1. Confirm the exact `User-Agent` string to send (needs a real contact
   email/identifier — currently placeholder in §2.1).
2. Whole ProofHub accounts can have multiple companies; does the user's own
   account ever need to switch between more than one `{companyurl}`
   subdomain, or is one enough for v1's single-subdomain Settings field?
3. Rounding rule for `logged_hours`/`logged_mins` when `duration_seconds`
   isn't a whole number of minutes (round to nearest minute vs. always
   round up) — cosmetic but should be a deliberate choice, not whatever
   integer division happens to do.
