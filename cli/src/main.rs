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
    },

    /// Stop the currently running timer
    Stop,

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
        #[arg(long)]
        json: bool,
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
    },

    /// Edit an existing entry. Only the fields you pass are changed.
    ///
    /// Editing --duration recomputes the end time (start stays fixed).
    /// Editing --start or --end recomputes the duration. Passing both
    /// --start and --end sets them directly. --duration and --end together
    /// is rejected as ambiguous.
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

    /// Export entries and projects to a file (or stdout with "-" / no --output)
    Export {
        #[arg(long, value_enum, default_value_t = ExportFormat::Json)]
        format: ExportFormat,
        #[arg(long, value_name = "PATH")]
        output: Option<PathBuf>,
    },

    /// Import entries and projects from a file
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

    /// Permanently delete every project and time entry
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
