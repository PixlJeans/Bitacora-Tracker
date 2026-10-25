// ===== Puente con el sistema =====
// En la app de escritorio (Tauri) los datos van a un archivo local en la carpeta de datos de la app,
// y los avisos los dispara el proceso nativo (Rust) como notificaciones de Windows / macOS, aunque la
// ventana esté cerrada en la bandeja. En un navegador normal (desarrollo) todo cae a localStorage y
// a la API Notification, para poder probar la interfaz sin compilar.

import type { Aviso } from './types';

export const esTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface Backend {
  cargar(): Promise<string | null>;
  guardar(json: string): Promise<void>;
  programar(avisos: Aviso[]): Promise<void>;
  onAviso(cb: (a: Aviso[]) => void): void;
  guardarArchivo(nombre: string, contenido: string, ext: string, desc: string): Promise<string | null>;
  probarAviso(): Promise<boolean>;
  pedirPermiso(): Promise<boolean>;
  autoInicio(on: boolean): Promise<void>;
  autoInicioActivo(): Promise<boolean>;
  carpetaDatos(): Promise<string>;
  respaldo(nombre: string, contenido: string): Promise<string | null>;
  abrirCarpeta(): Promise<void>;
  /** Abre el selector de carpetas del sistema; null si se cancela o no hay escritorio. */
  elegirCarpeta(): Promise<string | null>;
  /** modo 'probar' → 'existe' | 'vacia'; 'llevar' copia los datos actuales; 'usar' adopta los de la carpeta. */
  cambiarCarpeta(ruta: string, modo: 'probar' | 'llevar' | 'usar'): Promise<string>;
}

// ---------------- Escritorio (Tauri) ----------------
const tauri: Backend = {
  async cargar() {
    const { invoke } = await import('@tauri-apps/api/core');
    return (await invoke<string | null>('cargar_datos')) ?? null;
  },
  async guardar(json) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('guardar_datos', { json });
  },
  async programar(avisos) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('programar_avisos', { avisos });
  },
  onAviso(cb) {
    import('@tauri-apps/api/event').then(({ listen }) => listen<Aviso[]>('avisos', e => cb(e.payload)));
  },
  async guardarArchivo(nombre, contenido, ext, desc) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { invoke } = await import('@tauri-apps/api/core');
    const ruta = await save({ defaultPath: nombre, filters: [{ name: desc, extensions: [ext] }] });
    if (!ruta) return null;
    await invoke('escribir_archivo', { ruta, contenido });
    return ruta;
  },
  async probarAviso() {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('aviso_prueba');
    return true;
  },
  async pedirPermiso() {
    try {
      const n = await import('@tauri-apps/plugin-notification');
      if (await n.isPermissionGranted()) return true;
      return (await n.requestPermission()) === 'granted';
    } catch { return true; }
  },
  async autoInicio(on) {
    const a = await import('@tauri-apps/plugin-autostart');
    if (on) await a.enable(); else await a.disable();
  },
  async autoInicioActivo() {
    try { return await (await import('@tauri-apps/plugin-autostart')).isEnabled(); } catch { return false; }
  },
  async carpetaDatos() {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string>('carpeta_datos');
  },
  async respaldo(nombre, contenido) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string>('respaldo', { nombre, contenido });
  },
  async abrirCarpeta() {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('abrir_carpeta');
  },
  async elegirCarpeta() {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const r = await open({ directory: true, multiple: false, title: 'Elige la carpeta para tus datos' });
    return typeof r === 'string' ? r : null;
  },
  async cambiarCarpeta(ruta, modo) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string>('cambiar_carpeta', { ruta, modo });
  }
};

// ---------------- Navegador (desarrollo / vista previa) ----------------
const LS_DATOS = 'bitacora_tracker_v1', LS_FIRED = 'bitacora_tracker_fired';
let webAvisos: Aviso[] = [];
let webCb: ((a: Aviso[]) => void) | null = null;

function webTick() {
  let fired: Record<string, number> = {};
  try { fired = JSON.parse(localStorage.getItem(LS_FIRED) || '{}'); } catch { /* vacío */ }
  const now = Date.now();
  const nuevos = webAvisos.filter(a => a.at <= now && now < a.until && !fired[a.key]);
  if (!nuevos.length) return;
  nuevos.forEach(a => { fired[a.key] = now; });
  try { localStorage.setItem(LS_FIRED, JSON.stringify(fired)); } catch { /* vacío */ }
  if ('Notification' in window && Notification.permission === 'granted') {
    if (nuevos.length > 3) new Notification(`📋 ${nuevos.length} avisos de bitácoras`, { body: nuevos.slice(0, 3).map(a => a.title).join('\n') });
    else nuevos.forEach(a => new Notification(a.title, { body: a.body, tag: a.key }));
  }
  webCb?.(nuevos);
}

const web: Backend = {
  async cargar() { try { return localStorage.getItem(LS_DATOS); } catch { return null; } },
  async guardar(json) { try { localStorage.setItem(LS_DATOS, json); } catch { /* vacío */ } },
  async programar(avisos) { webAvisos = avisos; setTimeout(webTick, 1500); },
  onAviso(cb) { webCb = cb; setInterval(webTick, 30000); },
  async guardarArchivo(nombre, contenido) {
    const blob = new Blob([contenido], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return nombre;
  },
  async probarAviso() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return false;
    new Notification('🔔 Bitácora Tracker', { body: 'Así se verán tus recordatorios.' });
    return true;
  },
  async pedirPermiso() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    return (await Notification.requestPermission()) === 'granted';
  },
  async autoInicio() { /* solo escritorio */ },
  async autoInicioActivo() { return false; },
  async carpetaDatos() { return 'Almacenamiento del navegador (modo desarrollo)'; },
  async respaldo(nombre, contenido) { try { localStorage.setItem('bt_respaldo_' + nombre, contenido); } catch { /* lleno */ } return nombre; },
  async abrirCarpeta() { /* solo escritorio */ },
  async elegirCarpeta() { return null; },
  async cambiarCarpeta() { return ''; }
};

export const backend: Backend = esTauri ? tauri : web;
