// ===== What the user put in the folders by hand (File Explorer, phone sync, camera card…) =====
// Reads Proyectos/<Código - Nombre>/<Año>/<MM - Mes>/Fotos|Regencias and …/Inicio de obras:
//  · photos in a month's Fotos folder → that month's Inspección is checked, on the date the photo was taken
//    (EXIF), and a project without location takes it from the photos' GPS;
//  · a document in a Regencias folder → that Regencia is «elaborada» and «subida»;
//  · a document in Inicio de obras → the Carta de Inicio de obras is checked.
// Only the first bytes of each photo are read (the EXIF), and only when something is still unchecked.
import type { Project } from './types';
import { isActiveProject } from './types';
import { backend, esWeb } from './backend';
import { getData, mutate, applyStep, deliveryOf } from './store';
import { dueInMonth, hasSchedule, inspectionDate } from './schedule';
import { readExif } from './exif';
import { addMonths, todayISO } from './dates';
import { projectFolder, regenciaKeyFor, setenaTarget } from './folders';

const IMG = /\.(jpe?g|png|heic|heif|webp)$/i;
const DOC = /\.(docx?|pdf|odt|rtf|xlsx?)$/i;
const MONTH_DIR = /\/(\d{4})\/(\d{2}) - [^/]+\/(Fotos|Regencias)\/[^/]+$/;
const SETENA_DIR = /\/\d{4}\/\d{2} - [^/]+\/SETENA\/[^/]+\.jpe?g$/i;
/** A file downloaded from SETENA: …/<Año>/<MM - Mes>/SETENA/<YYYY-MM-DD>_… (the date of its SETENA entry). */
const SETENA_FILE = /\/(\d{4})\/(\d{2}) - [^/]+\/(?:SETENA|Fotos|Regencias|Documentos)\/(\d{4}-\d{2}-\d{2})_[0-9a-f]{8}\.[a-z0-9]{2,5}$/i;
const IN_SETENA = /\/(\d{4})\/(\d{2}) - [^/]+\/SETENA\/([^/]+)$/;

function b64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}

/** Monthly key whose inspection falls in folder month `ym` (it may have been moved), or that month itself. */
function inspectionKeyFor(b: Project, ym: string): string | null {
  for (let i = -3; i <= 3; i++) {
    const mk = addMonths(`${ym}-15`, i).slice(0, 7);
    if (dueInMonth(b, mk) && inspectionDate(b, mk).slice(0, 7) === ym) return `m:${mk}`;
  }
  return dueInMonth(b, ym) ? `m:${ym}` : null;
}

let busy = false, last = 0;

