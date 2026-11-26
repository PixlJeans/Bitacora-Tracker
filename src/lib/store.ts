// ===== Store (port of Cognose tools/04-store.js + Undo from 01-config.js) =====
// A single data layer: every change goes through `mutate()`, which keeps a copy for Undo,
// persists to disk (with a short delay) and reschedules the native reminders.

import { useSyncExternalStore } from 'react';
import type { AppData, Attachment, Delivery, EntryType, ImportRow, LogEntry, Project, ProjectLocation, ReminderKind, SetenaInfo, Settings, Status, Step } from './types';
import { DEFAULT_LABELS, emptyDelivery } from './types';
import { backend, esWeb } from './backend';
import { computeReminders, deliveryKeyForDate, monthForVisit, pendingBefore } from './schedule';
import { todayISO, uid } from './dates';
import { deliveryFolder, folderOf } from './folders';

export const DEFAULT_SETTINGS: Settings = {
  reminderTime: '08:00',
  notifications: true,
  autoStart: true,
  theme: 'dark',
  accent: '#4ade80',
  textSize: 100,
  csvSeparator: ';',
  tutorialSeen: false,
  radiusKm: 15,
  home: null,
  roundTrip: true
};

// ---------- Loading saved data ----------
// The data file may come from any version: up to v1.5 it was saved with Spanish keys and values
// (bitacoras, numero, estado: 'abierta'…); from v1.6 (format 4) with English ones. `normalize()` reads
// both, fixes missing or odd fields, and always returns the current format. It is saved back in the
// new format on the next change.

const num = (v: any) => (typeof v === 'number' && isFinite(v) ? v : null);
const isoDate = (v: any) => /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v as string : null;
/** First defined value among the new key and its legacy (Spanish) key. */
const pick = (o: any, key: string, legacy?: string) => (o?.[key] !== undefined ? o[key] : legacy ? o?.[legacy] : undefined);
/** Maps a legacy value to the current one; unknown values fall back to `fallback`. */
const value = <T extends string>(v: any, allowed: readonly T[], legacy: Record<string, T>, fallback: T): T =>
  allowed.includes(v) ? v : legacy[v] ?? fallback;

const LEGACY_STATUS: Record<string, Status> = { nueva: 'new', abierta: 'open', cierre: 'closing', terminada: 'finished' };
const LEGACY_ENTRY_TYPE: Record<string, EntryType> = { visita: 'visit', informe: 'regencia', observacion: 'observation', otro: 'other' };
const LEGACY_FILE_TYPE: Record<string, Attachment['type']> = { foto: 'photo', otro: 'other' };
const LEGACY_LABEL_ID: Record<string, string> = { pendiente: 'pending', urgente: 'pending', proceso: 'inProgress', listo: 'done' };
const LEGACY_KIND: Record<string, ReminderKind> = { mensual: 'monthly', informe: 'regencia', semestral: 'semiannual', grupo: 'group', prueba: 'test' };
const LEGACY_RESULT: Record<string, ImportRow['result']> = { pendiente: 'pending', importada: 'imported', omitida: 'skipped' };

function normLocation(u: any): ProjectLocation | null {
  if (!u || typeof u !== 'object') return null;
  const lat = num(u.lat), lng = num(u.lng);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const source = pick(u, 'source', 'fuente');
  return { lat, lng, text: String(pick(u, 'text', 'texto') || ''), source: source === 'photo' || source === 'foto' ? 'photo' : 'manual' };
}

function normDeliveries(raw: any): Record<string, Delivery> {
  const out: Record<string, Delivery> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, e] of Object.entries<any>(raw)) {
    if (!/^(m:\d{4}-\d{2}|r:\d{4}-\d{2}-\d{2}|s:start)$/.test(k) || !e || typeof e !== 'object') continue;
    out[k] = {
      planned: isoDate(e.planned), due: isoDate(pick(e, 'due', 'vence')), visit: isoDate(pick(e, 'visit', 'visita')), photos: isoDate(pick(e, 'photos', 'fotos')),
      letter: isoDate(pick(e, 'letter', 'carta')), uploaded: isoDate(pick(e, 'uploaded', 'subida')), received: isoDate(e.received),
      letterText: String(pick(e, 'letterText', 'textoCarta') || ''),
      ...(e.notes ? { notes: String(e.notes) } : {}),
      files: Array.isArray(e.files) ? e.files.filter((f: any) => f && pick(f, 'path', 'ruta')).map(normAttachment) : []
    };
  }
  return out;
}

