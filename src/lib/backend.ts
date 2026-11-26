// ===== Bridge to the system =====
// In the desktop app (Tauri) the data goes to a local file in the app's data folder,
// and reminders are fired by the native process (Rust) as Windows / macOS notifications, even when the
// window is closed to the tray. In a normal browser (development) everything falls back to localStorage and
// the Notification API, so the UI can be tried without compiling.

import type { Reminder } from './types';

export const esTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
/** Published web version: data on the server (api.php) with user accounts. */
export const esWeb = !esTauri && (import.meta as any).env?.VITE_MODE === 'web';

export interface Backend {
  load(): Promise<string | null>;
  save(json: string): Promise<void>;
  schedule(reminders: Reminder[]): Promise<void>;
  onReminder(cb: (a: Reminder[]) => void): void;
  saveFile(name: string, content: string, ext: string, description: string): Promise<string | null>;
  testReminder(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
  autoStart(on: boolean): Promise<void>;
  autoStartEnabled(): Promise<boolean>;
  dataFolder(): Promise<string>;
  backup(name: string, content: string): Promise<string | null>;
  openFolder(): Promise<void>;
  /** Opens the system folder picker; null if cancelled or not on desktop. */
  pickFolder(): Promise<string | null>;
  /** mode 'probe' → 'exists' | 'empty'; 'move' copies the current data there; 'use' adopts the data already in the folder. */
  changeFolder(path: string, mode: 'probe' | 'move' | 'use'): Promise<string>;
  // --- project photos and files ---
  saveAttachment(code: string, name: string, dataB64: string, thumbB64?: string): Promise<{ path: string; thumb: string | null }>;
  readB64(path: string): Promise<string>;
  openAttachment(path: string): Promise<void>;
  deleteAttachment(path: string): Promise<void>;
  openProjectFolder(code: string): Promise<void>;
  openSetena(url: string): Promise<void>;
  /** Opens Google Maps (only https://www.google.com/maps/…). */
  openMap(url: string): Promise<void>;
  // --- phone via QR ---
  phoneStart(): Promise<{ url: string; svg: string }>;
  phoneProjects(json: string): Promise<void>;
  onPhone(cb: (r: PhoneUpload) => void): void;
}

export interface PhoneUpload {
  batch: string; code: string; date: string; note: string; name: string;
  path: string; thumb: string | null; index: number; total: number;
  takenOn?: string | null; lat?: number | null; lng?: number | null;
}

// ---------------- Escritorio (Tauri) ----------------
const tauri: Backend = {
  async load() {
    const { invoke } = await import('@tauri-apps/api/core');
    return (await invoke<string | null>('load_data')) ?? null;
  },
  async save(json) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('save_data', { json });
  },
  async schedule(reminders) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('schedule_reminders', { reminders });
  },
  onReminder(cb) {
    import('@tauri-apps/api/event').then(({ listen }) => listen<Reminder[]>('reminders', e => cb(e.payload)));
  },
  async saveFile(name, content, ext, description) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { invoke } = await import('@tauri-apps/api/core');
    const path = await save({ defaultPath: name, filters: [{ name: description, extensions: [ext] }] });
    if (!path) return null;
    await invoke('write_file', { path, content });
    return path;
  },
  async testReminder() {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('test_reminder');
    return true;
  },
  async requestPermission() {
    try {
      const n = await import('@tauri-apps/plugin-notification');
      if (await n.isPermissionGranted()) return true;
      return (await n.requestPermission()) === 'granted';
    } catch { return true; }
  },
  async autoStart(on) {
    const a = await import('@tauri-apps/plugin-autostart');
    if (on) await a.enable(); else await a.disable();
  },
  async autoStartEnabled() {
    try { return await (await import('@tauri-apps/plugin-autostart')).isEnabled(); } catch { return false; }
  },
  async dataFolder() {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string>('data_folder');
  },
  async backup(name, content) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string>('backup', { name, content });
  },
  async openFolder() {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_data_folder');
  },
  async pickFolder() {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const r = await open({ directory: true, multiple: false, title: 'Elige la carpeta para tus datos' });
    return typeof r === 'string' ? r : null;
  },
  async changeFolder(path, mode) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string>('change_folder', { path, mode });
  },
  async saveAttachment(code, name, data, thumb) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<{ path: string; thumb: string | null }>('save_attachment', { code, name, data, thumb: thumb ?? null });
  },
  async readB64(path) { const { invoke } = await import('@tauri-apps/api/core'); return invoke<string>('read_file_b64', { path }); },
  async openAttachment(path) { const { invoke } = await import('@tauri-apps/api/core'); await invoke('open_attachment', { path }); },
  async deleteAttachment(path) { const { invoke } = await import('@tauri-apps/api/core'); await invoke('delete_attachment', { path }); },
  async openProjectFolder(code) { const { invoke } = await import('@tauri-apps/api/core'); await invoke('open_project_folder', { code }); },
  async openSetena(url) { const { invoke } = await import('@tauri-apps/api/core'); await invoke('open_setena', { url }); },
  async openMap(url) { const { invoke } = await import('@tauri-apps/api/core'); await invoke('open_map', { url }); },
  async phoneStart() { const { invoke } = await import('@tauri-apps/api/core'); return invoke<{ url: string; svg: string }>('phone_start'); },
  async phoneProjects(json) { const { invoke } = await import('@tauri-apps/api/core'); await invoke('phone_projects', { json }); },
  onPhone(cb) { import('@tauri-apps/api/event').then(({ listen }) => listen<PhoneUpload>('phone-upload', e => cb(e.payload))); }
};

