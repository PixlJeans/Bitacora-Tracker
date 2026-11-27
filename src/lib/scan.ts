// ===== What the user put in the folders by hand (File Explorer, phone sync, camera card…) =====
// Reads Proyectos/<Código - Nombre>/<Año>/<MM - Mes>/Fotos|Regencias and …/Inicio de obras:
//  · photos in a month's Fotos folder → that month's Inspección is checked, on the date the photo was taken
//    (EXIF), and a project without location takes it from the photos' GPS;
//  · a document in a Regencias folder → the closest Regencia (±6 months) is «elaborada» and «subida»; if it was
//    uploaded in another month, the Regencia moves to that date so its card shows its files;
//  · a document in a «Notas de recibido» folder → the closest Regencia also gets its nota de recibido;
//  · a document in Inicio de obras → the Carta de Inicio de obras is checked.
// Only the first bytes of each photo are read (the EXIF), and only when something is still unchecked.
import type { Project } from './types';
import { backend, esWeb } from './backend';
import { getData, mutate, applyStep, deliveryOf } from './store';
import { monthExists, inspectionDate, regenciaDue } from './schedule';
import { readExif } from './exif';
import { addMonths, todayISO } from './dates';
import { projectFolder, regenciaKeyNear, regenciaKeyForPeriod, setenaTarget } from './folders';
import { sortDocuments } from './docSort';
import { KIND_NAME, type DocKind } from './docKind';

const IMG = /\.(jpe?g|png|heic|heif|webp)$/i;
const DOC = /\.(docx?|pdf|odt|rtf|xlsx?)$/i;
const MONTH_DIR = /\/(\d{4})\/(\d{2}) - [^/]+\/(Fotos|Regencias|Notas de recibido)\/([^/]+)$/;
/** A file downloaded from SETENA: …/<Año>/<MM - Mes>/SETENA/<YYYY-MM-DD>_… (the date of its SETENA entry). */
const SETENA_FILE = /\/(\d{4})\/(\d{2}) - [^/]+\/(?:SETENA|Fotos|Regencias|Documentos)\/(\d{4}-\d{2}-\d{2})_[0-9a-f]{8}\.[a-z0-9]{2,5}$/i;
// files still waiting to be sorted: in the month's SETENA folder, or SETENA documents left in the old «Documentos» folder
const IN_SETENA = /\/(\d{4})\/(\d{2}) - [^/]+\/(?:SETENA\/([^/]+)|Documentos\/(\d{4}-\d{2}-\d{2}_[0-9a-f]{8}\.[a-z0-9]{2,5}))$/i;

function b64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}

/** Monthly key whose inspection falls in folder month `ym` (it may have been moved), or that month itself. */
function inspectionKeyFor(b: Project, ym: string): string | null {
  for (let i = -3; i <= 3; i++) {
    const mk = addMonths(`${ym}-15`, i).slice(0, 7);
    if (monthExists(b, mk) && inspectionDate(b, mk).slice(0, 7) === ym) return `m:${mk}`;
  }
  return monthExists(b, ym) ? `m:${ym}` : null;
}

let busy = false, last = 0;

