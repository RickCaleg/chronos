# ProofHub integration — design & implementation plan

Status: **in development on `feature/proofhub-integration`, targeting
v0.5.0.** This document is the detailed design for an optional "plugin"
that pushes logged Chronos time entries into ProofHub projects/tasks.

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
- **Nothing on disk, in memory, or on the network for this feature until the
  user explicitly installs it**, and nothing about ProofHub's API/protocol
  shipped in the base Chronos binary at all — not just dormant, genuinely
  absent until downloaded. See §3.

This is the second deliberate exception to "local-first, no telemetry" after
the GitHub-releases updater (documented in `CONTRIBUTING.md`) — it must be
presented the same way: off by default, one clear action to opt in, and a
documented statement of exactly what leaves the device and to where.

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
§8.2) must serialize requests with a small delay and honor `Retry-After` on
a `429` rather than hammering it.

### 2.4 What's not there

- **No webhooks.** Confirmed absent from the official docs.
- **No official SDK or maintained client library**, no public Postman
  collection.

## 3. Plugin distribution architecture

This is the part that makes it a real "plugin" rather than a hidden switch
in the same binary. The requirement: **before the user clicks Install,
nothing related to ProofHub exists on their machine** — no ProofHub API
code, no credential file, no settings rows, no processes, no network
calls. After careful consideration, the design below is a separately
compiled, separately downloaded, signature-verified binary — not a
dynamically-loaded library and not a WASM module. Both of those were
considered and rejected for concrete reasons (below); the chosen shape is
deliberately closer to "download a small trusted CLI tool," which this
project already has a working, low-risk precedent for.

### 3.1 Why not a native dylib or WASM module

- **Native dylib (`.so`/`.dylib`/`.dll`) loaded into the running app**:
  rejected. Rust has no stable ABI across compiler versions — a plugin
  binary and the host app would have to be built with the *exact* same
  rustc version/flags per platform/arch or risk undefined behavior (silent
  memory corruption, not just a crash) on mismatch. That's a categorically
  worse failure mode than every native-linking bug this project has already
  fought (bundled SQLite under `makepkg`, `libayatana-appindicator`) —
  those failed loudly at build/link time; an ABI-mismatched dylib can fail
  silently at runtime, in a shipped release, on a user's machine.
- **WASM module loaded via an embedded runtime** (`wasmtime`/`wasmer`):
  safer than a dylib, but it means embedding a WASM runtime in the base app
  (a new, fairly heavy dependency, present whether or not anyone ever
  installs the plugin — which itself sits oddly with "nothing until
  install"), designing a host/guest interface from scratch, and it still
  doesn't solve how the plugin would contribute *UI* (a WASM module can't
  render React) — that problem would need a second system (module
  federation / dynamically loaded JS) layered on top. Rejected as
  disproportionate engineering for one integration.
- **Separate downloaded process, talked to over stdio (chosen)**: no ABI
  concerns (it's a full separate process with its own memory space, exactly
  like spawning any other external program), no new runtime embedded in
  the base app, and this project already has the identical shape working
  in production — `chronos-cli` is already a standalone binary, already
  built per-platform in CI, already published as a plain GitHub Release
  asset (see `.github/workflows/release.yml`'s `chronos-cli` staging
  step). The plugin reuses that exact pattern; it just gets downloaded
  automatically by the app instead of manually by the user, which is why
  it additionally needs signature verification (see §3.4) that
  `chronos-cli` doesn't bother with — a user manually downloading and
  running `chronos-cli` themselves is a different trust model than the app
  auto-fetching and executing a binary on a button click.

### 3.2 The plugin binary: `chronos-proofhub-plugin`

A new Cargo workspace member, `proofhub-plugin/`, alongside `src-tauri` and
`cli`. It is a small, stateless CLI: **one invocation per action.** It
reads a single JSON payload from stdin, makes the corresponding ProofHub
API call(s), and writes a single JSON envelope to stdout, then exits.

```
$ echo '{"action":"list-projects","subdomain":"acmecorp","apiKey":"..."}' \
    | chronos-proofhub-plugin
{"ok":true,"data":[{"id":"123","title":"Website redesign"}, ...]}
```

Envelope shape on failure: `{"ok":false,"error":{"status":401,"message":"..."}}`
so the main app can distinguish auth failures, rate limits, and validation
errors (§9) without parsing ProofHub's raw response body itself.

