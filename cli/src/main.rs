mod commands;
mod csvio;
mod db;
mod model;
mod pasteparse;
mod timefmt;

use anyhow::Result;
use clap::{Parser, Subcommand, ValueEnum};
use std::path::PathBuf;

/// Command-line companion for the Chronos time tracker.
///
/// Operates on the exact same local SQLite database as the desktop app, so
/// entries created here show up in the GUI and vice versa. Great for
/// scripting, cron-based backups, or wiring Chronos into a status bar /
/// window manager widget (see `docs/CLI.md` in the repo for an Omarchy
/// example).
#[derive(Parser)]
#[command(name = "chronos-cli", version, about, long_about = None)]
pub struct Cli {
    /// Path to the SQLite database file (overrides CHRONOS_DB_PATH and the OS default)
    #[arg(long, global = true, value_name = "PATH")]
    pub db: Option<PathBuf>,

    #[command(subcommand)]
    pub command: Command,
}

#[derive(Subcommand)]
pub enum Command {
    /// Start a new timer (fails if one is already running)
    Start {
        /// What you're working on
        description: String,
        /// Task number, e.g. "#1234"
        #[arg(long)]
        task: Option<String>,
        /// Project name, code, or id
        #[arg(long)]
        project: Option<String>,
        /// Start time: "now" (default), "14:30", or "2026-01-31 14:30"
        #[arg(long, default_value = "now")]
        at: String,
        /// Comma-separated tag names, e.g. "meeting,billable" (created if new)
        #[arg(long)]
        tags: Option<String>,
        /// A note about what was done (sent to ProofHub instead of the description)
        #[arg(long)]
        note: Option<String>,
    },

    /// Stop the currently running timer
    Stop,

    /// Throw away the running timer without saving it
    Discard {
        /// Skip the confirmation prompt
        #[arg(long)]
        yes: bool,
    },

    /// Start a new timer with an existing entry's description, task and
    /// project (stopping the running one first, if any)
    Restart {
        /// Entry id or unique prefix (see `chronos-cli list`)
        id: String,
    },

    /// Show the currently running timer, if any
    Status {
        #[arg(long)]
        json: bool,
    },

    /// List time entries (defaults to today)
    List {
        #[arg(long)]
        today: bool,
        #[arg(long)]
        yesterday: bool,
        /// A single day, e.g. "2026-01-31"
        #[arg(long)]
        date: Option<String>,
        /// Start of a custom range (inclusive)
        #[arg(long)]
        from: Option<String>,
        /// End of a custom range (exclusive)
        #[arg(long)]
        to: Option<String>,
        /// Filter by project name, code, or id
        #[arg(long)]
        project: Option<String>,
        /// Only entries with this tag
        #[arg(long)]
        tag: Option<String>,
        #[arg(long)]
        json: bool,
        /// Print each day as the desktop app's "copy day" text instead of a table
        #[arg(long, conflicts_with = "json")]
        summary: bool,
    },

    /// Add a completed entry directly, without starting a timer
    Add {
        description: String,
        #[arg(long)]
        start: String,
        #[arg(long)]
        end: String,
        #[arg(long)]
        task: Option<String>,
        #[arg(long)]
        project: Option<String>,
        /// Comma-separated tag names, e.g. "meeting,billable" (created if new)
        #[arg(long)]
        tags: Option<String>,
        /// A note about what was done (sent to ProofHub instead of the description)
        #[arg(long)]
        note: Option<String>,
    },

    /// Edit an existing entry. Only the fields you pass are changed.
    ///
    /// Editing --duration recomputes the end time (start stays fixed).
    /// Editing --start or --end recomputes the duration. Passing both
    /// --start and --end sets them directly. --duration and --end together
    /// is rejected as ambiguous. On a running entry, --start moves its start
    /// (like adjusting the start in the desktop app); --end/--duration need
    /// it stopped.
    Edit {
        /// Entry id (see `chronos-cli list --json`)
        id: String,
        #[arg(long)]
        description: Option<String>,
        /// Pass an empty string to clear it
        #[arg(long)]
        task: Option<String>,
        #[arg(long)]
        project: Option<String>,
        #[arg(long)]
        start: Option<String>,
        #[arg(long)]
        end: Option<String>,
        /// e.g. "1:30:00", "1:30", or minutes as a plain number
        #[arg(long)]
        duration: Option<String>,
        /// Replaces the entry's tags (comma-separated); an empty string clears them
        #[arg(long)]
        tags: Option<String>,
        /// Pass an empty string to clear it
        #[arg(long)]
        note: Option<String>,
    },

    /// Delete an entry
    Delete {
        id: String,
        /// Skip the confirmation prompt
        #[arg(long)]
        yes: bool,
    },

    /// Manage projects
    Projects {
        #[command(subcommand)]
        action: ProjectsCommand,
    },

    /// Manage tags
    Tags {
        #[command(subcommand)]
        action: TagsCommand,
    },

    /// Export everything to a file (or stdout with "-" / no --output)
    Export {
        #[arg(long, value_enum, default_value_t = ExportFormat::Json)]
        format: ExportFormat,
        #[arg(long, value_name = "PATH")]
        output: Option<PathBuf>,
    },

    /// Import from a file
    ///
    /// JSON replaces all current data. CSV and Clockify CSV append to it.
    Import {
        #[arg(long, value_enum)]
        format: ImportFormat,
        input: PathBuf,
        /// Skip the confirmation prompt (required for JSON, which replaces everything)
        #[arg(long)]
        yes: bool,
    },

    /// Permanently delete every project, time entry and tag
    Reset {
        /// Skip the confirmation prompt
        #[arg(long)]
        yes: bool,
    },

    /// Print the resolved path to the SQLite database file
    DbPath,
}

#[derive(Subcommand)]
pub enum ProjectsCommand {
    /// List projects
    List {
        /// Include archived projects
        #[arg(long)]
        all: bool,
        #[arg(long)]
        json: bool,
    },
    /// Create a project
    Add {
        name: String,
        /// Hex color, e.g. "#6366f1" (a default is picked if omitted)
        #[arg(long)]
        color: Option<String>,
        /// Short code shown as "CODE - Name", also used by paste-autofill
        #[arg(long)]
        alias: Option<String>,
    },
    /// Rename a project
    Rename {
        project: String,
        new_name: String,
    },
    /// Set a project's short code
    Alias {
        project: String,
        alias: String,
    },
    /// Set a project's color
    Color {
        project: String,
        color: String,
    },
    /// Archive a project
    Archive { project: String },
    /// Unarchive a project
    Unarchive { project: String },
    /// Delete a project (its entries become unassigned, not deleted)
    Remove {
        project: String,
        #[arg(long)]
        yes: bool,
    },
}

#[derive(Subcommand)]
pub enum TagsCommand {
    /// List tags
    List {
        #[arg(long)]
        json: bool,
    },
    /// Create a tag
    Add { name: String },
    /// Rename a tag
    Rename { tag: String, new_name: String },
    /// Delete a tag (entries just lose it)
    Remove {
        tag: String,
        #[arg(long)]
        yes: bool,
    },
}

#[derive(Clone, ValueEnum)]
pub enum ExportFormat {
    Json,
    Csv,
}

#[derive(Clone, ValueEnum)]
pub enum ImportFormat {
    Json,
    Csv,
    Clockify,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let db_path = db::resolve_db_path(cli.db)?;
    let conn = db::open(&db_path)?;
    commands::run(&conn, cli.command)
}