function normAttachment(f: any): Attachment {
  return {
    id: String(f.id || uid()), name: String(pick(f, 'name', 'nombre') || 'archivo'), path: String(pick(f, 'path', 'ruta')),
    thumb: pick(f, 'thumb', 'mini') ? String(pick(f, 'thumb', 'mini')) : null,
    type: value(pick(f, 'type', 'tipo'), ['photo', 'pdf', 'other'] as const, LEGACY_FILE_TYPE, 'other'),
    takenOn: isoDate(pick(f, 'takenOn', 'tomada')), lat: num(f.lat), lng: num(f.lng),
    ...(f.role === 'receipt' ? { role: 'receipt' as const } : {})
  };
}

function normEntry(a: any): LogEntry {
  const source = pick(a, 'source', 'origen');
  return {
    id: String(a.id), date: isoDate(pick(a, 'date', 'fecha'))!,
    type: value(pick(a, 'type', 'tipo'), ['visit', 'regencia', 'observation', 'other'] as const, LEGACY_ENTRY_TYPE, 'other'),
    text: String(pick(a, 'text', 'texto') || ''), regencia: isoDate(pick(a, 'regencia', 'informe')),
    uploaded: !!pick(a, 'uploaded', 'subida'), uploadedOn: isoDate(pick(a, 'uploadedOn', 'subidaEl')),
    source: source === 'phone' || source === 'celular' ? 'phone' : 'pc', batch: pick(a, 'batch', 'lote'),
    createdOn: isoDate(pick(a, 'createdOn', 'creada')) || todayISO(),
    attachments: (Array.isArray(pick(a, 'attachments', 'archivos')) ? pick(a, 'attachments', 'archivos') : [])
      .filter((f: any) => f && pick(f, 'path', 'ruta')).map(normAttachment)
  };
}

export const emptyData = (): AppData => ({
  version: 4, importSession: null, projects: [], labels: DEFAULT_LABELS.map(e => ({ ...e })),
  reviews: [], snoozed: [],
  settings: { ...DEFAULT_SETTINGS }
});

let data: AppData = emptyData();
let ready = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());

export const getData = () => data;
export const isReady = () => ready;
export function useAppData(): AppData {
  return useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb); }; }, () => data);
}

/** Cleans up whatever was read from disk (older versions, missing fields, odd values). */
const strList = (v: any): string[] => Array.isArray(v) ? v.filter((x: any) => typeof x === 'string').slice(0, 20) : [];
function normSetena(s: any): SetenaInfo {
  return {
    avance: typeof s.avance === 'number' && s.avance >= 0 && s.avance <= 100 ? s.avance : null,
    lastEntry: isoDate(s.lastEntry), entries: typeof s.entries === 'number' ? s.entries : 0,
    people: strList(s.people), others: strList(s.others), participationClosed: !!s.participationClosed,
    approvedOn: isoDate(s.approvedOn), readAt: typeof s.readAt === 'string' ? s.readAt : ''
  };
}