// ---------------- Navegador (desarrollo / vista previa) ----------------
const memory = new Map<string, string>();
const LS_DATA = 'bitacora_tracker_v1', LS_FIRED = 'bitacora_tracker_fired';
let webReminders: Reminder[] = [];
let webCb: ((a: Reminder[]) => void) | null = null;

function webTick() {
  let fired: Record<string, number> = {};
  try { fired = JSON.parse(localStorage.getItem(LS_FIRED) || '{}'); } catch { /* vacío */ }
  const now = Date.now();
  const newOnes = webReminders.filter(a => a.at <= now && now < a.until && !fired[a.key]);
  if (!newOnes.length) return;
  newOnes.forEach(a => { fired[a.key] = now; });
  try { localStorage.setItem(LS_FIRED, JSON.stringify(fired)); } catch { /* vacío */ }
  if ('Notification' in window && Notification.permission === 'granted') {
    if (newOnes.length > 3) new Notification(`📋 ${newOnes.length} avisos de bitácoras`, { body: newOnes.slice(0, 3).map(a => a.title).join('\n') });
    else newOnes.forEach(a => new Notification(a.title, { body: a.body, tag: a.key }));
  }
  webCb?.(newOnes);
}

const web: Backend = {
  async load() { try { return localStorage.getItem(LS_DATA); } catch { return null; } },
  async save(json) { try { localStorage.setItem(LS_DATA, json); } catch { /* vacío */ } },
  async schedule(reminders) { webReminders = reminders; setTimeout(webTick, 1500); },
  onReminder(cb) { webCb = cb; setInterval(webTick, 30000); },
  async saveFile(name, content) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return name;
  },
  async testReminder() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return false;
    new Notification('🔔 Bitácora Tracker', { body: 'Así se verán tus recordatorios.' });
    return true;
  },
  async requestPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    return (await Notification.requestPermission()) === 'granted';
  },
  async autoStart() { /* solo escritorio */ },
  async autoStartEnabled() { return false; },
  async dataFolder() { return 'Almacenamiento del navegador (modo desarrollo)'; },
  async backup(name, content) { try { localStorage.setItem('bt_respaldo_' + name, content); } catch { /* lleno */ } return name; },
  async openFolder() { /* solo escritorio */ },
  async pickFolder() { return null; },
  async changeFolder() { return ''; },
  // In the browser (testing) files only live in memory
  async saveAttachment(code, name, data, thumb) {
    const path = `proyectos/${code}/${Date.now().toString(36)}_${name}`;
    memory.set(path, data); if (thumb) memory.set(path + '.mini.jpg', thumb);
    return { path: path, thumb: thumb ? path + '.mini.jpg' : null };
  },
  async readB64(path) { const v = memory.get(path); if (!v) throw new Error('no está'); return v; },
  async openAttachment(path) { const v = memory.get(path); if (v) window.open('data:application/octet-stream;base64,' + v); },
  async deleteAttachment(path) { memory.delete(path); },
  async openProjectFolder() { /* solo escritorio */ },
  async openSetena(url) { window.open(url, '_blank'); },
  async openMap(url) { window.open(url, '_blank', 'noopener'); },
  async phoneStart() { throw new Error('Las fotos desde el celular funcionan en la app de escritorio instalada.'); },
  async phoneProjects() { /* solo escritorio */ },
  onPhone() { /* solo escritorio */ }
};