Actions, matching §2.2's endpoints one-to-one: `test-connection`,
`list-projects`, `list-timesheets`, `create-timesheet`, `list-todolists`,
`list-tasks`, `push-entry`, `update-entry`.

Deliberately **no database access and no credential storage** in this
binary — it only knows how to talk to ProofHub, given credentials handed to
it on stdin for that single call. This keeps its dependency footprint small
(`reqwest` with `rustls-tls` — no OpenSSL system dependency to fight,
`serde`/`serde_json`, nothing else) and means a compromised or buggy plugin
binary can't itself go read `chronos.db` or the credential file — it never
has a path to either.

### 3.3 Install / uninstall flow (main app, Rust side)

New module `src-tauri/src/proofhub_plugin.rs`:

- `#[tauri::command] proofhub_plugin_status() -> PluginStatus` — reports
  `NotInstalled`, `Installed { version }`, so Settings knows whether to show
  "Install" or the connect form.
- `#[tauri::command] proofhub_plugin_install(app) -> Result<(), String>`:
  1. Resolves the platform triple (matching the two platforms Chronos
     itself already ships for — Linux x86_64, Windows x86_64; no new
     platform support invented here).
  2. Downloads `chronos-proofhub-plugin-{platform}` and its `.minisig`
     signature from **the same GitHub Release tag as the running app's own
     version** (`.../releases/download/v{currentVersion}/...`) — this is
     what keeps the plugin's protocol in lockstep with the app without
     needing any separate version-negotiation logic: a v0.5.0 app only ever
     fetches the v0.5.0 plugin.
  3. Verifies the signature with the `minisign-verify` crate against a
     public key embedded as a Rust constant (§3.4) — refuses to proceed on
     a mismatch, deletes the downloaded file, and surfaces a clear error.
  4. Writes the verified binary to the app's data directory (e.g.
     `~/.local/share/com.richardson.chronos/plugins/` on Linux), `chmod
     755` on Unix.
  5. Records the installed version in the `settings` table (§4.2).
- `#[tauri::command] proofhub_plugin_uninstall()`: deletes the binary and
  the installed-version row. Does **not** touch already-synced entries'
  `proofhub_time_entry_id`/`proofhub_synced_at` (§4.1) or a previously
  saved credential unless the user separately chooses "Disconnect" (§6.4)
  — uninstalling the plugin and disconnecting the account are related but
  distinct actions.
- `#[tauri::command] proofhub_plugin_call(action, payload) -> Result<Value, PluginError>`:
  the single generic bridge every ProofHub-aware UI action goes through.
  Spawns the installed binary, writes `payload` (merged with the decrypted
  credential, see §5) to its stdin, reads stdout, parses the envelope.
  Treats "binary missing," "non-zero exit," and "unparseable stdout" as
  distinct error cases surfaced to the UI (§9) rather than lumped together.

This collapses what an earlier draft of this plan had as ~9 separate
Tauri commands (`proofhub_list_projects`, `proofhub_push_entry`, ...) into
one generic bridge plus the three lifecycle commands above — all
ProofHub-specific request/response shapes live in the downloaded binary,
not in the base app.

### 3.4 Signing

A **dedicated** minisign keypair, separate from the app's existing
auto-updater signing key (`TAURI_SIGNING_PRIVATE_KEY`) — a different key so
a compromise of one can't be leveraged against the other. Generated the
same way the existing updater key was (`npx tauri signer generate`, which
this project already has working tooling for). The private key + password
become two new repo secrets; the public key is embedded as a constant in
`src-tauri/src/proofhub_plugin.rs`. **Generating and committing this
keypair to GitHub's repo secrets is a one-time, security-relevant action —
done as an explicit, confirmed step, not silently, same as any other change
to shared secrets.**

**Status: done.** The keypair was generated with `npx tauri signer generate`
and its private half + password registered as the `PLUGIN_SIGNING_PRIVATE_KEY`
/ `PLUGIN_SIGNING_PRIVATE_KEY_PASSWORD` repo secrets; the public half is the
`PLUGIN_PUBLIC_KEY_B64` constant in `src-tauri/src/proofhub_plugin.rs`. No
copy of the private key was kept outside GitHub's secret store.

