// ===== Bitácora Tracker: proceso nativo (Tauri 2) =====
// Responsabilidades:
//  1. Guardar los datos en un archivo local (carpeta de datos de la app), con copia .bak.
//  2. Recibir del frontend la lista plana de avisos ya calculados y dispararlos como
//     notificaciones nativas de Windows / macOS cuando llega la hora, aunque la ventana
//     esté cerrada en la bandeja (un hilo revisa cada 30 s).
//  3. Bandeja del sistema: cerrar la ventana la oculta; «Salir» la cierra de verdad.
//  4. Inicio automático con el sistema (arranca oculta con --minimized) e instancia única.
// Toda la lógica de fechas vive en TypeScript (src/lib/avisos.ts); aquí solo se compara `at <= ahora < until`.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_notification::NotificationExt;

const ARCHIVO_DATOS: &str = "bitacoras.json";
const ARCHIVO_BAK: &str = "bitacoras.bak.json";
const ARCHIVO_AVISOS: &str = "avisos.json";
const ARCHIVO_DISPARADOS: &str = "disparados.json";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Aviso {
    pub key: String,
    pub at: i64,
    pub until: i64,
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub kind: String,
    #[serde(rename = "ref", default)]
    pub referencia: String,
}

struct Estado {
    dir: PathBuf,
    avisos: Mutex<Vec<Aviso>>,
    disparados: Mutex<HashMap<String, i64>>,
}

fn ahora() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn escribir_atomico(ruta: &Path, contenido: &str) -> std::io::Result<()> {
    if let Some(padre) = ruta.parent() {
        fs::create_dir_all(padre)?;
    }
    let tmp = ruta.with_extension("tmp");
    fs::write(&tmp, contenido)?;
    fs::rename(&tmp, ruta)
}