export function normalize(raw: any): AppData {
  const d = emptyData();
  if (!raw || typeof raw !== 'object') return d;

  // Settings (v1.5 and earlier: «ajustes» with Spanish keys)
  const s = pick(raw, 'settings', 'ajustes') || {};
  const theme = pick(s, 'theme', 'tema');
  d.settings = {
    reminderTime: /^\d{2}:\d{2}$/.test(pick(s, 'reminderTime', 'horaAviso') || '') ? pick(s, 'reminderTime', 'horaAviso') : DEFAULT_SETTINGS.reminderTime,
    notifications: pick(s, 'notifications', 'notificaciones') ?? DEFAULT_SETTINGS.notifications,
    autoStart: pick(s, 'autoStart', 'autoInicio') ?? DEFAULT_SETTINGS.autoStart,
    theme: theme === 'light' || theme === 'dark' ? theme : theme === 'system' || theme === 'sistema' ? 'system' : DEFAULT_SETTINGS.theme,
    accent: pick(s, 'accent', 'acento') || DEFAULT_SETTINGS.accent,
    textSize: Number(pick(s, 'textSize', 'tamano')) || DEFAULT_SETTINGS.textSize,
    csvSeparator: pick(s, 'csvSeparator', 'separadorCsv') === ',' ? ',' : ';',
    tutorialSeen: !!pick(s, 'tutorialSeen', 'tutorialVisto'),
    radiusKm: Number(pick(s, 'radiusKm', 'radioKm')) > 0 ? Number(pick(s, 'radiusKm', 'radioKm')) : DEFAULT_SETTINGS.radiusKm,
    home: s.home && Number.isFinite(Number(s.home.lat)) && Number.isFinite(Number(s.home.lng)) ? { lat: Number(s.home.lat), lng: Number(s.home.lng), text: String(s.home.text || '') } : null,
    roundTrip: s.roundTrip ?? true
  };

  // Progress labels (v1 called them priorities: Urgente / Pendiente próximo / Al día)
  const rawLabels = pick(raw, 'labels', 'etiquetas');
  if (Array.isArray(rawLabels) && rawLabels.length) {
    const oldNames: Record<string, string> = { 'Urgente': 'Pendiente', 'Pendiente próximo': 'En proceso', 'Al día': 'Listo' };
    d.labels = rawLabels.filter((e: any) => e && e.id).map((e: any) => {
      const name = String(pick(e, 'name', 'nombre') || e.id);
      return { id: LEGACY_LABEL_ID[e.id] ?? String(e.id), name: oldNames[name] ?? name, color: String(e.color || '#888888') };
    });
  }
  const labelId = (id: any) => { const v = LEGACY_LABEL_ID[id] ?? id; return d.labels.some(e => e.id === v) ? v : d.labels[d.labels.length - 1].id; };

  // Saved reviews
  const reviews = pick(raw, 'reviews', 'revisiones');
  d.reviews = Array.isArray(reviews) ? reviews.filter((r: any) => r && r.id).map((r: any) => {
    const sum = pick(r, 'summary', 'resumen') || {};
    return {
      id: String(r.id), period: String(pick(r, 'period', 'periodo') || ''), date: String(pick(r, 'date', 'fecha') || ''),
      reviewed: Array.isArray(pick(r, 'reviewed', 'revisados')) ? pick(r, 'reviewed', 'revisados') : [], notes: String(pick(r, 'notes', 'notas') || ''),
      summary: { open: Number(pick(sum, 'open', 'abiertas')) || 0, new: Number(pick(sum, 'new', 'nuevas')) || 0, closing: Number(pick(sum, 'closing', 'cierre')) || 0, notUploaded: Number(pick(sum, 'notUploaded', 'sinRegistro')) || 0 }
    };
  }) : [];

  // Import paused halfway (can be resumed another day)
  const session = pick(raw, 'importSession', 'importacion');
  const rows: ImportRow[] = Array.isArray(pick(session, 'rows', 'filas')) ? pick(session, 'rows', 'filas').filter((f: any) => f).map((f: any): ImportRow => ({
    code: String(pick(f, 'code', 'numero') || ''), name: String(pick(f, 'name', 'nombre') || ''),
    status: value(pick(f, 'status', 'estado'), ['open', 'new', 'closing', 'finished'] as const, LEGACY_STATUS, 'open'),
    openedOn: String(pick(f, 'openedOn', 'apertura') || ''), labelId: labelId(pick(f, 'labelId', 'etiquetaId')),
    doubts: Array.isArray(pick(f, 'doubts', 'dudas')) ? pick(f, 'doubts', 'dudas') : [],
    existingId: pick(f, 'existingId', 'existenteId') ?? null,
    result: value(pick(f, 'result', 'resultado'), ['pending', 'imported', 'skipped'] as const, LEGACY_RESULT, 'pending')
  })) : [];
  d.importSession = session && rows.some(f => f.result === 'pending')
    ? { file: String(pick(session, 'file', 'archivo') || ''), startedOn: String(pick(session, 'startedOn', 'inicio') || todayISO()), i: Math.max(0, Number(session.i) || 0), rows }
    : null;

  // Snoozed reminders (only those still pending)
  const snoozed = pick(raw, 'snoozed', 'pospuestos');
  d.snoozed = Array.isArray(snoozed) ? snoozed.filter((p: any) => p && p.at > Date.now() - 864e5)
    .map((p: any) => ({ ...p, kind: value(p.kind, ['monthly', 'regencia', 'semiannual', 'group', 'test', 'visit'] as const, LEGACY_KIND, 'monthly') })) : [];

  // Projects
  const months = (v: any) => Array.isArray(v) ? [...new Set<string>(v.filter((r: any) => /^\d{4}-\d{2}$/.test(r)))] : [];
  const seen = new Set<string>();
  const projects = pick(raw, 'projects', 'bitacoras');
  d.projects = (Array.isArray(projects) ? projects : [])
    .filter((b: any) => b && String(pick(b, 'code', 'numero') || '').trim())
    .map((b: any): Project => {
      let id = String(b.id || uid());
      if (seen.has(id)) id = uid();          // duplicated ids used to hide projects in the list
      seen.add(id);
      const regencias = pick(b, 'regencias', 'informes');
      const entries = pick(b, 'entries', 'anotaciones');
      const x: Project = {
        id,
        code: String(pick(b, 'code', 'numero')).toUpperCase().trim(),
        name: String(pick(b, 'name', 'nombre') || '').trim() || 'PROYECTO SIN NOMBRE',
        status: value(pick(b, 'status', 'estado'), ['open', 'new', 'closing', 'finished'] as const, LEGACY_STATUS, 'open'),
        labelId: labelId(pick(b, 'labelId', 'etiquetaId')),
        openedOn: isoDate(pick(b, 'openedOn', 'apertura')) || isoDate(b.fechaInicio) || todayISO(),   // v1 saved «fechaInicio»
        notes: String(pick(b, 'notes', 'notas') || ''),
        uploads: months(pick(b, 'uploads', 'registros')),
        visits: months(pick(b, 'visits', 'inspecciones')),
        regencias: Array.isArray(regencias) ? [...new Set<string>(regencias.filter(isoDate))] : [],
        archived: !!pick(b, 'archived', 'archivada'),
        archivedOn: isoDate(pick(b, 'archivedOn', 'archivadaEl')),
        entries: Array.isArray(entries) ? entries.filter((a: any) => a && a.id && isoDate(pick(a, 'date', 'fecha'))).map(normEntry) : [],
        location: normLocation(pick(b, 'location', 'ubicacion')),
        deliveries: normDeliveries(pick(b, 'deliveries', 'entregas')),
        lastUpdated: pick(b, 'lastUpdated', 'ultimaActualizacion') || null,
        createdOn: isoDate(pick(b, 'createdOn', 'creada')) || todayISO(),
        noOpeningDate: !!b.noOpeningDate,
        ...(isoDate(b.setenaStart) ? { setenaStart: isoDate(b.setenaStart)! } : {}),
        ...(typeof b.setenaUrl === 'string' && b.setenaUrl.startsWith('https://bitacora.setena.go.cr/') ? { setenaUrl: b.setenaUrl } : {}),
        ...(b.setena && typeof b.setena === 'object' ? { setena: normSetena(b.setena) } : {})
      };
      // Older data: projects imported without a date got the import day as their opening date.
      // If nothing was done on them yet, mark the date as unknown so they don't show made-up deliveries.
      if (b.noOpeningDate === undefined && x.openedOn === x.createdOn && !x.visits.length && !x.uploads.length
        && !x.regencias.length && !Object.keys(x.deliveries ?? {}).length) x.noOpeningDate = true;
      return x;
    });
  return d;
}

