// ===== «Descargar de SETENA»: everything from the bitácora portal into the project folders =====
// 1. `setena_open` opens a window on the SETENA portal; the user logs in there (their own session).
//    The injected script (setena.js) adds a button that reads every bitácora and its events.
// 2. The script sends the result in chunks by navigating to https://bt-tracker.invalid/c?…, which this
//    window intercepts (and cancels) — no extra permissions for the remote site. Each chunk is acknowledged.
// 3. The frontend matches everything to the projects and calls `download_files`: the files (public links of
//    bitacora.setena.go.cr/documents/…) are downloaded with the system's curl into the right folders,
//    skipping the ones already there.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use base64::{engine::general_purpose::URL_SAFE, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::{clean_folder, data_dir, safe_name, AppState};

const SCRIPT: &str = include_str!("setena.js");
const PORTAL: &str = "https://bitacora.setena.go.cr/";

#[derive(Default)]
pub struct SetenaState {
    chunks: Mutex<HashMap<String, Vec<Option<String>>>>,
    downloading: Mutex<bool>,
    /// The project page to show once the user is logged in (the login always returns to the portal's home)
    pending: Mutex<Option<tauri::Url>>,
}

fn query(url: &tauri::Url, name: &str) -> Option<String> {
    url.query_pairs().find(|(k, _)| k == name).map(|(_, v)| v.to_string())
}

/// One chunk from the portal window. Returns the whole JSON when the last one arrives.
fn take_chunk(app: &AppHandle, url: &tauri::Url) -> Option<String> {
    let id = query(url, "id")?;
    let i: usize = query(url, "i")?.parse().ok()?;
    let n: usize = query(url, "n")?.parse().ok()?;
    let d = query(url, "d")?;
    if n == 0 || i >= n || n > 100_000 {
        return None;
    }
    let state = app.state::<SetenaState>();
    let mut all = state.chunks.lock().ok()?;
    let v = all.entry(id.clone()).or_insert_with(|| vec![None; n]);
    if v.len() != n {
        return None;
    }
    v[i] = Some(d);
    // acknowledge (the page waits for it before sending the next one)
    if let Some(w) = app.get_webview_window("setena") {
        let _ = w.eval(&format!("window.__btAck && window.__btAck({i})"));
    }
    if v.iter().all(|x| x.is_some()) {
        let b64: String = v.iter().map(|x| x.as_deref().unwrap_or("")).collect();
        all.remove(&id);
        let bytes = URL_SAFE.decode(b64.as_bytes()).ok()?;
        return String::from_utf8(bytes).ok();
    }
    None
}

/// Opens (or shows) the SETENA portal window.
/// `async` on purpose: on Windows, creating a window from a synchronous command blocks it (white page).
#[tauri::command]
pub async fn setena_open(app: AppHandle, url: Option<String>) -> Result<(), String> {
    // a project's own page in the portal, or the portal's start page
    let target: tauri::Url = match url {
        Some(u) if u.starts_with("https://bitacora.setena.go.cr/") => u.parse().map_err(|e| format!("{e}"))?,
        _ => PORTAL.parse().map_err(|e| format!("{e}"))?,
    };
    {
        let wanted = if target.as_str() == PORTAL { None } else { Some(target.clone()) };
        let st = app.state::<SetenaState>();
        let mut guard = st.pending.lock().map_err(|e| e.to_string())?;
        *guard = wanted;
        drop(guard);
    }
    if let Some(w) = app.get_webview_window("setena") {
        let _ = w.navigate(target);
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        return Ok(());
    }
    let h = app.clone();
    WebviewWindowBuilder::new(&app, "setena", WebviewUrl::External(target))
        .title("SETENA · Bitácora Digital — Descargar a Bitácora Tracker")
        .inner_size(1100.0, 800.0)
        .initialization_script(SCRIPT)
        // and again when each page finishes loading (in case the start script didn't run on that page)
        .on_page_load(|w, payload| {
            if !matches!(payload.event(), PageLoadEvent::Finished) {
                return;
            }
            let _ = w.eval(SCRIPT);
            // Logged in and back on the portal: go to the project that was asked for
            let url = payload.url().clone();
            if url.host_str() == Some("bitacora.setena.go.cr") {
                let st = w.state::<SetenaState>();
                let next = match st.pending.lock() {
                    Ok(mut p) => p.take(),
                    Err(_) => None,
                };
                if let Some(next) = next {
                    if next.path() != url.path() || next.query() != url.query() {
                        let _ = w.navigate(next);
                    }
                }
            }
        })
        .on_navigation(move |url| {
            if url.host_str() != Some("bt-tracker.invalid") {
                return true;
            }
            let app = h.clone();
            let url = url.clone();
            std::thread::spawn(move || {
                if let Some(json) = take_chunk(&app, &url) {
                    let _ = app.emit("setena-manifest", json);
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                    }
                }
            });
            false
        })
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Deserialize)]
pub struct Download {
    url: String,
    folder: String,
    name: String,
}

