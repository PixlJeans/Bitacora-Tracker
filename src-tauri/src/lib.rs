// ===== Bitácora Tracker: native process (Tauri 2) =====
// Responsibilities:
//  1. Save the data in a folder the user can SEE (Documents/Bitácora Tracker by default), with a .bak
//     copy and daily backups in «respaldos/». The folder can be changed (e.g. to OneDrive) and copied
//     as-is to another computer, Windows or macOS.
//  2. Receive from the frontend the flat list of already-computed reminders and fire them as native
//     Windows / macOS notifications when they are due, even with the window closed to the tray
//     (a thread checks every 30 s).
//  3. System tray: closing the window hides it; «Salir» really quits.
//  4. Starts with the system (hidden, with --minimized) and single instance.
//  5. Photos and files of each project in <data>/proyectos/<code>/ (and photos from the phone: phone.rs).
// All the date logic lives in TypeScript (src/lib/schedule.ts); here we only check `at <= now < until`.
// File and folder names on disk (bitacoras.json, respaldos/, proyectos/…) are kept from earlier
// versions so existing data keeps working; they are also what the user sees in Documents.

mod phone;

use std::collections::HashMap;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_notification::NotificationExt;

const DATA_FILE: &str = "bitacoras.json";
const BAK_FILE: &str = "bitacoras.bak.json";
const REMINDERS_FILE: &str = "avisos.json";
const FIRED_FILE: &str = "disparados.json";
const FOLDER_CHOICE_FILE: &str = "ubicacion.txt";
const FOLDER_NAME: &str = "Bitácora Tracker";
const MAX_AUTO_BACKUPS: usize = 20;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Reminder {
    pub key: String,
    pub at: i64,
    pub until: i64,
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub kind: String,
    #[serde(rename = "ref", default)]
    pub reference: String,
}

struct AppState {
    /// Internal state (scheduled reminders, already fired, chosen data folder): the app's own folder.
    dir: PathBuf,
    /// User data: a visible, portable folder.
    data: Mutex<PathBuf>,
    reminders: Mutex<Vec<Reminder>>,
    fired: Mutex<HashMap<String, i64>>,
}

pub(crate) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn write_atomic(path: &Path, content: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, content)?;
    fs::rename(&tmp, path)
}

fn read_json<T: serde::de::DeserializeOwned + Default>(path: &Path) -> T {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// User data folder: the one chosen in Settings, or Documents/Bitácora Tracker.
fn user_folder(app: &AppHandle, internal: &Path) -> PathBuf {
    if let Ok(txt) = fs::read_to_string(internal.join(FOLDER_CHOICE_FILE)) {
        let p = PathBuf::from(txt.trim());
        if p.is_dir() {
            return p;
        }
    }
    let base = app
        .path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .unwrap_or_else(|_| internal.to_path_buf());
    base.join(FOLDER_NAME)
}

pub(crate) fn data_dir(state: &AppState) -> Result<PathBuf, String> {
    state.data.lock().map(|g| g.clone()).map_err(|e| e.to_string())
}

/// File/folder name without characters that are a problem on Windows or macOS.
pub(crate) fn safe_name(s: &str) -> String {
    let clean: String = s
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' { c } else { '_' })
        .collect();
    let clean = clean.trim_matches('.').to_string();
    if clean.is_empty() { "archivo".into() } else { clean.chars().take(120).collect() }
}

pub(crate) fn project_folder(base: &Path, code: &str) -> PathBuf {
    base.join("proyectos").join(safe_name(code))
}

/// Relative path inside the data folder (no «..» and no absolute paths).
fn inside_path(base: &Path, rel: &str) -> Result<PathBuf, String> {
    let p = Path::new(rel);
    if p.is_absolute() || p.components().any(|c| matches!(c, std::path::Component::ParentDir | std::path::Component::Prefix(_) | std::path::Component::RootDir)) {
        return Err("Ruta inválida".into());
    }
    Ok(base.join(p))
}

fn show_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn notify(app: &AppHandle, title: &str, body: &str) {
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        eprintln!("Could not show the notification: {e}");
    }
}