// ---------- Persistencia ----------
let tSave: ReturnType<typeof setTimeout> | null = null;
let tSchedule: ReturnType<typeof setTimeout> | null = null;
export let saveError: string | null = null;

function persist() {
  if (tSave) clearTimeout(tSave);
  tSave = setTimeout(() => {
    const json = JSON.stringify(data, null, 1);
    backend.save(json)
      .then(() => { saveError = null; dailyBackup(json); })
      .catch(e => { saveError = String(e); console.error('No se pudo guardar', e); });
  }, 250);
}

// One automatic backup per day in <data folder>/respaldos (the 20 most recent are kept)
function dailyBackup(json: string) {
  const today = todayISO();
  let last = '';
  try { last = localStorage.getItem('bt_ultimo_respaldo') || ''; } catch { /* sin storage */ }
  if (last === today || !data.projects.length) return;
  backend.backup(`auto-${today}.json`, json)
    .then(() => { try { localStorage.setItem('bt_ultimo_respaldo', today); } catch { /* sin storage */ } })
    .catch(() => { /* opcional */ });
}

/** Factory reset: leaves a safety backup and goes back to the initial state (tutorial included). */
export async function factoryReset(): Promise<string | null> {
  let path: string | null = null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  try { path = await backend.backup(`antes-de-restablecer-${stamp}.json`, JSON.stringify(data, null, 1)); } catch { /* opcional */ }
  stack.length = 0;
  data = emptyData();
  try { Object.keys(localStorage).filter(k => k.startsWith('bt_') && !k.startsWith('bt_respaldo_')).forEach(k => localStorage.removeItem(k)); } catch { /* sin storage */ }
  emit(); persist(); reschedule();
  return path;
}