fn leer_json<T: serde::de::DeserializeOwned + Default>(ruta: &Path) -> T {
    fs::read_to_string(ruta)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn mostrar(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn notificar(app: &AppHandle, titulo: &str, cuerpo: &str) {
    if let Err(e) = app.notification().builder().title(titulo).body(cuerpo).show() {
        eprintln!("No se pudo mostrar la notificación: {e}");
    }
}

/// Dispara los avisos que ya tocan y aún no se han mostrado.
fn revisar(app: &AppHandle) {
    let estado = app.state::<Estado>();
    let now = ahora();
    let mut nuevos: Vec<Aviso> = Vec::new();
    {
        let avisos = match estado.avisos.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        let mut disparados = match estado.disparados.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        for a in avisos.iter() {
            if a.at <= now && now < a.until && !disparados.contains_key(&a.key) {
                disparados.insert(a.key.clone(), now);
                nuevos.push(a.clone());
            }
        }
        if nuevos.is_empty() {
            return;
        }
        let limite = now - 400 * 86_400_000;
        disparados.retain(|_, t| *t > limite);
        if let Ok(json) = serde_json::to_string(&*disparados) {
            let _ = escribir_atomico(&estado.dir.join(ARCHIVO_DISPARADOS), &json);
        }
    }

    // Muchos a la vez (p. ej. el primer día del mes): una sola notificación agrupada.
    if nuevos.len() > 3 {
        let mensuales = nuevos.iter().filter(|a| a.kind == "mensual").count();
        let lista: Vec<String> = nuevos.iter().take(4).map(|a| a.title.clone()).collect();
        notificar(
            app,
            &format!("📋 {} avisos de bitácoras ({} por registrar)", nuevos.len(), mensuales),
            &lista.join("\n"),
        );
    } else {
        for a in &nuevos {
            notificar(app, &a.title, &a.body);
        }
    }
    // Tarjetas dentro de la app (si la ventana está abierta)
    let _ = app.emit("avisos", &nuevos);
}

// ---------------- Comandos que llama el frontend ----------------

#[tauri::command]
fn cargar_datos(estado: State<'_, Estado>) -> Result<Option<String>, String> {
    let ruta = estado.dir.join(ARCHIVO_DATOS);
    let bak = estado.dir.join(ARCHIVO_BAK);
    match fs::read_to_string(&ruta) {
        Ok(s) if serde_json::from_str::<serde_json::Value>(&s).is_ok() => Ok(Some(s)),
        _ => match fs::read_to_string(&bak) {
            Ok(s) => Ok(Some(s)),
            Err(_) => Ok(None),
        },
    }
}

#[tauri::command]
fn guardar_datos(json: String, estado: State<'_, Estado>) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&json).map_err(|e| format!("Datos inválidos: {e}"))?;
    let ruta = estado.dir.join(ARCHIVO_DATOS);
    if ruta.exists() {
        let _ = fs::copy(&ruta, estado.dir.join(ARCHIVO_BAK));
    }
    escribir_atomico(&ruta, &json).map_err(|e| e.to_string())
}

#[tauri::command]
fn programar_avisos(avisos: Vec<Aviso>, app: AppHandle, estado: State<'_, Estado>) -> Result<(), String> {
    let json = serde_json::to_string(&avisos).map_err(|e| e.to_string())?;
    {
        let mut guard = estado.avisos.lock().map_err(|e| e.to_string())?;
        *guard = avisos;
    }
    escribir_atomico(&estado.dir.join(ARCHIVO_AVISOS), &json).map_err(|e| e.to_string())?;
    revisar(&app);
    Ok(())
}

#[tauri::command]
fn escribir_archivo(ruta: String, contenido: String) -> Result<(), String> {
    fs::write(&ruta, contenido).map_err(|e| e.to_string())
}

#[tauri::command]
fn carpeta_datos(estado: State<'_, Estado>) -> String {
    estado.dir.to_string_lossy().to_string()
}

#[tauri::command]
fn aviso_prueba(app: AppHandle) -> Result<(), String> {
    notificar(&app, "🔔 Bitácora Tracker", "Así se verán tus recordatorios de bitácoras.");
    let t = ahora();
    let a = Aviso {
        key: format!("prueba:{t}"),
        at: t,
        until: t + 60_000,
        title: "🔔 Notificación de prueba".into(),
        body: "Así se verán tus recordatorios. También llegan como notificación del sistema.".into(),
        kind: "prueba".into(),
        referencia: String::new(),
    };
    app.emit("avisos", vec![a]).map_err(|e| e.to_string())
}

// ---------------- Arranque ----------------

#[cfg(target_os = "macos")]
fn al_ejecutar(app: &AppHandle, event: tauri::RunEvent) {
    // Clic en el icono del Dock con la ventana oculta
    if let tauri::RunEvent::Reopen { .. } = event {
        mostrar(app);
    }
}

#[cfg(not(target_os = "macos"))]
fn al_ejecutar(_app: &AppHandle, _event: tauri::RunEvent) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Debe ir primero: si ya está abierta, solo muestra la ventana existente
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| mostrar(app)))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            fs::create_dir_all(&dir)?;
            let avisos: Vec<Aviso> = leer_json(&dir.join(ARCHIVO_AVISOS));
            let disparados: HashMap<String, i64> = leer_json(&dir.join(ARCHIVO_DISPARADOS));
            app.manage(Estado {
                dir,
                avisos: Mutex::new(avisos),
                disparados: Mutex::new(disparados),
            });

            // Bandeja del sistema
            let abrir = MenuItem::with_id(app, "abrir", "Abrir Bitácora Tracker", true, None::<&str>)?;
            let salir = MenuItem::with_id(app, "salir", "Salir", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&abrir, &salir])?;
            let mut bandeja = TrayIconBuilder::new()
                .tooltip("Bitácora Tracker")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "abrir" => mostrar(app),
                    "salir" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        mostrar(tray.app_handle());
                    }
                });
            if let Some(icono) = app.default_window_icon() {
                bandeja = bandeja.icon(icono.clone());
            }
            bandeja.build(app)?;

            // Al iniciar con el sistema arranca oculta en la bandeja
            if !std::env::args().any(|a| a == "--minimized") {
                mostrar(app.handle());
            }

            // Revisión periódica de avisos (sigue corriendo con la ventana oculta)
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(12));
                loop {
                    revisar(&handle);
                    std::thread::sleep(Duration::from_secs(30));
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Cerrar = ocultar en la bandeja (los avisos siguen llegando)
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            cargar_datos,
            guardar_datos,
            programar_avisos,
            escribir_archivo,
            carpeta_datos,
            aviso_prueba
        ])
        .build(tauri::generate_context!())
        .expect("error al iniciar Bitácora Tracker")
        .run(al_ejecutar);
}