#[derive(Clone, Serialize)]
struct Progress {
    done: usize,
    total: usize,
    saved: usize,
    skipped: usize,
    failed: usize,
    finished: bool,
}

fn curl(url: &str, to: &std::path::Path) -> bool {
    let mut cmd = std::process::Command::new("curl");
    cmd.args(["-sSfL", "--retry", "2", "--max-time", "300", "-o"]).arg(to).arg(url);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // no console window
    }
    matches!(cmd.status(), Ok(s) if s.success())
}

/// Every file name under a folder (any depth): to know what is already there, wherever it was moved.
fn names_under(dir: &std::path::Path) -> HashSet<String> {
    let mut out = HashSet::new();
    let mut stack = vec![(dir.to_path_buf(), 0u8)];
    while let Some((d, depth)) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                if depth < 6 {
                    stack.push((p, depth + 1));
                }
            } else {
                out.insert(e.file_name().to_string_lossy().to_lowercase());
            }
        }
    }
    out
}

/// Downloads the files into their folders (in the background); progress in the event «download-progress».
/// Never replaces anything: a file is skipped if it was downloaded before (list kept in <data>/.setena/descargados.txt,
/// so a file you renamed, moved or deleted doesn't come back) or if a file with its name is anywhere in the project.
#[tauri::command]
pub fn download_files(app: AppHandle, items: Vec<Download>, state: State<'_, SetenaState>) -> Result<usize, String> {
    {
        let mut busy = state.downloading.lock().map_err(|e| e.to_string())?;
        if *busy {
            return Err("Ya hay una descarga en curso.".into());
        }
        *busy = true;
    }
    let base = data_dir(&app.state::<AppState>())?;
    let total = items.len();
    std::thread::spawn(move || {
        let ledger_file = base.join(".setena").join("descargados.txt");
        let mut ledger: HashSet<String> = std::fs::read_to_string(&ledger_file)
            .unwrap_or_default()
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect();
        let mut new_lines: Vec<String> = Vec::new();
        let mut known: HashMap<std::path::PathBuf, HashSet<String>> = HashMap::new();
        let save_ledger = |lines: &mut Vec<String>| {
            if lines.is_empty() {
                return;
            }
            let _ = std::fs::create_dir_all(base.join(".setena"));
            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&ledger_file) {
                use std::io::Write;
                let _ = f.write_all((lines.join("\n") + "\n").as_bytes());
            }
            lines.clear();
        };
        let mut p = Progress { done: 0, total, saved: 0, skipped: 0, failed: 0, finished: false };
        for it in items {
            p.done += 1;
            let ok_url = it.url.starts_with("https://bitacora.setena.go.cr/documents/") && !it.url.contains("..");
            let dir = base.join(clean_folder(&it.folder));
            let name = safe_name(&it.name);
            let to = dir.join(&name);
            // the project's own folder (Proyectos/<Código - Nombre>): every name already in it
            let project = base.join(clean_folder(&it.folder.split('/').take(2).collect::<Vec<_>>().join("/")));
            let names = known.entry(project.clone()).or_insert_with(|| names_under(&project));
            if !ok_url {
                p.failed += 1;
            } else if ledger.contains(&it.url) || to.exists() || names.contains(&name.to_lowercase()) {
                p.skipped += 1;
                if ledger.insert(it.url.clone()) {
                    new_lines.push(it.url.clone());
                }
            } else if std::fs::create_dir_all(&dir).is_ok() {
                let part = dir.join(format!("{name}.descargando"));
                if curl(&it.url, &part) && !to.exists() && std::fs::rename(&part, &to).is_ok() {
                    p.saved += 1;
                    names.insert(name.to_lowercase());
                    ledger.insert(it.url.clone());
                    new_lines.push(it.url.clone());
                } else {
                    let _ = std::fs::remove_file(&part);
                    p.failed += 1;
                }
            } else {
                p.failed += 1;
            }
            if p.done % 5 == 0 || p.done == total {
                save_ledger(&mut new_lines);
                let _ = app.emit("download-progress", p.clone());
            }
        }
        save_ledger(&mut new_lines);
        p.finished = true;
        let _ = app.emit("download-progress", p.clone());
        if let Ok(mut busy) = app.state::<SetenaState>().downloading.lock() {
            *busy = false;
        }
    });
    Ok(total)
}