/** Reads the data from disk again (after changing the folder). */
export async function reload() {
  let raw: any = null;
  try { const txt = await backend.load(); raw = txt ? JSON.parse(txt) : null; }
  catch (e) { if (esWeb) throw e; /* desktop: unreadable file → empty */ }
  stack.length = 0;
  data = normalize(raw);
  emit(); reschedule();
}

export function reschedule() {
  if (tSchedule) clearTimeout(tSchedule);
  tSchedule = setTimeout(() => {
    const reminders = data.settings.notifications ? computeReminders(data) : [];
    backend.schedule(reminders).catch(e => console.error('No se pudieron programar los avisos', e));
  }, 300);
}

// Recompute every hour (month change, expired snoozes, summaries up to date)
setInterval(() => { if (ready) reschedule(); }, 3600e3);

export async function start() {
  let raw: any = null;
  try {
    const txt = await backend.load();
    raw = txt ? JSON.parse(txt) : null;
  } catch (e) {
    // On the web, a network failure must NOT show an empty app (it could save over the real data)
    if (esWeb) throw e;
    console.error('Datos ilegibles, se empieza vacío', e);
  }
  data = normalize(raw);
  // Photos and documents still in the general log go into the month they belong to (once, then kept up to date)
  const moved = fileLogIntoDeliveries(data);
  // First run: start with the system so reminders arrive without opening the app
  if (!raw && !esWeb && data.settings.autoStart) backend.autoStart(true).catch(() => { /* opcional */ });
  ready = true;
  emit();
  reschedule();
  if (moved) persist();
  // Files saved before (or arriving from the phone) go into Proyectos/<Código - Nombre>/<Año>/<Mes>/…
  if (!esWeb) void relocateFiles();
}

// ---------- Undo (Ctrl+Z), same as in Cognose ----------
const stack: string[] = [];
export const Undo = {
  push() {
    stack.push(JSON.stringify(data));
    if (stack.length > 50) stack.shift();
  },
  pop(): boolean {
    const s = stack.pop();
    if (!s) return false;
    data = JSON.parse(s);
    emit(); persist(); reschedule();
    return true;
  },
  can: () => stack.length > 0
};

/** The only write path. `undo:false` for changes not worth undoing (visual settings). */
export function mutate(fn: (d: AppData) => void, opts: { undo?: boolean } = {}) {
  if (opts.undo !== false) Undo.push();
  const copy: AppData = structuredClone(data);
  fn(copy);
  data = copy;
  emit();
  persist();
  reschedule();
}

/** Replaces everything (import a backup). */
export function replaceAll(newOne: AppData) {
  Undo.push();
  data = normalize(newOne);
  emit(); persist(); reschedule();
}

// ---------- Project operations ----------
export const codeExists = (code: string, ignoreId?: string) =>
  data.projects.some(b => b.id !== ignoreId && b.code === code.toUpperCase().trim());

export function labelForStatus(e: Status): string {
  const ids = data.labels.map(x => x.id);
  void e;   // everything starts as «Pendiente» (red)
  const preferred = ids.find(id => id === 'pending' || id === 'urgente');
  return preferred ?? ids[0];
}

export type MonthTask = 'upload' | 'visit';

