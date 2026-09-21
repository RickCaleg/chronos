# `chronos-cli`

A command-line companion for Chronos. It reads and writes the **exact same
local SQLite database** as the desktop app — nothing goes through the GUI, so
entries created from the CLI show up in the app immediately and vice versa.
This makes it useful for:

- Scripting your own workflow (start/stop from a shell alias, a keybinding, etc.)
- Automating backups (cron, systemd timers)
- Building a status-bar widget or window-manager integration (see
  [Omarchy / window manager integration](#omarchy--window-manager-integration) below)

## Installation

Prebuilt binaries are attached to every [GitHub release](https://github.com/RickCaleg/chronos/releases)
as `chronos-cli-linux-x86_64` and `chronos-cli-windows-x86_64.exe`. Download
the one for your platform, make it executable, and put it on your `PATH`:

```sh
curl -L -o chronos-cli https://github.com/RickCaleg/chronos/releases/latest/download/chronos-cli-linux-x86_64
chmod +x chronos-cli
sudo mv chronos-cli /usr/local/bin/
```

Or build it from source (requires a Rust toolchain):

```sh
cargo install --path cli --locked
```

## Where's the data?

By default `chronos-cli` looks in the same place the desktop app stores its
database:

| OS | Path |
|---|---|
| Linux | `~/.config/com.richardson.chronos/chronos.db` |
| Windows | `%APPDATA%\com.richardson.chronos\chronos.db` |

Override it with `--db <path>` (per-invocation) or the `CHRONOS_DB_PATH`
environment variable (for scripts). If the file doesn't exist yet,
`chronos-cli` creates it with the right schema — you don't need to have
launched the GUI first.

```sh
chronos-cli db-path
```

## Commands

Every command supports `-h`/`--help` for the full, always-up-to-date list of
flags. What follows are the highlights.

### `start` / `stop` / `status`

```sh
chronos-cli start "Fix login bug" --task '#1234' --project WEB --tags "client,billable"
chronos-cli restart a1b2c3d4   # stops what's running and continues that entry, like the app's ▶ button
chronos-cli status
chronos-cli status --json
chronos-cli stop
chronos-cli discard --yes   # throws the running timer away, nothing saved
```

- Only one timer can run at a time; `start` fails loudly if one is already running.
- `--project` matches a project's id, exact name, or short code (case-insensitive).
- `--at` lets you backdate the start (`--at "14:30"`, `--at "2026-01-31 14:30"`, or the default `now`).
- `--tags` takes comma-separated names, creating tags that don't exist yet (case-insensitive, like the app).
- `--note` (also on `add`/`edit`) stores a note about what was done; the desktop app sends it to ProofHub instead of the description.
- `restart` copies the description, task and project of an existing entry, like the desktop app.
- `status --json` is the one to poll from a script or a bar widget — see below.

### `list`

```sh
chronos-cli list                      # today (default)
chronos-cli list --yesterday
chronos-cli list --date 2026-01-31
chronos-cli list --from 2026-01-01 --to 2026-02-01
chronos-cli list --project APP --json
chronos-cli list --tag billable
chronos-cli list --yesterday --summary  # the app's "copy day" text, ready to paste
```

The table shows each entry's tags after it and its note, if any, on the lines
below. `--json` includes `tags`, `note` and the ProofHub sync fields.
`--summary` prints one block per day (`dd/mm`, then ` - #task - CODE -
description`), with repeated task/description/project combinations listed
once.

### `add` / `edit` / `delete`

`add` inserts a completed entry directly, without running a timer — handy for
backfilling:

```sh
chronos-cli add "Daily standup" --start 09:00 --end 09:15 --project Internal
```

`edit` changes only the fields you pass. The id can be the full one or any
unique prefix of it, exactly like a `git` short hash — `chronos-cli list --json`
or the first column of the plain-text table both give you one:

```sh
chronos-cli edit a1b2c3d4 --description "Daily standup (async)"
chronos-cli edit a1b2c3d4 --start "09:05"          # keeps end fixed, recomputes duration
chronos-cli edit a1b2c3d4 --duration "0:20:00"     # keeps start fixed, recomputes end
chronos-cli edit a1b2c3d4 --tags "meeting"          # replaces the tags; "" clears them
chronos-cli edit a1b2c3d4 --note "Went over the PR" # "" clears it
chronos-cli delete a1b2c3d4 --yes
```

`--end` and `--duration` together are rejected — pick one, since they'd
otherwise disagree about where the entry ends. On the running entry only
`--start` (not in the future) and the non-time fields can be changed, like
adjusting the start in the app.

Like the desktop app, editing anything but the tags of an entry already sent
to ProofHub marks it for resending, and deleting one entry of a grouped push
marks the rest of that group. Sending itself only happens in the app.

Notes need a database an up-to-date desktop app has already upgraded (just
open the app once). The CLI deliberately doesn't add that column to an
existing database itself, since the app's own upgrade would then fail.

### `tags`

```sh
chronos-cli tags list
chronos-cli tags add urgent
chronos-cli tags rename urgent asap
chronos-cli tags remove asap --yes   # entries just lose the tag
```

### `projects`

```sh
chronos-cli projects list
chronos-cli projects add "Website Redesign" --alias WEB --color '#6366f1'
chronos-cli projects alias "Website Redesign" WEB
chronos-cli projects rename WEB "Website Redesign v2"
chronos-cli projects archive WEB
chronos-cli projects remove WEB --yes   # entries keep the project's name/id as history, just unassigned
```

### `export` / `import` / `reset`

```sh
# Full backup (same format the desktop app's "Export full backup" produces:
# projects, entries with their tags, notes and ProofHub sync state, and tags)
chronos-cli export --format json --output ~/backups/chronos-$(date +%F).json

# Or straight to stdout, e.g. to pipe into gzip
chronos-cli export --format json | gzip > backup.json.gz

chronos-cli export --format csv --output entries.csv   # same columns as the app's CSV, "Note" last

chronos-cli import --format json backup.json --yes   # REPLACES all current data
chronos-cli import --format csv entries.csv           # appends
chronos-cli import --format clockify export.csv       # appends, pt-BR Clockify export columns

chronos-cli reset --yes   # erases everything, tags included — same as the app's "Start fresh"
```

A JSON import restores tags too. Older automatic backups from the app have
no separate tag list; the CLI rebuilds it from the entries, same as the app.

Both CSV importers apply the same "`#task - CODE - description`" splitting
rule the desktop app uses for paste-autofill: if a row has no task number of
its own but its description embeds one (this is how Clockify exports look if
you used that convention there), the CLI splits it and, the first time it
sees a project without a code yet, teaches it the code — same as the GUI.

## Automating backups

A daily backup via cron:

```cron
0 2 * * * /usr/local/bin/chronos-cli export --format json --output "$HOME/backups/chronos-$(date +\%F).json"
```

Or a systemd user timer (`~/.config/systemd/user/chronos-backup.timer` +
matching `.service` running the same command) if you prefer that to cron.

## Exit codes and errors

`chronos-cli` follows the usual convention: `0` on success, non-zero on any
error, with a human-readable message on stderr (`Error: ...`). Nothing is
printed to stdout on failure, so `chronos-cli status --json 2>/dev/null` is
always either valid JSON or empty.

## Omarchy / window manager integration

The CLI has no GUI dependencies at all — no webview, no GTK — so it starts
instantly and works headlessly, which makes it a natural fit for a status bar
widget or a compositor keybinding on Hyprland/Omarchy (or any other window
manager or DE).

A minimal polling script for a bar widget, in the same spirit as this
machine's `nosignal.omasend` panel plugin:

```sh
#!/usr/bin/env bash
# chronos-status.sh — print a one-line summary for a status bar.
status=$(chronos-cli status --json)
running=$(jq -r '.running' <<<"$status")

if [ "$running" = "true" ]; then
  desc=$(jq -r '.entry.description' <<<"$status")
  elapsed=$(jq -r '.elapsedSeconds' <<<"$status")
  printf '⏱ %s (%dm)\n' "$desc" "$((elapsed / 60))"
else
  echo "⏱ –"
fi
```

Point your panel's polling plugin (or a `SIGRTMIN`-triggered refresh, if your
bar supports it) at that script. For start/stop, bind a key to something like:

```sh
bindd = SUPER, T, Toggle Chronos timer, exec, chronos-cli status --json | jq -e '.running' >/dev/null && chronos-cli stop || chronos-cli start "$(wtype -h 2>/dev/null; echo Working)"
```

(adjust to however you'd rather supply the description — a `rofi`/`wofi`
prompt piped into `--description` is a nicer version of the same idea).

If you build this into an actual omarchy-shell plugin (a proper panel widget
rather than a polling script), `chronos-cli status --json` /
`chronos-cli start ...` / `chronos-cli stop` are the three calls it needs —
the JSON shape is stable and won't change without a version bump.
