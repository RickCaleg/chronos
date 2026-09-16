use std::collections::HashMap;
use std::process::Command;
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

/// On Linux, native/GTK window decorations only look "at home" under a full
/// desktop environment, which themes them to match the rest of the system.
/// Standalone window managers (Hyprland, sway, i3, ...) don't theme them at
/// all and usually expect chrome-less windows, so we hide decorations there.
/// Windows and macOS always keep their native title bar.
#[cfg(target_os = "linux")]
fn should_hide_decorations() -> bool {
    const KNOWN_DESKTOP_ENVIRONMENTS: [&str; 11] = [
        "gnome", "kde", "xfce", "mate", "cinnamon", "budgie", "lxde", "lxqt", "unity", "pantheon",
        "deepin",
    ];
    let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default().to_lowercase();
    !desktop
        .split(':')
        .any(|part| KNOWN_DESKTOP_ENVIRONMENTS.iter().any(|de| part.contains(de)))
}

#[cfg(not(target_os = "linux"))]
fn should_hide_decorations() -> bool {
    false
}

/// Reads the active Omarchy theme's resolved colors, if the `omarchy-theme-color`
/// CLI is available (Omarchy desktop on Linux). Returns `None` on any other
/// platform or when Omarchy isn't installed, so the frontend can fall back to
/// its own light/dark palette.
#[tauri::command]
fn get_omarchy_theme() -> Option<HashMap<String, String>> {
    let output = Command::new("omarchy-theme-color").arg("--all").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    let mut colors = HashMap::new();
    for line in text.lines() {
        if let Some((key, value)) = line.split_once('\t') {
            colors.insert(key.to_string(), value.to_string());
        }
    }
    Some(colors)
}

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
        version: 1,
        description: "create_initial_tables",
        sql: r#"
            CREATE TABLE projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT NOT NULL,
                archived INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE time_entries (
                id TEXT PRIMARY KEY,
                description TEXT NOT NULL DEFAULT '',
                task_number TEXT,
                project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
                start_time TEXT NOT NULL,
                end_time TEXT,
                duration_seconds INTEGER,
                is_running INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX idx_time_entries_start_time ON time_entries(start_time);
            CREATE INDEX idx_time_entries_project_id ON time_entries(project_id);

            CREATE TABLE settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        "#,
        kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add_project_alias",
            sql: "ALTER TABLE projects ADD COLUMN alias TEXT;",
            kind: MigrationKind::Up,
        },
    ]
}

/// Our AppImage bundle (via linuxdeploy-plugin-gtk) forces `GDK_BACKEND=x11`
/// to dodge an unrelated Wayland webview crash (tauri-apps/tauri#8541), which
/// runs the app under XWayland instead of natively. `GDK_SCALE` is meant for
/// *native* Wayland/X11 sessions (e.g. `GDK_SCALE=2` on this desktop's
/// fractional-scaled HiDPI panel); under XWayland it stacks with the
/// compositor's own auto-scaling for non-Wayland-native clients, roughly
/// doubling the UI size. Only strip it when that x11 override is in effect —
/// native .deb/.rpm installs run under real Wayland and size correctly.
#[cfg(target_os = "linux")]
fn fix_appimage_x11_scaling() {
    if std::env::var("GDK_BACKEND").as_deref() == Ok("x11") {
        std::env::remove_var("GDK_SCALE");
        std::env::remove_var("GDK_DPI_SCALE");
    }
}

#[cfg(not(target_os = "linux"))]
fn fix_appimage_x11_scaling() {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    fix_appimage_x11_scaling();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:chronos.db", migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![get_omarchy_theme])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                if should_hide_decorations() {
                    window.set_decorations(false)?;
                }
                window.show()?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