/// Fires the reminders that are due and have not been shown yet.
fn check_reminders(app: &AppHandle) {
    let state = app.state::<AppState>();
    let now = now_ms();
    let mut due: Vec<Reminder> = Vec::new();
    {
        let reminders = match state.reminders.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        let mut fired = match state.fired.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        for a in reminders.iter() {
            if a.at <= now && now < a.until && !fired.contains_key(&a.key) {
                fired.insert(a.key.clone(), now);
                due.push(a.clone());
            }
        }
        if due.is_empty() {
            return;
        }
        let cutoff = now - 400 * 86_400_000;
        fired.retain(|_, t| *t > cutoff);
        if let Ok(json) = serde_json::to_string(&*fired) {
            let _ = write_atomic(&state.dir.join(FIRED_FILE), &json);
        }
    }

    // Many at once (e.g. on the first day of the month): a single grouped notification.
    if due.len() > 3 {
        let monthly = due.iter().filter(|a| a.kind == "monthly").count();
        let list: Vec<String> = due.iter().take(4).map(|a| a.title.clone()).collect();
        notify(
            app,
            &format!("📋 {} avisos de bitácoras ({} informes regenciales)", due.len(), monthly),
            &list.join("\n"),
        );
    } else {
        for a in &due {
            notify(app, &a.title, &a.body);
        }
    }
    // Cards inside the app (if the window is open)
    let _ = app.emit("reminders", &due);
}

// ---------------- Commands called by the frontend ----------------

#[tauri::command]
fn load_data(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let dir = data_dir(&state)?;
    let path = dir.join(DATA_FILE);
    let bak = dir.join(BAK_FILE);
    match fs::read_to_string(&path) {
        Ok(s) if serde_json::from_str::<serde_json::Value>(&s).is_ok() => Ok(Some(s)),
        _ => match fs::read_to_string(&bak) {
            Ok(s) => Ok(Some(s)),
            Err(_) => Ok(None),
        },
    }
}

#[tauri::command]
fn save_data(json: String, state: State<'_, AppState>) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&json).map_err(|e| format!("Datos inválidos: {e}"))?;
    let dir = data_dir(&state)?;
    let path = dir.join(DATA_FILE);
    if path.exists() {
        let _ = fs::copy(&path, dir.join(BAK_FILE));
    }
    write_atomic(&path, &json).map_err(|e| e.to_string())
}

/// Saves a backup in <data folder>/respaldos/<name>. «auto-*» ones are capped at the 20 most recent.
#[tauri::command]
fn backup(name: String, content: String, state: State<'_, AppState>) -> Result<String, String> {
    let clean: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_' || *c == '.')
        .collect();
    if clean.is_empty() {
        return Err("Nombre de respaldo inválido".into());
    }
    let folder = data_dir(&state)?.join("respaldos");
    let path = folder.join(&clean);
    write_atomic(&path, &content).map_err(|e| e.to_string())?;
    if let Ok(entries) = fs::read_dir(&folder) {
        let mut autos: Vec<PathBuf> = entries
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.starts_with("auto-"))
                    .unwrap_or(false)
            })
            .collect();
        autos.sort();
        while autos.len() > MAX_AUTO_BACKUPS {
            let oldest = autos.remove(0);
            let _ = fs::remove_file(oldest);
        }
    }
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn open_data_folder(state: State<'_, AppState>) -> Result<(), String> {
    let dir = data_dir(&state)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    open_in_system(dir.as_os_str())
}