// ---------- Entregas (Informe Regencial mensual / Regencia semestral) ----------
// The «visit» and «uploaded» steps are also kept in the original lists
// (visits / uploads / regencias), which are the ones that switch reminders off.
export const monthKey = (mk: string) => `m:${mk}`;
export const regenciaKey = (due: string) => `r:${due}`;

export function deliveryOf(b: Project, key: string): Delivery {
  return b.deliveries?.[key] ?? emptyDelivery();
}

/** Applies a step (with its date, or null to clear it) on a mutable copy of the project. */
export function applyStep(b: Project, key: string, step: Step, date: string | null) {
  b.deliveries = b.deliveries ?? {};
  const e = { ...deliveryOf(b, key), [step]: date };
  b.deliveries[key] = e;
  const on = !!date;
  const set = (arr: string[], v: string) => on ? [...new Set([...arr, v])] : arr.filter(r => r !== v);
  if (key.startsWith('m:')) {
    const mk = key.slice(2);
    if (step === 'visit') b.visits = set(b.visits, mk);
    if (step === 'uploaded') b.uploads = set(b.uploads, mk);
  } else if (key.startsWith('r:') && step === 'uploaded') b.regencias = set(b.regencias, key.slice(2));
  if (on) b.lastUpdated = todayISO();
}

function clearSnoozed(d: AppData, id: string) {
  const b = d.projects.find(x => x.id === id);
  if (!b) return;
  d.snoozed = d.snoozed.filter(p => {
    if (p.ref !== id) return true;
    const m = /^m:[^:]+:(\d{4}-\d{2})/.exec(p.key);
    if (m) return !(b.uploads.includes(m[1]) && b.visits.includes(m[1]));
    const i = /^i:[^:]+:(\d{4}-\d{2}-\d{2})/.exec(p.key);
    if (i) return !b.regencias.includes(i[1]);
    return true;
  });
}

/** Marks a delivery step with a date (or null to unmark it). */
export function markStep(id: string, key: string, step: Step, date: string | null) {
  mutate(d => {
    const b = d.projects.find(x => x.id === id);
    if (!b) return;
    applyStep(b, key, step, date);
    // a Regencia uploaded was elaborated; with its nota de recibido it was also uploaded
    if (date && key.startsWith('r:')) {
      if ((step === 'uploaded' || step === 'received') && !deliveryOf(b, key).letter) applyStep(b, key, 'letter', date);
      if (step === 'received' && !deliveryOf(b, key).uploaded) applyStep(b, key, 'uploaded', date);
    }
    clearSnoozed(d, id);
  });
}

/** Changes the due date (null = back to automatic) or the letter text. */
export function editDelivery(id: string, key: string, change: Partial<Pick<Delivery, 'planned' | 'due' | 'letterText' | 'notes'>>, opts: { undo?: boolean } = {}) {
  mutate(d => {
    const b = d.projects.find(x => x.id === id);
    if (!b) return;
    b.deliveries = b.deliveries ?? {};
    b.deliveries[key] = { ...deliveryOf(b, key), ...change };
  }, opts);
}

/** Checks off everything still pending dated before `before` (projects `ids`), each with its own date. */
export function markAllBefore(ids: string[], before: string): number {
  let n = 0;
  mutate(d => {
    for (const b of d.projects) {
      if (!ids.includes(b.id)) continue;
      for (const t of pendingBefore(b, before)) { applyStep(b, t.key, t.step, t.date); n++; }
    }
  });
  return n;
}

/** Marks / unmarks the month's upload to SETENA or its visit. */
export function markMonth(id: string, mk: string, task: MonthTask | 'both', on = true) {
  mutate(d => {
    const b = d.projects.find(x => x.id === id);
    if (!b) return;
    const key = monthKey(mk), e = deliveryOf(b, key);
    if (task !== 'visit') applyStep(b, key, 'uploaded', on ? e.uploaded ?? todayISO() : null);
    if (task !== 'upload') applyStep(b, key, 'visit', on ? e.visit ?? todayISO() : null);
    clearSnoozed(d, id);
  });
}

