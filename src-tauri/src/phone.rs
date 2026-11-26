// ===== Photos from the phone over Wi-Fi (no cloud, no accounts) =====
// The app starts a tiny server on the local network only, protected by a random key that goes in the QR.
// The phone opens the page, picks the project, takes or picks photos and writes a note; each photo is
// saved straight into <data folder>/proyectos/<code>/ and the app creates the «Por subir» log entry.

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::{data_dir, project_folder, safe_name, AppState};

const PAGE: &str = include_str!("phone.html");
const PORTS: [u16; 6] = [47810, 47811, 47812, 47813, 47814, 47815];

#[derive(Default)]
pub struct PhoneServer {
    info: Mutex<Option<PhoneInfo>>,
    projects: Mutex<String>,
}

#[derive(Clone, Serialize)]
pub struct PhoneInfo {
    pub url: String,
    pub svg: String,
}

/// One photo (or the note alone) sent by the phone page.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Upload {
    batch: String,
    code: String,
    date: String,
    #[serde(default)]
    note: String,
    name: String,
    data: String,
    #[serde(default)]
    thumb: String,
    #[serde(default)]
    index: u32,
    #[serde(default)]
    total: u32,
    /// Date and GPS read from the ORIGINAL photo on the phone (they are lost when it is shrunk).
    #[serde(default)]
    taken_on: Option<String>,
    #[serde(default)]
    lat: Option<f64>,
    #[serde(default)]
    lng: Option<f64>,
}

/// What the frontend receives (event «phone-upload») for each saved photo.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Received {
    batch: String,
    code: String,
    date: String,
    note: String,
    name: String,
    path: String,
    thumb: Option<String>,
    index: u32,
    total: u32,
    taken_on: Option<String>,
    lat: Option<f64>,
    lng: Option<f64>,
}

fn random_key() -> String {
    let mut a = RandomState::new().build_hasher();
    a.write_u128(crate::now_ms() as u128);
    let mut b = RandomState::new().build_hasher();
    b.write_u64(a.finish());
    format!("{:016x}{:016x}", a.finish(), b.finish())
}

/// QR as SVG drawn by hand from the matrix (no optional render features needed).
fn qr_svg(text: &str) -> Result<String, String> {
    let code = qrcode::QrCode::new(text.as_bytes()).map_err(|e| e.to_string())?;
    let n = code.width();
    let colors = code.to_colors();
    let border = 2usize;
    let size = n + border * 2;
    let mut path = String::new();
    for y in 0..n {
        for x in 0..n {
            if colors[y * n + x] == qrcode::Color::Dark {
                path.push_str(&format!("M{} {}h1v1h-1z", x + border, y + border));
            }
        }
    }
    Ok(format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {size} {size}\" shape-rendering=\"crispEdges\"><rect width=\"{size}\" height=\"{size}\" fill=\"#fff\"/><path d=\"{path}\" fill=\"#000\"/></svg>"
    ))
}

fn query_param(url: &str, name: &str) -> Option<String> {
    let q = url.split_once('?')?.1;
    q.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        if k == name { Some(v.to_string()) } else { None }
    })
}

fn respond(req: tiny_http::Request, status: u16, content_type: &str, body: String) {
    let header = tiny_http::Header::from_bytes(&b"Content-Type"[..], content_type.as_bytes()).ok();
    let mut r = tiny_http::Response::from_string(body).with_status_code(status);
    if let Some(h) = header {
        r = r.with_header(h);
    }
    let _ = req.respond(r);
}