/** Looks at every active project's folder; returns a short summary of what it checked. */
export async function scanFolders(force = false): Promise<string> {
  if (esWeb || busy || (!force && Date.now() - last < 20_000)) return '';
  busy = true; last = Date.now();
  const today = todayISO();
  const visits: { id: string; key: string; date: string }[] = [];
  const regs: { id: string; key: string; date: string; move?: string; received?: boolean; signed?: string }[] = [];
  const bits: { id: string; key: string; date: string }[] = [];
  const photoRecords: { id: string; shots: Record<string, number> }[] = [];
  const wrong: { id: string; key: string; date: string }[] = [];
  const signFills: { id: string; key: string; date: string; fromPdf: boolean }[] = [];
  let sorted = 0;
  const starts: { id: string; date: string }[] = [];
  const places: { id: string; lat: number; lng: number }[] = [];
  const docKinds: Record<string, number> = {};
  let docsRead = 0, docsMoved = 0;
  const budget = { left: 80 };
  // empty project folders (made by 📂 or by moves) go to «Carpetas vacías (se pueden borrar)»
  let tidied = 0, adopted = 0;
  const renamed: string[] = [], locatedByDoc: string[] = [];
  try { tidied = await backend.tidyEmptyFolders(); } catch { /* not on desktop */ }
  const tidyMsg = tidied ? `${tidied} carpeta(s) vacía(s) movidas a «Carpetas vacías (se pueden borrar)»` : '';
  try {
    for (const b0 of getData().projects) {
      if (b0.archived) continue;
      let b = b0;
      // every project with an opening date: active ones and also «Solicitud de Cierre» / terminadas (their history)
      const tracked = !b.noOpeningDate;
      let files: { path: string; size: number; modified: number }[];
      // files of an older name of the project («<código> - <nombre viejo>») come into the current folder
      try { adopted += await backend.adoptProjectFolder(b.code, projectFolder(b)); } catch { /* not on desktop */ }
      try { files = await backend.listTree(projectFolder(b)); } catch { continue; }
      if (!files.length) continue;
      // ---- PDFs from SETENA: read what each one is and put it in its folder (every project, once per file) ----
      if (budget.left > 0) {
        const r = await sortDocuments(b, files, budget);
        if (r.read) {
          docsRead += r.read; docsMoved += r.moved;
          for (const [k, n] of Object.entries(r.kinds)) docKinds[k] = (docKinds[k] ?? 0) + n;
          b = getData().projects.find(x => x.id === b.id) ?? b;
          if (r.located) locatedByDoc.push(b.code);
          if (r.renamed) {
            // the name came from its regencia's cover: the folder takes the new name too (files moved, nothing replaced)
            renamed.push(`${b.code} → ${r.renamed}`);
            try { await backend.adoptProjectFolder(b.code, projectFolder(b)); } catch { /* next scan */ }
          }
          if (r.moved || r.renamed) { try { files = await backend.listTree(projectFolder(b)); } catch { continue; } }
        }
      }
      if (!tracked && b.location) continue;
      // ---- Location: a project without one takes it from its photos' GPS (any folder, even without dates) ----
      if (!b.location) {
        const photos = files.filter(f => /\.jpe?g$/i.test(f.path)).sort((a, c) => c.path.localeCompare(a.path));
        // spread over the whole project (newest first), at most 60 photos, until 7 positions are found
        const step = Math.max(1, Math.floor(photos.length / 60));
        const gps: { lat: number; lng: number }[] = [];
        for (let i = 0; i < photos.length && gps.length < 7; i += step) {
          try {
            const info = readExif(b64ToBuf(await backend.readHead(photos[i].path, 262_144)));
            if (info.lat != null && info.lng != null && Math.abs(info.lat) > 0.01) gps.push({ lat: info.lat, lng: info.lng });
          } catch { /* unreadable photo */ }
        }
        if (gps.length) {
          // the median, so one photo taken somewhere else doesn't move the project
          const med = (l: number[]) => { const x = [...l].sort((a, c) => a - c); return x[Math.floor(x.length / 2)]; };
          places.push({ id: b.id, lat: +med(gps.map(p => p.lat)).toFixed(6), lng: +med(gps.map(p => p.lng)).toFixed(6) });
        }
      }
      if (!tracked) continue;
      // Files downloaded from SETENA: from the month's SETENA (or old Documentos) folder to that month's Fotos / Regencias
      let movedAny = false;
      for (const f of files) {
        const m = IN_SETENA.exec(f.path);
        if (!m) continue;
        const name = m[3] ?? m[4];
        if (/\.pdf$/i.test(name)) continue; // PDFs: sorted by what they say (docSort)
        const target = setenaTarget(b, `${m[1]}-${m[2]}`, name);
        if (target.endsWith('/SETENA') || f.path === `${target}/${name}`) continue;
        if (files.some(x => x.path === `${target}/${name}`)) continue;
        try { await backend.moveAttachment(f.path, target); movedAny = true; sorted++; } catch { /* in use: next time */ }
      }
      if (movedAny) { try { files = await backend.listTree(projectFolder(b)); } catch { continue; } }
      const byKey = new Map<string, typeof files>();
      // ---- What came from SETENA, month by month (by the date of each entry) ----
      const earliest = (l: { key: string; date: string }[], key: string, date: string) => {
        const x = l.find(y => y.key === key);
        if (!x) l.push({ key, date }); else if (date < x.date) x.date = date;
      };
      const sBits: { key: string; date: string }[] = [], sVisits: { key: string; date: string }[] = [];
      const shots: Record<string, number> = {}; // SETENA photos per entry date (for the Línea de tiempo)
      for (const f of files) {
        const m = SETENA_FILE.exec(f.path);
        if (!m) continue;
        const ym = `${m[1]}-${m[2]}`, date = m[3];
        // an entry in a month = that month's bitácora filled in
        if (monthExists(b, ym)) earliest(sBits, `m:${ym}`, date);
        // photos = that month's inspection
        if (IMG.test(f.path)) { const k = inspectionKeyFor(b, ym); if (k) earliest(sVisits, k, date); shots[date] = (shots[date] ?? 0) + 1; }
      }
      // entries with text only (no files) are in that month's notes: «SETENA dd/mm/yyyy: …»
      for (const [k, e] of Object.entries(b.deliveries ?? {})) {
        if (!k.startsWith('m:') || !e.notes) continue;
        for (const mm of e.notes.matchAll(/^SETENA (\d{2})\/(\d{2})\/(\d{4}):/gm)) {
          const date = `${mm[3]}-${mm[2]}-${mm[1]}`, ym = date.slice(0, 7);
          if (monthExists(b, ym)) earliest(sBits, `m:${ym}`, date);
        }
      }
      if (JSON.stringify(shots) !== JSON.stringify(b.setenaPhotos ?? {})) photoRecords.push({ id: b.id, shots });
      for (const x of sBits) if (!deliveryOf(b, x.key).uploaded) bits.push({ id: b.id, ...x });
      for (const x of sVisits) if (!deliveryOf(b, x.key).visit) visits.push({ id: b.id, key: x.key, date: x.date <= today ? x.date : today });
      // Regencia documents and notas de recibido, each to the closest Regencia (date: from the SETENA name, else the folder month)
      // regencias checked by an earlier version with a document that covers ANOTHER semester: uncheck them
      // (only when that check's date is exactly that document's date and no document covers this one)
      const docKeyOfDate = new Map<string, string>(), covered = new Set<string>();
      for (const [name, info] of Object.entries(b.docs ?? {})) {
        if (info.kind !== 'regencia') continue;
        const d0 = /^(\d{4}-\d{2}-\d{2})_/.exec(name)?.[1], k = regenciaKeyForPeriod(b, info.period);
        if (d0 && k) { docKeyOfDate.set(d0, k); covered.add(k); }
      }
      for (const [k, e] of Object.entries(b.deliveries ?? {})) {
        if (!k.startsWith('r:') || !e.uploaded) continue;
        const k2 = docKeyOfDate.get(e.uploaded);
        if (k2 && k2 !== k && !covered.has(k)) wrong.push({ id: b.id, key: k, date: e.uploaded });
      }
      const regDocs = new Map<string, string[]>(), recDocs = new Map<string, string[]>();

      for (const f of files) {
        if (/\/Inicio de obras\/[^/]+$/.test(f.path) && DOC.test(f.path) && !deliveryOf(b, 's:start').uploaded && !starts.some(x => x.id === b.id)) {
          // the letter's own date: from its SETENA name, else when the file was saved (never «today» by default)
          const named = /\/(\d{4}-\d{2}-\d{2})_[^/]+$/.exec(f.path)?.[1];
          const date = named ?? (f.modified ? new Date(f.modified).toISOString().slice(0, 10) : today);
          starts.push({ id: b.id, date: date <= today ? date : today }); continue;
        }
        const m = MONTH_DIR.exec(f.path);
        if (!m) continue;
        const ym = `${m[1]}-${m[2]}`;
        if (m[3] === 'Fotos' && IMG.test(f.path)) {
          const key = inspectionKeyFor(b, ym);
          if (key && !visits.some(v => v.id === b.id && v.key === key)) byKey.set(key, [...(byKey.get(key) ?? []), f]);
        } else if (m[3] !== 'Fotos' && DOC.test(f.path) && !(/^\d{4}-\d{2}-\d{2}_.+\.pdf$/i.test(m[4]) && !b.docs?.[m[4]])) {
          // (a SETENA PDF counts only once it has been read; until then it waits)
          const date = /^(\d{4}-\d{2}-\d{2})_/.exec(m[4])?.[1] ?? `${ym}-15`;
          // a regencia says which semester it covers («Periodo … Agosto 2023 - Enero 2024»): that one, not the nearest date
          // a receipt goes with the regencia of its day (it is SETENA's receipt of that one)
          const key = (m[3] === 'Regencias' ? regenciaKeyForPeriod(b, b.docs?.[m[4]]?.period) : docKeyOfDate.get(date)) || regenciaKeyNear(b, date);
          const map = m[3] === 'Regencias' ? regDocs : recDocs;
          if (key) map.set(key, [...(map.get(key) ?? []), date]);
        }
      }
      // regencias sent before «Firma del cliente» existed: signed on the date of the client's digital signature
      for (const [k, e] of Object.entries(b.deliveries ?? {})) {
        if (!k.startsWith('r:') || !e.uploaded || e.signed) continue;
        const sig = Object.entries(b.docs ?? {}).find(([n, x]) => n.startsWith(`${e.uploaded}_`) && x.kind === 'regencia' && x.clientSigned)?.[1].clientSigned;
        signFills.push({ id: b.id, key: k, date: sig && sig <= e.uploaded ? sig : e.uploaded, fromPdf: !!sig });
      }
      const fixing = new Set(wrong.filter(w => w.id === b.id).map(w => w.key));
      for (const [key, dates] of regDocs) {
        const e = deliveryOf(b, key);
        if (e.uploaded && !fixing.has(key)) continue;
        // the document closest to the due date; the Regencia moves there when it is in another month
        const due = regenciaDue(b, key.slice(2)), t = (x: string) => Math.abs(Date.parse(x) - Date.parse(due));
        const date = [...dates].sort((a, c) => t(a) - t(c))[0];
        const real = date <= today ? date : today;
        // when the client signed it: the digital signature in that PDF (never after it was sent)
        const sig = Object.entries(b.docs ?? {}).find(([n, x]) => n.startsWith(`${date}_`) && x.kind === 'regencia' && x.clientSigned)?.[1].clientSigned;
        regs.push({ id: b.id, key, date: real, move: !e.due && date.slice(0, 7) !== due.slice(0, 7) ? date : undefined, signed: sig && sig <= real ? sig : real });
      }
      for (const [key, dates0] of recDocs) {
        if (deliveryOf(b, key).received) continue;
        // a receipt can't be older than the regencia it acknowledges
        const up = deliveryOf(b, key).uploaded ?? regs.find(r => r.id === b.id && r.key === key)?.date;
        const dates = up ? dates0.filter(x => x >= up) : dates0;
        if (!dates.length) continue;
        const date = [...dates].sort()[0];
        regs.push({ id: b.id, key, date: date <= today ? date : today, received: true });
      }
      // Photos: read the EXIF date only where the inspection is still unchecked
      for (const [key, photos] of byKey) {
        if (deliveryOf(b, key).visit) continue;
        const dates: string[] = [];
        for (const f of photos.slice(0, 12)) {
          if (!/\.jpe?g$/i.test(f.path)) { if (f.modified) dates.push(new Date(f.modified).toISOString().slice(0, 10)); continue; }
          try {
            const info = readExif(b64ToBuf(await backend.readHead(f.path, 262_144)));
            if (info.date) dates.push(info.date);
            else if (f.modified) dates.push(new Date(f.modified).toISOString().slice(0, 10));
          } catch { /* unreadable photo */ }
        }
        const ym = key.slice(2), insp = inspectionDate(b, ym);
        // the photo date if it is near the inspection month, otherwise the inspection date
        const near = dates.filter(x => x >= addMonths(insp, -1) && x <= addMonths(insp, 1)).sort();
        const date = near[near.length - 1] ?? insp;
        visits.push({ id: b.id, key, date: date <= today ? date : today });
      }
    }
    const docsMsg = docsRead ? `${docsRead} PDF de SETENA leídos (${Object.entries(docKinds).map(([k, n]) => `${n} ${KIND_NAME[k as DocKind]}`).join(', ')})${docsMoved ? `, ${docsMoved} movidos a su carpeta` : ''}` : '';
    // SETENA photos per date (silent: only for the Línea de tiempo)
    if (photoRecords.length) mutate(d => { for (const r of photoRecords) { const b = d.projects.find(x => x.id === r.id); if (b) b.setenaPhotos = r.shots; } }, { undo: false });
    if (!visits.length && !regs.length && !starts.length && !places.length && !bits.length && !wrong.length && !signFills.length)
      return [sorted && `${sorted} archivo(s) de SETENA ordenados en Fotos / Regencias`, docsMsg, tidyMsg, renamed.length && `nombre corregido desde su regencia: ${renamed.join(', ')}`, locatedByDoc.length && `ubicación tomada de las coordenadas de su regencia: ${locatedByDoc.join(', ')}`, adopted && `${adopted} archivo(s) de una carpeta con el nombre viejo del proyecto pasados a la actual`].filter(Boolean).join(' · ');
    mutate(d => {
      for (const v of visits) { const b = d.projects.find(x => x.id === v.id); if (b && !deliveryOf(b, v.key).visit) { applyStep(b, v.key, 'visit', v.date); applyStep(b, v.key, 'photos', v.date); } }
      for (const f of signFills) { const b = d.projects.find(x => x.id === f.id); if (b && !deliveryOf(b, f.key).signed && deliveryOf(b, f.key).uploaded) applyStep(b, f.key, 'signed', f.date); }
      for (const w of wrong) {
        const b = d.projects.find(x => x.id === w.id);
        if (!b || deliveryOf(b, w.key).uploaded !== w.date) continue;
        for (const st of ['uploaded', 'letter', 'signed', 'received'] as const) if (deliveryOf(b, w.key)[st] === w.date) applyStep(b, w.key, st, null);
        if (deliveryOf(b, w.key).due === w.date) b.deliveries![w.key] = { ...deliveryOf(b, w.key), due: null };
      }
      for (const r of regs) {
        const b = d.projects.find(x => x.id === r.id);
        if (!b) continue;
        if (r.move && !deliveryOf(b, r.key).due) { b.deliveries = b.deliveries ?? {}; b.deliveries[r.key] = { ...deliveryOf(b, r.key), due: r.move }; }
        // uploaded ⇒ elaborated; nota de recibido ⇒ uploaded and elaborated
        if (!deliveryOf(b, r.key).letter) applyStep(b, r.key, 'letter', r.signed && r.signed < r.date ? r.signed : r.date);
        if (!deliveryOf(b, r.key).signed) applyStep(b, r.key, 'signed', r.signed ?? r.date);
        if (!deliveryOf(b, r.key).uploaded) applyStep(b, r.key, 'uploaded', r.date);
        if (r.received && !deliveryOf(b, r.key).received) applyStep(b, r.key, 'received', r.date);
      }
      for (const x of bits) { const b = d.projects.find(y => y.id === x.id); if (b && !deliveryOf(b, x.key).uploaded) applyStep(b, x.key, 'uploaded', x.date <= today ? x.date : today); }
      for (const st of starts) { const b = d.projects.find(x => x.id === st.id); if (b) applyStep(b, 's:start', 'uploaded', st.date); }
      for (const p of places) { const b = d.projects.find(x => x.id === p.id); if (b && !b.location) b.location = { lat: p.lat, lng: p.lng, text: '', source: 'photo' }; }
    }, { undo: true });
    return [docsMsg, sorted && `${sorted} archivo(s) de SETENA ordenados`, bits.length && `${bits.length} bitácora(s) marcadas por SETENA`, visits.length && `${visits.length} inspección(es) marcadas por sus fotos`, regs.length && `${regs.length} regencia(s) / nota(s) de recibido marcadas`, signFills.some(f => f.fromPdf) && `${signFills.filter(f => f.fromPdf).length} firma(s) del cliente leídas de las regencias`, wrong.length && `${wrong.length} regencia(s) que estaban en el semestre equivocado corregidas (según el periodo de su PDF)`,
      starts.length && `${starts.length} carta(s) de inicio`, places.length && `ubicación de ${places.length} proyecto(s) tomada del GPS`, tidyMsg, renamed.length && `nombre corregido desde su regencia: ${renamed.join(', ')}`, locatedByDoc.length && `ubicación tomada de las coordenadas de su regencia: ${locatedByDoc.join(', ')}`, adopted && `${adopted} archivo(s) de una carpeta con el nombre viejo del proyecto pasados a la actual`].filter(Boolean).join(' · ');
  } finally { busy = false; }
}