/** Marks / unmarks a (semiannual) Regencia as uploaded. `vence` = automatic date (key). */
export function markRegencia(id: string, due: string, on = true) {
  mutate(d => {
    const b = d.projects.find(x => x.id === id);
    if (!b) return;
    const key = regenciaKey(due);
    applyStep(b, key, 'uploaded', on ? deliveryOf(b, key).uploaded ?? todayISO() : null);
    clearSnoozed(d, id);
  });
}

/** After saving photos of a visit: marks «visit» and «photos» on the matching Informe Regencial and,
 *  if the project has no location yet, takes it from the photos' GPS. Returns the month marked (or null). */
export function recordVisit(id: string, date: string, gps: { lat: number; lng: number } | null, opts: { location?: boolean; undo?: boolean } = {}): string | null {
  let month: string | null = null;
  mutate(d => {
    const b = d.projects.find(x => x.id === id);
    if (!b) return;
    month = monthForVisit(b, date);
    if (month) {
      const key = monthKey(month), e = deliveryOf(b, key);
      if (!e.visit) applyStep(b, key, 'visit', date);
      if (!e.photos) applyStep(b, key, 'photos', date);
    }
    if (gps && opts.location !== false && !b.location) b.location = { ...gps, text: '', source: 'photo' };
    clearSnoozed(d, id);
  }, { undo: opts.undo });
  return month;
}

/** Adds photos / documents to a delivery. Photos mark «visit» and «photos» (with the date they were taken)
 *  and give the project its location if it has none; a document marks «letter». Returns what was marked. */
export function addDeliveryFiles(id: string, key: string, files: Attachment[]): string[] {
  const marked: string[] = [];
  mutate(d => {
    const b = d.projects.find(x => x.id === id);
    if (!b) return;
    b.deliveries = b.deliveries ?? {};
    const e = { ...deliveryOf(b, key) };
    e.files = [...(e.files ?? []), ...files];
    b.deliveries[key] = e;
    const photos = files.filter(f => f.type === 'photo');
    const docs = files.filter(f => f.type !== 'photo');
    if (photos.length) {
      const dates = photos.map(f => f.takenOn).filter(Boolean) as string[];
      const date = dates.sort()[dates.length - 1] ?? todayISO();
      if (!e.visit) { applyStep(b, key, 'visit', date); marked.push('inspección'); }
      if (!e.photos) { applyStep(b, key, 'photos', date); marked.push('fotos'); }
      const gps = photos.filter(f => f.lat != null && f.lng != null);
      if (!b.location && gps.length) {
        b.location = { lat: +(gps.reduce((s, f) => s + f.lat!, 0) / gps.length).toFixed(6), lng: +(gps.reduce((s, f) => s + f.lng!, 0) / gps.length).toFixed(6), text: '', source: 'photo' };
        marked.push('ubicación');
      }
    }
    // SETENA's «nota de recibido» of a Regencia: it was received (so it was also uploaded)
    const receipts = docs.filter(f => f.role === 'receipt');
    if (receipts.length) {
      if (!e.received) { applyStep(b, key, 'received', todayISO()); marked.push('recibida'); }
      if (!e.uploaded) { applyStep(b, key, 'uploaded', todayISO()); marked.push('subida'); }
    }
    // Attaching the Regencia document = elaborated and uploaded
    if (docs.length > receipts.length && key.startsWith('r:')) {
      if (!e.letter) { applyStep(b, key, 'letter', todayISO()); marked.push('elaboración'); }
      if (!e.uploaded) { applyStep(b, key, 'uploaded', todayISO()); marked.push('subida'); }
    }
    clearSnoozed(d, id);
  });
  return marked;
}

/** Removes a file from a delivery (the file itself goes to the «papelera» folder, see the caller). */
export function removeDeliveryFile(id: string, key: string, fileId: string) {
  mutate(d => {
    const b = d.projects.find(x => x.id === id);
    if (!b?.deliveries?.[key]) return;
    b.deliveries[key] = { ...b.deliveries[key], files: (b.deliveries[key].files ?? []).filter(f => f.id !== fileId) };
  });
}

/** Moves the photos and documents of visit / Regencia log entries into the delivery (month) they belong to,
 *  by the date each photo was taken (or the entry's date). Observation / other entries keep their files.
 *  Entries left with no text and no files are removed. Works on `d` in place; returns how many files moved. */
