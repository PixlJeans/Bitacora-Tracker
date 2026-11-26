// ===== «Descargar de SETENA»: everything from the bitácora portal into the project folders =====
// 1. `setena_open` opens a window on the SETENA portal; the user logs in there (their own session).
//    The injected script (setena.js) adds a button that reads every bitácora and its events.
// 2. The script sends the result in chunks by navigating to https://bt-tracker.invalid/c?…, which this
//    window intercepts (and cancels) — no extra permissions for the remote site. Each chunk is acknowledged.
// 3. The frontend matches everything to the projects and calls `download_files`: the files (public links of
//    bitacora.setena.go.cr/documents/…) are downloaded with the system's curl into the right folders,
//    skipping the ones already there.

use std::collections::HashMap;
use std::sync::Mutex;

use base64::{engine::general_purpose::URL_SAFE, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::{clean_folder, data_dir, safe_name, AppState};

const SCRIPT: &str = include_str!("setena.js");
const PORTAL: &str = "https://bitacora.setena.go.cr/";

#[derive(Default)]
pub struct SetenaState {
    chunks: Mutex<HashMap<String, Vec<Option<String>>>>,
    downloading: Mutex<bool>,
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
pub async fn setena_open(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("setena") {
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    let h = app.clone();
    WebviewWindowBuilder::new(&app, "setena", WebviewUrl::External(PORTAL.parse().map_err(|e| format!("{e}"))?))
        .title("SETENA · Bitácora Digital — Descargar a Bitácora Tracker")
        .inner_size(1100.0, 800.0)
        .initialization_script(SCRIPT)
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

/// Downloads the files into their folders (in the background); progress in the event «download-progress».
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
        let mut p = Progress { done: 0, total, saved: 0, skipped: 0, failed: 0, finished: false };
        for it in items {
            p.done += 1;
            let ok_url = it.url.starts_with("https://bitacora.setena.go.cr/documents/") && !it.url.contains("..");
            let dir = base.join(clean_folder(&it.folder));
            let to = dir.join(safe_name(&it.name));
            if !ok_url {
                p.failed += 1;
            } else if to.exists() {
                p.skipped += 1;
            } else if std::fs::create_dir_all(&dir).is_ok() {
                let part = dir.join(format!("{}.descargando", safe_name(&it.name)));
                if curl(&it.url, &part) && std::fs::rename(&part, &to).is_ok() {
                    p.saved += 1;
                } else {
                    let _ = std::fs::remove_file(&part);
                    p.failed += 1;
                }
            } else {
                p.failed += 1;
            }
            if p.done % 5 == 0 || p.done == total {
                let _ = app.emit("download-progress", p.clone());
            }
        }
        p.finished = true;
        let _ = app.emit("download-progress", p.clone());
        if let Ok(mut busy) = app.state::<SetenaState>().downloading.lock() {
            *busy = false;
        }
    });
    Ok(total)
}