`release.yml` builds `chronos-proofhub-plugin` in release mode for each
platform in the matrix (mirroring the existing `chronos-cli` staging step)
and signs each binary before upload. Neither the `rsign` nor `minisign` CLI
tools accept the decryption password non-interactively (TTY prompt only,
which a CI runner doesn't have) — `xtask/src/sign_plugin.rs` is a small
internal helper (not shipped) that calls the `minisign` crate's library API
directly instead, reading the key/password from the same two secrets.
Verified end-to-end locally: signed with this exact xtask, verified with
the exact `minisign-verify` call `proofhub_plugin_install` uses.

## 4. Data model changes

Two additions, kept intentionally small — every schema change here has to
be mirrored in both `src-tauri/src/lib.rs` migrations and
`cli/src/db.rs::ensure_schema` per `CONTRIBUTING.md`.

### 4.1 New migration (version 4): sync tracking on `time_entries`

```sql
ALTER TABLE time_entries ADD COLUMN proofhub_time_entry_id TEXT;
ALTER TABLE time_entries ADD COLUMN proofhub_synced_at TEXT;
```

Both nullable, both `NULL` until a push succeeds. `proofhub_time_entry_id`
is what ProofHub's API hands back on a successful `POST .../time` — storing
it is what makes "already synced" a real fact instead of a guess, and is
also what a future update/`DELETE` would need. `proofhub_synced_at` drives
the sync-status badge (§8) and lets an edit made *after* a push visibly
fall out of sync (§8.3).

Mirror in `cli/src/db.rs::ensure_schema` with the same
`pragma_table_info`-guarded `ALTER TABLE ... ADD COLUMN` pattern already
used there for `projects.alias` — the CLI never populates or reads these
columns, this is purely to keep the schema shape consistent for a database
the CLI might create first.

### 4.2 No new tables — reuse the existing (currently unused) `settings` table

`src-tauri/src/lib.rs` migration 1 already created a generic
`settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)` table that nothing in
the codebase reads or writes today. Proposed keys (all JSON-encoded except
the plugin version, which is a plain string):

| key | value shape |
|---|---|
| `proofhub.pluginInstalledVersion` | `"0.5.0"` (absent = not installed) |
| `proofhub.enabled` | `"true"` / `"false"` (connected, not just installed) |
| `proofhub.subdomain` | `"acmecorp"` |
| `proofhub.projectMap` | `{"<chronosProjectId>": {"proofhubProjectId": "123", "timesheetId": "456", "timesheetTitle": "Chronos time", "defaultBillable": true, "todolistId": "789"}}` |

**This table is deliberately excluded from backups.** Both
`exportJsonBackup()` (`src/lib/exportImport.ts`) and `performAutoBackup()`
(`src/lib/autoBackup.ts`) already do targeted `SELECT`s (`listProjects`,
`listEntries`, `listTags`) rather than dumping the whole database — neither
touches `settings`. Losing the mapping/install-state on restore is an
acceptable, easily-redone inconvenience.

### 4.3 A new `src/db/proofhubSettings.ts` module

Thin `get`/`set` wrapper around `SELECT/INSERT OR REPLACE INTO settings`,
JSON-encoding/decoding the values above, plus a `useProofHubStore`
mirroring `useAutoBackupStore`'s shape for the non-secret fields.

## 5. Credential storage — where the API key actually lives

Unchanged in spirit from the original design, refined for the
process-boundary in §3: the credential is decrypted **only in the main
app's Rust process**, in memory, immediately before a `proofhub_plugin_call`
— it's merged into the JSON payload piped to the plugin binary's stdin for
that one call and never written to disk by the plugin itself (§3.2). The
plugin process never independently reads or caches it.

At rest, the key lives in a local encrypted file (e.g.
`proofhub-credentials.enc` beside `chronos.db` in the app's config
directory), encrypted with a key generated on first save and stored in a
sibling file with restrictive permissions (`0600` on Unix). This was
chosen over the OS keychain (`keyring` crate) because this project ships
to minimal Linux window-manager setups (the maintainer's own Omarchy/
Hyprland environment included) where a Secret Service provider often isn't
running — the same category of native-dependency fragility this project
already spent several releases fighting. An OS-keychain option can be
offered later as an opt-in upgrade once this ships and proves itself
(§11, Phase 3).

The API key **never** enters `src/db/proofhubSettings.ts`, the `settings`
table, `localStorage`, or any Zustand store's persisted state, and it never
touches the plugin binary's own filesystem access — it's write-only from
the JS perspective ("save this key," never "give me the key").

## 6. Settings UX — the "plugin" surface

New collapsible section in Settings, after "Startup & shortcuts," titled
**"Integrations."** The section header/description shown before install is
intentionally generic (name, one-line description, an Install button) —
this shell ships in the base app because *some* UI has to exist to offer
the feature at all, but it contains no ProofHub API knowledge, just a
label and a download trigger. Everything past this point is a lazy-loaded
(`React.lazy`) component, so its code isn't on the JS execution path for a
user who never installs.

1. **Not installed (default):** "ProofHub — send logged hours to ProofHub
   projects and tasks. [Install]". Clicking Install calls
   `proofhub_plugin_install` (§3.3), shows progress (download → verify →
   done), and reveals step 2 on success. A failed signature check shows a
   clear "the downloaded plugin failed verification and was not installed"
   message — never a silent partial install.
2. **Installed, not connected:** two fields — "ProofHub subdomain" (with a
   hint: "the part before `.proofhub.com` in your ProofHub URL") and "API
   key" (password-masked, with a link to ProofHub's own "API access"
   profile page). A "Test & connect" button calls `proofhub_plugin_call
   ("test-connection", ...)`; success saves the credential (§5) and reveals
   step 3.