export function fileLogIntoDeliveries(d: AppData): number {
  let moved = 0;
  for (const b of d.projects) {
    for (const entry of b.entries) {
      if ((entry.type !== 'visit' && entry.type !== 'regencia') || !entry.attachments.length) continue;
      const keep: Attachment[] = [];
      for (const f of entry.attachments) {
        // Photos always go to the month's Inspección; documents of a Regencia go to that Regencia
        const key = entry.type === 'regencia' && entry.regencia && f.type !== 'photo' ? `r:${entry.regencia}` : deliveryKeyForDate(b, f.takenOn ?? entry.date);
        if (!key) { keep.push(f); continue; }
        b.deliveries = b.deliveries ?? {};
        const e = { ...deliveryOf(b, key) };
        if (!(e.files ?? []).some(x => x.path === f.path)) e.files = [...(e.files ?? []), f];
        if (f.type === 'photo' && !e.photos) e.photos = f.takenOn ?? entry.date;
        b.deliveries[key] = e;
        moved++;
      }
      entry.attachments = keep;
    }
    b.entries = b.entries.filter(x => x.text.trim() || x.attachments.length);
    // Photos only belong to the Inspección: move any photo filed under a Regencia (or the start letter) to its month
    for (const [k, e] of Object.entries(b.deliveries ?? {})) {
      if (k.startsWith('m:')) continue;
      const photos = (e.files ?? []).filter(f => f.type === 'photo');
      for (const f of photos) {
        const key = deliveryKeyForDate(b, f.takenOn ?? k.slice(2));
        if (!key) continue;
        const m = { ...deliveryOf(b, key) };
        if (!(m.files ?? []).some(x => x.path === f.path)) m.files = [...(m.files ?? []), f];
        if (!m.photos) m.photos = f.takenOn ?? null;
        b.deliveries![key] = m;
        b.deliveries![k] = { ...b.deliveries![k], files: (b.deliveries![k].files ?? []).filter(x => x.id !== f.id) };
        moved++;
      }
    }
  }
  return moved;
}

let relocating = false;
/** Moves every delivery file into its folder on disk (Proyectos/<Código - Nombre>/<Año>/<MM - Mes>/Fotos|Regencias,
 *  …/Inicio de obras): files from before, photos from the phone and projects that were renamed. */
export async function relocateFiles(): Promise<number> {
  if (relocating) return 0;
  relocating = true;
  try {
    const moves: { id: string; key: string; fileId: string; path: string }[] = [];
    for (const b of getData().projects) {
      for (const [key, e] of Object.entries(b.deliveries ?? {})) {
        const target = deliveryFolder(b, key);
        for (const f of e.files ?? []) {
          if (folderOf(f.path) === target) continue;
          try { moves.push({ id: b.id, key, fileId: f.id, path: await backend.moveAttachment(f.path, target) }); }
          catch { /* file missing: leave it as it is */ }
        }
      }
    }
    const changed = moves.filter(m => getData().projects.find(b => b.id === m.id)?.deliveries?.[m.key]?.files.find(f => f.id === m.fileId)?.path !== m.path);
    if (changed.length) mutate(d => {
      for (const m of changed) {
        const e = d.projects.find(b => b.id === m.id)?.deliveries?.[m.key];
        if (e) e.files = e.files.map(f => f.id === m.fileId ? { ...f, path: m.path } : f);
      }
    }, { undo: false });
    return changed.length;
  } finally { relocating = false; }
}

/** Runs `fileLogIntoDeliveries` as a saved change (after new photos arrive). */
export function organizeFiles() {
  let moved = 0;
  mutate(d => { moved = fileLogIntoDeliveries(d); }, { undo: false });
  void relocateFiles();
  return moved;
}

/** Saves the project location. */
export function setLocation(id: string, u: ProjectLocation | null) {
  mutate(d => { const b = d.projects.find(x => x.id === id); if (b) b.location = u; });
}

/** Archives / restores a project (leaves the active list and the reminders, without being deleted). */
export function archive(id: string, on = true) {
  mutate(d => {
    const b = d.projects.find(x => x.id === id);
    if (!b) return;
    b.archived = on;
    b.archivedOn = on ? todayISO() : null;
    if (on) d.snoozed = d.snoozed.filter(p => p.ref !== id);
  });
}