/** Looks at every active project's folder; returns a short summary of what it checked. */
export async function scanFolders(force = false): Promise<string> {
  if (esWeb || busy || (!force && Date.now() - last < 20_000)) return '';
  busy = true; last = Date.now();
  const today = todayISO();
  const visits: { id: string; key: string; date: string }[] = [];
  const regs: { id: string; key: string; date?: string }[] = [];
  const bits: { id: string; key: string; date: string }[] = [];
  let sorted = 0;
  const starts: string[] = [];
  const places: { id: string; lat: number; lng: number }[] = [];
  try {
    for (const b of getData().projects) {
      if (!isActiveProject(b) || !hasSchedule(b)) continue;
      let files: { path: string; size: number; modified: number }[];
      try { files = await backend.listTree(projectFolder(b)); } catch { continue; }
      if (!files.length) continue;
      // Files downloaded from SETENA: from the month's SETENA folder to that month's Fotos / Regencias / Documentos
      let movedAny = false;
      for (const f of files) {
        const m = IN_SETENA.exec(f.path);
        if (!m) continue;
        const target = setenaTarget(b, `${m[1]}-${m[2]}`, m[3]);
        if (target.endsWith('/SETENA')) continue;
        if (files.some(x => x.path === `${target}/${m[3]}`)) continue;
        try { await backend.moveAttachment(f.path, target); movedAny = true; sorted++; } catch { /* in use: next time */ }
      }
      if (movedAny) { try { files = await backend.listTree(projectFolder(b)); } catch { continue; } }
      const byKey = new Map<string, typeof files>();
      const gps: { lat: number; lng: number }[] = [];
      const setenaPhotos = b.location ? [] : files.filter(f => SETENA_DIR.test(f.path)).sort((a, c) => c.path.localeCompare(a.path));
      // ---- What came from SETENA, month by month (by the date of each entry) ----
      const earliest = (l: { key: string; date: string }[], key: string, date: string) => {
        const x = l.find(y => y.key === key);
        if (!x) l.push({ key, date }); else if (date < x.date) x.date = date;
      };
      const sBits: { key: string; date: string }[] = [], sVisits: { key: string; date: string }[] = [], sRegs: { key: string; date: string }[] = [];
      for (const f of files) {
        const m = SETENA_FILE.exec(f.path);
        if (!m) continue;
        const ym = `${m[1]}-${m[2]}`, date = m[3];
        // an entry in a month = that month's bitácora filled in
        if (dueInMonth(b, ym)) earliest(sBits, `m:${ym}`, date);
        // photos = that month's inspection
        if (IMG.test(f.path)) { const k = inspectionKeyFor(b, ym); if (k) earliest(sVisits, k, date); }
        // a document in the same month as a Regencia = that Regencia elaborated and uploaded
        else if (DOC.test(f.path)) { const k = regenciaKeyFor(b, ym); if (k) earliest(sRegs, k, date); }
      }
      // entries with text only (no files) are in that month's notes: «SETENA dd/mm/yyyy: …»
      for (const [k, e] of Object.entries(b.deliveries ?? {})) {
        if (!k.startsWith('m:') || !e.notes) continue;
        for (const mm of e.notes.matchAll(/^SETENA (\d{2})\/(\d{2})\/(\d{4}):/gm)) {
          const date = `${mm[3]}-${mm[2]}-${mm[1]}`, ym = date.slice(0, 7);
          if (dueInMonth(b, ym)) earliest(sBits, `m:${ym}`, date);
        }
      }
      for (const x of sBits) if (!deliveryOf(b, x.key).uploaded) bits.push({ id: b.id, ...x });
      for (const x of sVisits) if (!deliveryOf(b, x.key).visit) visits.push({ id: b.id, key: x.key, date: x.date <= today ? x.date : today });
      for (const x of sRegs) if (!deliveryOf(b, x.key).uploaded) regs.push({ id: b.id, key: x.key, date: x.date });

      for (const f of files) {
        if (/\/Inicio de obras\/[^/]+$/.test(f.path) && DOC.test(f.path) && !deliveryOf(b, 's:start').uploaded && !starts.includes(b.id)) { starts.push(b.id); continue; }
        const m = MONTH_DIR.exec(f.path);
        if (!m) continue;
        const ym = `${m[1]}-${m[2]}`;
        if (m[3] === 'Fotos' && IMG.test(f.path)) {
          const key = inspectionKeyFor(b, ym);
          if (key && !visits.some(v => v.id === b.id && v.key === key)) byKey.set(key, [...(byKey.get(key) ?? []), f]);
        } else if (m[3] === 'Regencias' && DOC.test(f.path)) {
          const key = regenciaKeyFor(b, ym);
          if (key && !deliveryOf(b, key).uploaded && !regs.some(r => r.id === b.id && r.key === key)) regs.push({ id: b.id, key });
        }
      }
      // Photos: read the EXIF only where the inspection is still unchecked, or to find the project's location
      let readForGps = 0;
      for (const [key, photos] of byKey) {
        const needVisit = !deliveryOf(b, key).visit;
        if (!needVisit && (b.location || readForGps >= 6)) continue;
        const dates: string[] = [];
        for (const f of photos.slice(0, needVisit ? 12 : 3)) {
          if (!/\.jpe?g$/i.test(f.path)) { if (f.modified) dates.push(new Date(f.modified).toISOString().slice(0, 10)); continue; }
          try {
            const info = readExif(b64ToBuf(await backend.readHead(f.path, 262_144)));
            if (info.date) dates.push(info.date);
            else if (f.modified) dates.push(new Date(f.modified).toISOString().slice(0, 10));
            if (info.lat != null && info.lng != null) gps.push({ lat: info.lat, lng: info.lng });
          } catch { /* unreadable photo */ }
          readForGps++;
        }
        if (needVisit) {
          const ym = key.slice(2), insp = inspectionDate(b, ym);
          // the photo date if it is near the inspection month, otherwise the inspection date
          const near = dates.filter(x => x >= addMonths(insp, -1) && x <= addMonths(insp, 1)).sort();
          const date = near[near.length - 1] ?? insp;
          visits.push({ id: b.id, key, date: date <= today ? date : today });
        }
      }
      // Photos downloaded from SETENA: only to read where they were taken (nothing is checked from them)
      for (const f of setenaPhotos.slice(0, 25)) {
        if (gps.length >= 5) break;
        try {
          const info = readExif(b64ToBuf(await backend.readHead(f.path, 262_144)));
          if (info.lat != null && info.lng != null) gps.push({ lat: info.lat, lng: info.lng });
        } catch { /* unreadable photo */ }
      }
      if (!b.location && gps.length) {
        // the median, so one photo taken somewhere else doesn't move the project
        const med = (l: number[]) => { const x = [...l].sort((a, c) => a - c); return x[Math.floor(x.length / 2)]; };
        places.push({ id: b.id, lat: +med(gps.map(p => p.lat)).toFixed(6), lng: +med(gps.map(p => p.lng)).toFixed(6) });
      }
    }
    if (!visits.length && !regs.length && !starts.length && !places.length && !bits.length) return sorted ? `${sorted} archivo(s) de SETENA ordenados en Fotos / Regencias / Documentos` : '';
    mutate(d => {
      for (const v of visits) { const b = d.projects.find(x => x.id === v.id); if (b && !deliveryOf(b, v.key).visit) { applyStep(b, v.key, 'visit', v.date); applyStep(b, v.key, 'photos', v.date); } }
      for (const r of regs) { const b = d.projects.find(x => x.id === r.id); if (b && !deliveryOf(b, r.key).uploaded) { if (!deliveryOf(b, r.key).letter) applyStep(b, r.key, 'letter', r.date ?? today); applyStep(b, r.key, 'uploaded', r.date ?? today); } }
      for (const x of bits) { const b = d.projects.find(y => y.id === x.id); if (b && !deliveryOf(b, x.key).uploaded) applyStep(b, x.key, 'uploaded', x.date <= today ? x.date : today); }
      for (const id of starts) { const b = d.projects.find(x => x.id === id); if (b) applyStep(b, 's:start', 'uploaded', today); }
      for (const p of places) { const b = d.projects.find(x => x.id === p.id); if (b && !b.location) b.location = { lat: p.lat, lng: p.lng, text: '', source: 'photo' }; }
    }, { undo: true });
    return [sorted && `${sorted} archivo(s) de SETENA ordenados`, bits.length && `${bits.length} bitácora(s) marcadas por SETENA`, visits.length && `${visits.length} inspección(es) marcadas por sus fotos`, regs.length && `${regs.length} regencia(s) encontradas`,
      starts.length && `${starts.length} carta(s) de inicio`, places.length && `ubicación de ${places.length} proyecto(s) tomada del GPS`].filter(Boolean).join(' · ');
  } finally { busy = false; }
}
