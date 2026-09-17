use std::collections::HashMap;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_sql::{Migration, MigrationKind};

mod proofhub_credentials;
mod proofhub_plugin;

/// Set once the user actually asked to quit (tray menu, or a future explicit
/// shortcut) so the window-close handler below knows to let the app exit
/// instead of hiding to the tray.
struct QuitRequested(AtomicBool);

/// Handle to the tray's "Start/Stop Timer" menu item so its label can be
/// updated from the `set_tray_timer_label` command as the frontend's timer
/// starts and stops.
struct TrayMenuItems {
    toggle_timer: MenuItem<tauri::Wry>,
}

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

/// Updates the tray menu's "Start Timer" / "Stop Timer" label to match the
/// frontend's actual timer state. Called from the store whenever a timer
/// starts or stops, so the tray stays in sync no matter how it changed
/// (in-app button, keyboard shortcut, or the tray/global-shortcut itself).
#[tauri::command]
fn set_tray_timer_label(app: tauri::AppHandle, running: bool) -> Result<(), String> {
    let Some(items) = app.try_state::<TrayMenuItems>() else { return Ok(()) };
    let label = if running { "Stop Timer" } else { "Start Timer" };
    items.toggle_timer.set_text(label).map_err(|e| e.to_string())
}

/// (Re-)registers the global start/stop-timer shortcut with the given
/// accelerator string (e.g. "CommandOrControl+Alt+Space"), replacing any
/// previously registered one. Called from Settings when the user changes it,
/// and once on startup with either their saved choice or the built-in default.
#[tauri::command]
fn register_global_shortcut(app: tauri::AppHandle, accelerator: String) -> Result<(), String> {
    let shortcuts = app.global_shortcut();
    let _ = shortcuts.unregister_all();
    shortcuts.register(accelerator.as_str()).map_err(|e| e.to_string())
}

#[tauri::command]
fn unregister_global_shortcut(app: tauri::AppHandle) -> Result<(), String> {
    app.global_shortcut().unregister_all().map_err(|e| e.to_string())
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
        Migration {
            version: 3,
            description: "add_tags",
            sql: r#"
                CREATE TABLE tags (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE entry_tags (
                    entry_id TEXT NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
                    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                    PRIMARY KEY (entry_id, tag_id)
                );

                CREATE INDEX idx_entry_tags_tag_id ON entry_tags(tag_id);
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add_proofhub_sync_tracking",
            sql: r#"
                ALTER TABLE time_entries ADD COLUMN proofhub_time_entry_id TEXT;
                ALTER TABLE time_entries ADD COLUMN proofhub_synced_at TEXT;
            "#,
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

/// makepkg injects RUSTFLAGS (-C force-frame-pointers=yes -C debuginfo=2
/// --remap-path-prefix=..., for its automatic debug-package splitting) and
/// LTO-enabled LDFLAGS/CFLAGS/CXXFLAGS. Combined with sqlx-macros (a
/// proc-macro) and the app binary each linking their own build of
/// libsqlite3-sys's bundled SQLite, this reliably produces a sqlx-macros.so
/// missing basic SQLite symbols (seen: sqlite3_unlock_notify,
/// sqlite3_bind_int64) — reproduced consistently under makepkg's
/// environment, never with a plain `cargo`/`npm` toolchain. Kept here only
/// as a comment landmark: the actual fix lives in packaging/aur/PKGBUILD,
/// which unsets those variables for its build steps.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    fix_appimage_x11_scaling();

    // The autostart plugin always launches with this flag; setup() below
    // uses it to decide whether to reveal the window immediately or leave it
    // hidden until the tray's "Show Chronos" is used.
    let start_minimized = std::env::args().any(|arg| arg == "--minimized");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let _ = app.emit("toggle-timer-shortcut", ());
                    }
                })
                .build(),
        )
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:chronos.db", migrations())
                .build(),
        )
        .manage(QuitRequested(AtomicBool::new(false)))
        .invoke_handler(tauri::generate_handler![
            get_omarchy_theme,
            set_tray_timer_label,
            register_global_shortcut,
            unregister_global_shortcut,
            proofhub_plugin::proofhub_plugin_status,
            proofhub_plugin::proofhub_plugin_install,
            proofhub_plugin::proofhub_plugin_uninstall,
            proofhub_plugin::proofhub_plugin_call,
            proofhub_plugin::proofhub_test_connection,
            proofhub_credentials::proofhub_save_credentials,
            proofhub_credentials::proofhub_connection_status,
            proofhub_credentials::proofhub_clear_credentials,
        ])
        .setup(move |app| {
            let show_item = MenuItem::with_id(app, "show", "Show Chronos", true, None::<&str>)?;
            let toggle_timer_item =
                MenuItem::with_id(app, "toggle_timer", "Start Timer", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[&show_item, &toggle_timer_item, &PredefinedMenuItem::separator(app)?, &quit_item],
            )?;

            app.manage(TrayMenuItems { toggle_timer: toggle_timer_item });

            let mut tray = TrayIconBuilder::new().menu(&menu).show_menu_on_left_click(true);
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.on_menu_event(|app, event| match event.id().as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "toggle_timer" => {
                    let _ = app.emit("toggle-timer-shortcut", ());
                }
                "quit" => {
                    app.state::<QuitRequested>().0.store(true, Ordering::SeqCst);
                    app.exit(0);
                }
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } =
                    event
                {
                    let app = tray.app_handle();
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            })
            .build(app)?;

            if let Some(window) = app.get_webview_window("main") {
                if should_hide_decorations() {
                    window.set_decorations(false)?;
                }
                window.on_window_event({
                    let app_handle = app.handle().clone();
                    move |event| {
                        if let WindowEvent::CloseRequested { api, .. } = event {
                            if !app_handle.state::<QuitRequested>().0.load(Ordering::SeqCst) {
                                api.prevent_close();
                                if let Some(window) = app_handle.get_webview_window("main") {
                                    let _ = window.hide();
                                }
                            }
                        }
                    }
                });
                if !start_minimized {
                    window.show()?;
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