// ---------------- Web publicada (servidor PHP) ----------------
export interface WebUser { user: string; name: string; admin: boolean }
const API = 'api.php';
let serverVersion = 0;
let saving = false;

export async function api<T = any>(a: string, data: Record<string, unknown> = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(API, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ a, ...data }) });
  } catch { throw new Error('Sin conexión con el servidor. Revisa tu internet.'); }
  let j: any = null;
  try { j = await r.json(); } catch { /* respuesta no JSON */ }
  if (r.status === 401 && a !== 'login') window.dispatchEvent(new CustomEvent('bt:session'));
  if (!r.ok || !j?.ok) {
    const e: any = new Error(j?.error || (r.status === 413 ? 'El archivo es demasiado grande para el servidor.' : `Error del servidor (${r.status})`));
    e.status = r.status; e.response = j; throw e;
  }
  return j as T;
}
const fileUrlOf = (path: string, download = false) => `${API}?a=file&path=${encodeURIComponent(path)}${download ? '&download=1' : ''}`;
const blobB64 = (b: Blob) => new Promise<string>((res, rej) => { const f = new FileReader(); f.onload = () => res(String(f.result).split(',')[1] ?? ''); f.onerror = rej; f.readAsDataURL(b); });

/** Watches whether someone else (or another device) saved changes: fires the «bt:remote» event. */
function watchChanges() {
  const check = async () => {
    if (saving || document.hidden) return;
    try { const { version } = await api<{ version: number }>('version'); if (version !== serverVersion) window.dispatchEvent(new CustomEvent('bt:remote')); } catch { /* sin red */ }
  };
  setInterval(check, 45000);
  window.addEventListener('focus', check);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
}
let watching = false;

const server: Backend = {
  ...web,
  async load() {
    const r = await api<{ json: string | null; version: number }>('load');
    serverVersion = r.version;
    if (!watching) { watching = true; watchChanges(); }
    return r.json;
  },
  async save(json) {
    saving = true;
    try {
      const r = await api<{ version: number }>('save', { json, version: serverVersion });
      serverVersion = r.version;
    } catch (e: any) {
      if (e.status === 409) window.dispatchEvent(new CustomEvent('bt:conflict'));
      throw e;
    } finally { saving = false; }
  },
  async dataFolder() { return `${location.host}${location.pathname.replace(/[^/]*$/, '')} (servidor)`; },
  async backup(name, content) { await api('backup', { name, content }); return name; },
  async saveAttachment(code, name, data, thumb) {
    const r = await api<{ path: string; thumb: string | null }>('upload', { code, name, data, thumb: thumb ?? null });
    return { path: r.path, thumb: r.thumb };
  },
  async readB64(path) {
    const r = await fetch(fileUrlOf(path), { credentials: 'same-origin' });
    if (!r.ok) throw new Error('no está');
    return blobB64(await r.blob());
  },
  async openAttachment(path) { window.open(fileUrlOf(path), '_blank', 'noopener'); },
  async deleteAttachment(path) { await api('delete', { path }); },
  async openProjectFolder() { /* en la web los archivos se ven en cada anotación */ },
  async phoneStart() { return { url: location.href.split('#')[0].split('?')[0], svg: '' }; },
  async phoneProjects() { /* no hace falta: el celular entra a la misma página */ },
  onPhone() { /* no hace falta */ }
};
export const fileUrl = fileUrlOf;

export const backend: Backend = esTauri ? tauri : esWeb ? server : web;