fn save_upload(app: &AppHandle, s: &Upload) -> Result<Received, String> {
    let state = app.state::<AppState>();
    let base = data_dir(&state)?;
    let folder = project_folder(&base, &s.code);
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let name = safe_name(&format!("{}_{}_{}", s.date, s.batch.chars().take(6).collect::<String>(), s.name));
    let bytes = STANDARD.decode(s.data.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::write(folder.join(&name), bytes).map_err(|e| e.to_string())?;
    let mut thumb = None;
    if !s.thumb.is_empty() {
        if let Ok(tb) = STANDARD.decode(s.thumb.as_bytes()) {
            let tn = format!("{name}.mini.jpg");
            if std::fs::write(folder.join(&tn), tb).is_ok() {
                thumb = Some(format!("proyectos/{}/{}", safe_name(&s.code), tn));
            }
        }
    }
    Ok(Received {
        batch: s.batch.clone(),
        code: s.code.clone(),
        date: s.date.clone(),
        note: s.note.clone(),
        name: s.name.clone(),
        path: format!("proyectos/{}/{}", safe_name(&s.code), name),
        thumb,
        index: s.index,
        total: s.total,
        taken_on: s.taken_on.clone(),
        lat: s.lat,
        lng: s.lng,
    })
}

fn serve(app: AppHandle, server: tiny_http::Server, token: String) {
    for mut req in server.incoming_requests() {
        let url = req.url().to_string();
        let route = url.split('?').next().unwrap_or("/").to_string();
        let method = req.method().clone();
        if query_param(&url, "t").as_deref() != Some(token.as_str()) {
            respond(req, 403, "text/plain; charset=utf-8", "Enlace vencido: vuelve a escanear el código QR en la computadora.".into());
            continue;
        }
        match (method, route.as_str()) {
            (tiny_http::Method::Get, "/") => respond(req, 200, "text/html; charset=utf-8", PAGE.to_string()),
            (tiny_http::Method::Get, "/projects") => {
                let list = app.state::<PhoneServer>().projects.lock().map(|g| g.clone()).unwrap_or_default();
                respond(req, 200, "application/json; charset=utf-8", if list.is_empty() { "[]".into() } else { list });
            }
            (tiny_http::Method::Post, "/upload") => {
                let mut body = String::new();
                if let Err(e) = req.as_reader().read_to_string(&mut body) {
                    respond(req, 400, "text/plain; charset=utf-8", e.to_string());
                    continue;
                }
                match serde_json::from_str::<Upload>(&body).map_err(|e| e.to_string()).and_then(|s| save_upload(&app, &s)) {
                    Ok(rec) => {
                        let _ = app.emit("phone-upload", &rec);
                        respond(req, 200, "application/json", "{\"ok\":true}".into());
                    }
                    Err(e) => respond(req, 500, "text/plain; charset=utf-8", e),
                }
            }
            _ => respond(req, 404, "text/plain; charset=utf-8", "No encontrado".into()),
        }
    }
}

/// Starts the server (once per session) and returns the address and the QR.
#[tauri::command]
pub fn phone_start(app: AppHandle, phone: State<'_, PhoneServer>) -> Result<PhoneInfo, String> {
    let mut info = phone.info.lock().map_err(|e| e.to_string())?;
    if let Some(i) = info.as_ref() {
        return Ok(i.clone());
    }
    let ip = local_ip_address::local_ip().map_err(|_| "No hay conexión de red: conecta la computadora al Wi-Fi.".to_string())?;
    let mut chosen = None;
    for p in PORTS {
        if let Ok(s) = tiny_http::Server::http(format!("0.0.0.0:{p}")) {
            chosen = Some((s, p));
            break;
        }
    }
    let (server, port) = chosen.ok_or_else(|| "No se pudo abrir el puerto para el celular.".to_string())?;
    let token = random_key();
    let url = format!("http://{ip}:{port}/?t={token}");
    let svg = qr_svg(&url)?;
    let h = app.clone();
    std::thread::spawn(move || serve(h, server, token));
    let i = PhoneInfo { url, svg };
    *info = Some(i.clone());
    Ok(i)
}

/// The project list the phone sees ({code, name}); sent by the frontend.
#[tauri::command]
pub fn phone_projects(json: String, phone: State<'_, PhoneServer>) -> Result<(), String> {
    let mut g = phone.projects.lock().map_err(|e| e.to_string())?;
    *g = json;
    Ok(())
}
