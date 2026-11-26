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
//  5. Photos and files of each project in <data>/Proyectos/<code - name>/<year>/<month>/Fotos|Regencias
//     (photos from the phone arrive in <data>/proyectos/<code>/ and the app moves them: phone.rs).
// All the date logic lives in TypeScript (src/lib/schedule.ts); here we only check `at <= now < until`.
// File and folder names on disk (bitacoras.json, respaldos/, proyectos/…) are kept from earlier
// versions so existing data keeps working; they are also what the user sees in Documents.

mod phone;
mod setena;

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

    // The Friday summary always goes on its own
    for a in due.iter().filter(|a| a.kind == "weekly") {
        notify(app, &a.title, &a.body);
    }
    let rest: Vec<&Reminder> = due.iter().filter(|a| a.kind != "weekly").collect();
    // Many at once (e.g. on the first day of the month): a single grouped notification.
    if rest.len() > 3 {
        let monthly = rest.iter().filter(|a| a.kind == "monthly").count();
        let list: Vec<String> = rest.iter().take(4).map(|a| a.title.clone()).collect();
        notify(
            app,
            &format!("📋 {} avisos ({} bitácoras)", rest.len(), monthly),
            &list.join("\n"),
        );
    } else {
        for a in &rest {
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
    // Web links (Google Maps, SETENA) go to the default browser through the URL handler: `explorer` does not
    // open links with «?» / «&» reliably. Folders and files still open with the explorer.
    let t = target.as_ref();
    let is_link = t.to_string_lossy().starts_with("http://") || t.to_string_lossy().starts_with("https://");
    if is_link {
        std::process::Command::new("rundll32").arg("url.dll,FileProtocolHandler").arg(t).spawn().map(|_| ()).map_err(|e| e.to_string())
    } else {
        std::process::Command::new("explorer").arg(t).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
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

/// Readable folder name (keeps spaces and accents; removes what Windows / macOS don't allow).
pub(crate) fn folder_name(s: &str) -> String {
    let clean: String = s
        .chars()
        .map(|c| if c.is_control() || "\\/:*?\"<>|".contains(c) { '-' } else { c })
        .collect();
    let clean = clean.trim().trim_matches('.').trim().to_string();
    if clean.is_empty() { "Sin nombre".into() } else { clean.chars().take(120).collect() }
}

/// Relative folder (e.g. «Proyectos/D1-0170-2020 - CONDOMINIO/2026/11 - Noviembre/Fotos»), each part cleaned.
pub(crate) fn clean_folder(rel: &str) -> PathBuf {
    rel.split(['/', '\\']).filter(|p| !p.trim().is_empty() && *p != "..").map(folder_name).collect()
}

fn rel_string(base: &Path, p: &Path) -> String {
    p.strip_prefix(base).unwrap_or(p).components().map(|c| c.as_os_str().to_string_lossy().to_string()).collect::<Vec<_>>().join("/")
}

/// Free file name inside `folder` (adds «2_», «3_»… if it already exists).
fn free_name(folder: &Path, name: &str) -> String {
    let mut file = safe_name(name);
    let mut n = 1;
    while folder.join(&file).exists() {
        n += 1;
        file = safe_name(&format!("{n}_{name}"));
    }
    file
}

/// Saves a file (base64) in <data>/<folder>/ (organized by project, year and month) and, if given,
/// its thumbnail in <data>/.miniaturas/ (so the project folders only hold the real files).
#[tauri::command]
fn save_attachment(code: String, name: String, data: String, thumb: Option<String>, folder: Option<String>, state: State<'_, AppState>) -> Result<Saved, String> {
    let base = data_dir(&state)?;
    let dir = match folder.as_deref() {
        Some(f) if !f.trim().is_empty() => base.join(clean_folder(f)),
        _ => project_folder(&base, &code),
    };
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = free_name(&dir, &name);
    let bytes = STANDARD.decode(data.as_bytes()).map_err(|e| e.to_string())?;
    fs::write(dir.join(&file), bytes).map_err(|e| e.to_string())?;
    let mut thumb_rel = None;
    if let Some(t) = thumb {
        if let Ok(tb) = STANDARD.decode(t.as_bytes()) {
            let tdir = base.join(".miniaturas").join(safe_name(&code));
            if fs::create_dir_all(&tdir).is_ok() {
                let tn = free_name(&tdir, &format!("{file}.mini.jpg"));
                if fs::write(tdir.join(&tn), tb).is_ok() {
                    thumb_rel = Some(rel_string(&base, &tdir.join(&tn)));
                }
            }
        }
    }
    Ok(Saved { path: rel_string(&base, &dir.join(&file)), thumb: thumb_rel })
}

/// Moves a saved file to another folder of the data folder (to keep everything organized). Returns its new path.
#[tauri::command]
fn move_attachment(path: String, folder: String, state: State<'_, AppState>) -> Result<String, String> {
    let base = data_dir(&state)?;
    let from = inside_path(&base, &path)?;
    let dir = base.join(clean_folder(&folder));
    if from.parent() == Some(dir.as_path()) {
        return Ok(rel_string(&base, &from));
    }
    if !from.exists() {
        return Err(format!("No existe: {path}"));
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = from.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "archivo".into());
    let to = dir.join(free_name(&dir, &name));
    if fs::rename(&from, &to).is_err() {
        fs::copy(&from, &to).map_err(|e| e.to_string())?;
        let _ = fs::remove_file(&from);
    }
    // the old folder goes away if it is now empty (e.g. a month's SETENA folder once sorted)
    if let Some(old) = from.parent() {
        let _ = fs::remove_dir(old);
    }
    Ok(rel_string(&base, &to))
}

/// Moves every file of one folder of the data folder to another (when an inspection or Regencia is moved
/// to another month). Removes the old folder, and its month / year folders, if they end up empty.
#[tauri::command]
fn move_folder_files(from: String, to: String, state: State<'_, AppState>) -> Result<u32, String> {
    let base = data_dir(&state)?;
    let src = base.join(clean_folder(&from));
    let dst = base.join(clean_folder(&to));
    if src == dst || !src.is_dir() {
        return Ok(0);
    }
    fs::create_dir_all(&dst).map_err(|e| e.to_string())?;
    let mut n = 0;
    for e in fs::read_dir(&src).map_err(|e| e.to_string())?.flatten() {
        let p = e.path();
        if !p.is_file() {
            continue;
        }
        let name = e.file_name().to_string_lossy().to_string();
        let target = dst.join(free_name(&dst, &name));
        if fs::rename(&p, &target).is_err() {
            fs::copy(&p, &target).map_err(|e| e.to_string())?;
            let _ = fs::remove_file(&p);
        }
        n += 1;
    }
    // clean up empty folders: …/Regencias → …/11 - Noviembre → …/2026 (never above the project folder)
    let mut dir = Some(src.as_path());
    for _ in 0..3 {
        match dir {
            Some(d) if d.starts_with(&base) && fs::remove_dir(d).is_ok() => dir = d.parent(),
            _ => break,
        }
    }
    Ok(n)
}

#[derive(Serialize)]
struct TreeFile {
    path: String,
    size: u64,
    modified: u64,
}

/// Every file under a folder of the data folder (up to 4 levels deep), with its path relative to the data folder.
#[tauri::command]
fn list_tree(folder: String, state: State<'_, AppState>) -> Result<Vec<TreeFile>, String> {
    let base = data_dir(&state)?;
    let root = base.join(clean_folder(&folder));
    let mut out = Vec::new();
    let mut stack = vec![(root, 0u8)];
    while let Some((dir, depth)) = stack.pop() {
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name.starts_with("~$") {
                continue;
            }
            if p.is_dir() {
                if depth < 4 {
                    stack.push((p, depth + 1));
                }
            } else if let Ok(m) = e.metadata() {
                let modified = m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
                out.push(TreeFile { path: rel_string(&base, &p), size: m.len(), modified });
            }
        }
    }
    Ok(out)
}

/// The first bytes of a file (base64): enough to read a photo's EXIF date and GPS without loading it all.
#[tauri::command]
fn read_head(path: String, max: u64, state: State<'_, AppState>) -> Result<String, String> {
    use std::io::Read;
    let p = inside_path(&data_dir(&state)?, &path)?;
    let mut buf = Vec::new();
    fs::File::open(p).map_err(|e| e.to_string())?.take(max.min(1_048_576)).read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(buf))
}

/// Names of the files in a folder of the data folder (no subfolders, no hidden files); empty if it doesn't exist.
#[tauri::command]
fn list_folder(folder: String, state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let dir = data_dir(&state)?.join(clean_folder(&folder));
    let mut out = Vec::new();
    if let Ok(rd) = fs::read_dir(&dir) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if e.path().is_file() && !name.starts_with('.') && !name.starts_with("~$") && name != "desktop.ini" && name != "Thumbs.db" {
                out.push(name);
            }
        }
    }
    out.sort();
    Ok(out)
}

/// Opens a folder of the data folder in the file explorer (creates it if needed).
#[tauri::command]
fn open_folder(folder: String, state: State<'_, AppState>) -> Result<(), String> {
    let dir = data_dir(&state)?.join(clean_folder(&folder));
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    open_in_system(dir.as_os_str())
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
            app.manage(setena::SetenaState::default());
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
                // the SETENA window is hidden too, not closed: it keeps the login for the next project
                if window.label() == "main" || window.label() == "setena" {
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
            move_attachment,
            open_folder,
            list_folder,
            move_folder_files,
            list_tree,
            read_head,
            open_setena,
            open_map,
            phone::phone_start,
            phone::phone_projects,
            phone::phone_tasks,
            setena::setena_open,
            setena::download_files
        ])
        .build(tauri::generate_context!())
        .expect("error while starting Bitácora Tracker")
        .run(on_run_event);
}