#[cfg(target_os = "windows")]
fn open_in_system<S: AsRef<OsStr>>(target: S) -> Result<(), String> {
    std::process::Command::new("explorer").arg(target).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn open_in_system<S: AsRef<OsStr>>(target: S) -> Result<(), String> {
    std::process::Command::new("open").arg(target).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn open_in_system<S: AsRef<OsStr>>(target: S) -> Result<(), String> {
    std::process::Command::new("xdg-open").arg(target).spawn().map(|_| ()).map_err(|e| e.to_string())
}

// ---------------- Photos and files of each project ----------------

#[derive(Serialize)]
struct Saved {
    path: String,
    thumb: Option<String>,
}

/// Saves a file (base64) in <data>/proyectos/<code>/ and, if given, its thumbnail.
#[tauri::command]
fn save_attachment(code: String, name: String, data: String, thumb: Option<String>, state: State<'_, AppState>) -> Result<Saved, String> {
    let base = data_dir(&state)?;
    let folder = project_folder(&base, &code);
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let mut file = safe_name(&name);
    let mut n = 1;
    while folder.join(&file).exists() {
        n += 1;
        file = safe_name(&format!("{n}_{name}"));
    }
    let bytes = STANDARD.decode(data.as_bytes()).map_err(|e| e.to_string())?;
    fs::write(folder.join(&file), bytes).map_err(|e| e.to_string())?;
    let rel = format!("proyectos/{}/{}", safe_name(&code), file);
    let mut thumb_rel = None;
    if let Some(t) = thumb {
        if let Ok(tb) = STANDARD.decode(t.as_bytes()) {
            let tn = format!("{file}.mini.jpg");
            if fs::write(folder.join(&tn), tb).is_ok() {
                thumb_rel = Some(format!("proyectos/{}/{}", safe_name(&code), tn));
            }
        }
    }
    Ok(Saved { path: rel, thumb: thumb_rel })
}

/// Returns a small file (thumbnail) as base64 to show it in the app.
#[tauri::command]
fn read_file_b64(path: String, state: State<'_, AppState>) -> Result<String, String> {
    let p = inside_path(&data_dir(&state)?, &path)?;
    let bytes = fs::read(p).map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(bytes))
}

#[tauri::command]
fn open_attachment(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let p = inside_path(&data_dir(&state)?, &path)?;
    open_in_system(p.as_os_str())
}

#[tauri::command]
fn delete_attachment(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let base = data_dir(&state)?;
    let p = inside_path(&base, &path)?;
    // not really deleted: it goes to the app's «papelera» (trash) folder, just in case
    let trash = base.join("papelera");
    fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
    if let Some(name) = p.file_name() {
        let _ = fs::rename(&p, trash.join(name));
    }
    Ok(())
}

#[tauri::command]
fn open_project_folder(code: String, state: State<'_, AppState>) -> Result<(), String> {
    let folder = project_folder(&data_dir(&state)?, &code);
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    open_in_system(folder.as_os_str())
}

/// Opens a page in the system browser (only the SETENA portal).
#[tauri::command]
fn open_setena(url: String) -> Result<(), String> {
    if !url.starts_with("https://") || !url.contains("setena.go.cr") {
        return Err("Dirección no permitida".into());
    }
    open_in_system(url)
}

/// Opens Google Maps (a project's location or a day's route) in the browser.
#[tauri::command]
fn open_map(url: String) -> Result<(), String> {
    if !url.starts_with("https://www.google.com/maps/") || url.chars().any(|c| c.is_whitespace() || c == '"') {
        return Err("Dirección no permitida".into());
    }
    open_in_system(url)
}

/// Changes the data folder.
///  mode "probe": changes nothing; returns "exists" if the folder already has data, otherwise "empty".
///  mode "move":  copies the current data into the new folder (replacing what was there) and uses it.
///  mode "use":   uses the data already in the new folder (e.g. brought from another computer).
#[tauri::command]
fn change_folder(path: String, mode: String, state: State<'_, AppState>) -> Result<String, String> {
    let target = PathBuf::from(path.trim());
    if path.trim().is_empty() {
        return Err("Carpeta inválida".into());
    }
    let has_data = target.join(DATA_FILE).exists();
    if mode == "probe" {
        return Ok(if has_data { "exists".into() } else { "empty".into() });
    }
    fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    let current = data_dir(&state)?;
    if mode == "move" && current != target {
        let source = current.join(DATA_FILE);
        if source.exists() {
            if has_data {
                let _ = fs::copy(target.join(DATA_FILE), target.join(BAK_FILE));
            }
            fs::copy(&source, target.join(DATA_FILE)).map_err(|e| e.to_string())?;
        }
    }
    fs::write(state.dir.join(FOLDER_CHOICE_FILE), target.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
    let mut g = state.data.lock().map_err(|e| e.to_string())?;
    *g = target.clone();
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
fn schedule_reminders(reminders: Vec<Reminder>, app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let json = serde_json::to_string(&reminders).map_err(|e| e.to_string())?;
    {
        let mut guard = state.reminders.lock().map_err(|e| e.to_string())?;
        *guard = reminders;
    }
    write_atomic(&state.dir.join(REMINDERS_FILE), &json).map_err(|e| e.to_string())?;
    check_reminders(&app);
    Ok(())
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn data_folder(state: State<'_, AppState>) -> String {
    data_dir(&state).map(|p| p.to_string_lossy().to_string()).unwrap_or_default()
}

#[tauri::command]
fn test_reminder(app: AppHandle) -> Result<(), String> {
    notify(&app, "🔔 Bitácora Tracker", "Así se verán tus recordatorios de bitácoras.");
    let t = now_ms();
    let a = Reminder {
        key: format!("test:{t}"),
        at: t,
        until: t + 60_000,
        title: "🔔 Notificación de prueba".into(),
        body: "Así se verán tus recordatorios. También llegan como notificación del sistema.".into(),
        kind: "test".into(),
        reference: String::new(),
    };
    app.emit("reminders", vec![a]).map_err(|e| e.to_string())
}

// ---------------- Startup ----------------

#[cfg(target_os = "macos")]
fn on_run_event(app: &AppHandle, event: tauri::RunEvent) {
    // Click on the Dock icon while the window is hidden
    if let tauri::RunEvent::Reopen { .. } = event {
        show_window(app);
    }
}

#[cfg(not(target_os = "macos"))]
fn on_run_event(_app: &AppHandle, _event: tauri::RunEvent) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must go first: if the app is already running, just show the existing window
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_window(app)))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            fs::create_dir_all(&dir)?;
            let reminders: Vec<Reminder> = read_json(&dir.join(REMINDERS_FILE));
            let fired: HashMap<String, i64> = read_json(&dir.join(FIRED_FILE));
            // User data in a visible folder; v1.0/1.1 kept it in the app's hidden folder
            let data = user_folder(app.handle(), &dir);
            let _ = fs::create_dir_all(&data);
            if !data.join(DATA_FILE).exists() && dir.join(DATA_FILE).exists() {
                let _ = fs::copy(dir.join(DATA_FILE), data.join(DATA_FILE));
            }
            app.manage(phone::PhoneServer::default());
            app.manage(AppState {
                data: Mutex::new(data),
                dir,
                reminders: Mutex::new(reminders),
                fired: Mutex::new(fired),
            });

            // System tray
            let open = MenuItem::with_id(app, "open", "Abrir Bitácora Tracker", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .tooltip("Bitácora Tracker")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_window(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            // When started with the system it stays hidden in the tray
            if !std::env::args().any(|a| a == "--minimized") {
                show_window(app.handle());
            }

            // Periodic reminder check (keeps running while the window is hidden)
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(12));
                loop {
                    check_reminders(&handle);
                    std::thread::sleep(Duration::from_secs(30));
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Close = hide to the tray (reminders keep arriving)
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_data,
            save_data,
            schedule_reminders,
            write_file,
            data_folder,
            test_reminder,
            backup,
            open_data_folder,
            change_folder,
            save_attachment,
            read_file_b64,
            open_attachment,
            delete_attachment,
            open_project_folder,
            open_setena,
            open_map,
            phone::phone_start,
            phone::phone_projects
        ])
        .build(tauri::generate_context!())
        .expect("error while starting Bitácora Tracker")
        .run(on_run_event);
}