3. **Connected — project mapping table:** one row per non-archived Chronos
   project: a ProofHub-project dropdown, a timesheet dropdown for that
   project (plus a **"Create 'Chronos time' timesheet"** convenience
   button), an optional "link to a specific task" disclosure
   (todolist+task), and a default billable toggle. Unmapped Chronos
   projects show no sync affordance anywhere in the app.
4. **"Disconnect"** clears the credential and `proofhub.*` mapping/enabled
   settings, dropping back to step 2's empty form. **"Uninstall"** (a
   separate action, further down) removes the downloaded binary entirely
   (§3.3), dropping back to step 1. Neither touches already-pushed entries'
   sync metadata (§4.1).

## 7. Chronos → ProofHub entity mapping

| Chronos concept | ProofHub concept | Notes |
|---|---|---|
| Project | Project + Timesheet | A Chronos project maps to one ProofHub project **and** one timesheet inside it (§2.2). |
| Task number / description | Time entry `description` | Sent verbatim, no forced prefix. |
| Tags | *(not sent)* | ProofHub time entries have no tag concept. |
| Start/end time | *(not sent, only duration)* | ProofHub's time-entry model is duration-based (`logged_hours`/`logged_mins` + a `date`), not start/end timestamps. |
| Duration | `logged_hours` + `logged_mins` | Converted from `duration_seconds`. |
| Entry's calendar day | `date` | `YYYY-MM-DD`, from the entry's local start time. |
| (mapping's default) | `status` (billable/none) | Per-project default, overridable per push. |
| task_number match (optional) | `list_id` + `task_id` | Best-effort only if task-level linking is configured — never required for a push to succeed. |

## 8. Push UX

### 8.1 Per-entry manual push

Every finished (non-running) entry whose project has a ProofHub mapping
gets a small sync-status affordance in `EntryRow`/`GroupedEntryRow`, next to
the existing tag chips: unsynced (send icon) → synced (filled checkmark,
not re-clickable — re-push would create a duplicate ProofHub entry) → error
(warning icon, click to retry, tooltip shows the reason).

### 8.2 Batch push (per day)

A **"Send day to ProofHub"** button next to the existing copy-to-clipboard
button in the day-group header, visible only if at least one unsynced,
mapped entry exists that day. Shows a confirmation summary first, then
fires requests sequentially with a small delay (§2.3's rate limit),
continuing past individual failures. No "send week"/"send everything" bulk
action in v1.

### 8.3 Edits after a push

Editing an already-synced entry clears `proofhub_synced_at` (keeps
`proofhub_time_entry_id`) and the badge shows a distinct "out of sync"
state; clicking it does a `PUT` (via `update-entry`) instead of a new
`POST`. Deleting a synced Chronos entry does not delete it from ProofHub
automatically.

### 8.4 No auto-push on stop

Deliberately not building an automatic push-on-stop mode for v1 — the most
surprising option for a tool whose identity is "manual, you're always in
control." Revisit only if real usage shows people want it.

## 9. Error handling

| Condition | Behavior |
|---|---|
| Plugin not installed when a call is attempted | Should be unreachable from the UI (step-gated per §6), but the bridge command checks and returns a distinct error rather than trying to spawn a missing file. |
| Plugin binary fails to spawn / crashes / times out | Surfaced as "the ProofHub plugin didn't respond" with a suggestion to reinstall — distinct from a ProofHub-side error. |
| `401`/`403` (bad/reset key) | Mark the connection "needs reconnecting" (distinct from user-initiated Disconnect, same resulting state), point back to Settings step 2. Stop attempting further pushes until reconnected. |
| `429` (rate limit) | Honor `Retry-After`; in a batch push, pause and resume rather than failing the remaining entries. |
| `4xx` validation (e.g. a mapped `timesheet_id` deleted on ProofHub's side) | Surface the specific message; point back to project mapping in Settings. |
| Network failure (offline, DNS, timeout) | Treat as retryable; never mark an entry synced on ambiguous failure — a false "unsynced" costs a re-click, a false "synced" is a silently missing hour in ProofHub. |
| ProofHub returns success but the local DB write fails right after | Log distinctly so "never sent" and "sent but not recorded locally" aren't confused — don't let a retry double-log the hours. |

## 10. Architecture / file layout

- **`proofhub-plugin/`** (new Cargo workspace member) — `src/main.rs`,
  stdin/stdout JSON action dispatch (§3.2), `reqwest`/`serde` only.
- **`src-tauri/src/proofhub_plugin.rs`** (new) — install/uninstall/status/
  bridge commands (§3.3), signature verification (§3.4), the embedded
  public key constant.
- **`src-tauri/src/proofhub_credentials.rs`** (new) — encrypted
  credential file read/write (§5).
- **`src/integrations/proofhub/`** (new) — `ProofHubSettings.tsx` (§6,
  lazy-loaded), `useProofHubStore.ts`, the shared sync-badge component used
  by `EntryRow`/`GroupedEntryRow` (§8.1), the day-header "Send day" button
  logic (§8.2).
- **`src/db/proofhubSettings.ts`** (new) — alongside the other `db/`
  modules (§4.3).
- **No new webview capability entries** — all HTTP happens in Rust
  (plugin process + the main app's download step), never via a JS-side
  `@tauri-apps/plugin-http` call.

## 11. i18n

Every new string (Settings section, install progress/errors, field
labels/hints, sync-status tooltips, confirmation dialogs) needs both
`src/i18n/locales/en.json` and `pt-BR.json` entries under a new
`proofhub.*` namespace, per `CONTRIBUTING.md`.

## 12. Phased implementation plan

**Phase 1 — connect + manual push (the MVP that delivers the user's actual
ask), targeting v0.5.0:**
- `proofhub-plugin` crate (§3.2) + CI build/sign/publish (§3.4).
- Install/uninstall/status/bridge commands (§3.3) + encrypted credential
  storage (§5).
- Migration v4 (§4.1) + CLI mirror.
- Settings UI through step 3 of §6 (install → connect → per-project
  mapping, including "create timesheet" convenience).
- Per-entry manual push + sync badge (§8.1) + error handling (§9).

**Phase 2 — batch push + task-level linking:**
- "Send day to ProofHub" (§8.2).
- Optional todolist+task mapping and `list_id`/`task_id` on push.
- Re-sync flow for edited entries (§8.3).

**Phase 3 — optional hardening, only if warranted by real use:**
- OS-keychain upgrade path for the credential (§5), opt-in.
- Revisit auto-push-on-stop (§8.4) only if requested.

## 13. Open questions / confirmations needed during Phase 1

1. ~~Generating and storing the plugin-signing keypair as new repo
   secrets~~ — done; see §3.4.
2. Confirm the exact `User-Agent` string to send (§2.1). Currently
   `Chronos (richardson.saconi@outlook.com)` in the plugin binary and
   `Chronos/{version}` for the install download itself.
3. Rounding rule for `logged_hours`/`logged_mins`: implemented as "round
   to the nearest whole minute" (`sync.ts`'s `pushEntryToProofHub`).
4. **Not yet done: an actual tagged release containing the signed plugin
   binaries.** `proofhub_plugin_install` fetches from the running app's
   own version tag, so the install button has nothing to download until a
   v0.5.0 (or later) release is cut with this workflow.
