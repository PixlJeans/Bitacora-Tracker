// ===== What the user put in the folders by hand (File Explorer, phone sync, camera card…) =====
// Reads Proyectos/<Código - Nombre>/<Año>/<MM - Mes>/Fotos|Regencias and …/Inicio de obras:
//  · photos in a month's Fotos folder → that month's Inspección is checked, on the date the photo was taken
//    (EXIF), and a project without location takes it from the photos' GPS;
//  · a document in a Regencias folder → the closest Regencia (±6 months) is «elaborada» and «subida»; if it was
//    uploaded in another month, the Regencia moves to that date so its card shows its files;
//  · a document in a «Notas de recibido» folder → the closest Regencia also gets its nota de recibido;
//  · a document in Inicio de obras → the Carta de Inicio de obras is checked.
// Only the first bytes of each photo are read (the EXIF), and only when something is still unchecked.
import { backend, esWeb } from './backend';
import { getData, mutate, applyStep, deliveryOf } from './store';
import { monthExists, inspectionDate, regenciaDue, inspectionKeyFor } from './schedule';
import { readExif } from './exif';
import { addDays, addMonths, todayISO } from './dates';
import { isMine } from './setenaMatch';
import { resignedInSetena } from './timeline';
import { projectFolder, regenciaKeyNear, regenciaKeyForPeriod, regenciaShift, isExtraReport, setenaTarget, periodEnd } from './folders';
import { sortDocuments } from './docSort';
import { KIND_NAME, type DocKind } from './docKind';

const IMG = /\.(jpe?g|png|heic|heif|webp)$/i;
const DOC = /\.(docx?|pdf|odt|rtf|xlsx?)$/i;
const MONTH_DIR = /\/(\d{4})\/(\d{2}) - [^/]+\/(Fotos|Regencias|Notas de recibido)\/([^/]+)$/;
/** A file downloaded from SETENA: …/<Año>/<MM - Mes>/SETENA/<YYYY-MM-DD>_… (the date of its SETENA entry). */
const SETENA_FILE = /\/(\d{4})\/(\d{2}) - [^/]+\/(?:SETENA|Fotos|Regencias|Documentos|Garantía ambiental)\/(\d{4}-\d{2}-\d{2})_[0-9a-f]{8}\.[a-z0-9]{2,5}$/i;
// files still waiting to be sorted: in the month's SETENA folder, or SETENA documents left in the old «Documentos» folder
const IN_SETENA = /\/(\d{4})\/(\d{2}) - [^/]+\/(?:SETENA\/([^/]+)|Documentos\/(\d{4}-\d{2}-\d{2}_[0-9a-f]{8}\.[a-z0-9]{2,5}))$/i;

function b64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
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
  const signFills: { id: string; key: string; date: string; fromPdf: boolean; fix?: boolean }[] = [];
  const dueFixes: { id: string; key: string; due: string | null }[] = [];
  const orphanFixes: { id: string; key: string; letter: boolean; signed: boolean }[] = [];
  const setenaFixes: { id: string; key: string; from: string; uploaded: string; signed: string; received: string | null }[] = [];
  let sorted = 0;
  const starts: { id: string; date: string }[] = [];
  const places: { id: string; lat: number; lng: number }[] = [];
  const docKinds: Record<string, number> = {};
  let docsRead = 0, docsMoved = 0;
  const budget: { left: number; ocr?: number } = { left: 80 };
  // empty project folders (made by 📂 or by moves) go to «Carpetas vacías (se pueden borrar)»
  let tidied = 0, adopted = 0;
  const renamed: string[] = [], locatedByDoc: string[] = [];
  try { tidied = await backend.tidyEmptyFolders(); } catch { /* not on desktop */ }
  const tidyMsg = tidied ? `${tidied} carpeta(s) vacía(s) movidas a «Carpetas vacías (se pueden borrar)»` : '';
  // the regente resigned (his last SETENA entry says so): the project goes to «Renuncia», once
  const resigned = getData().projects.filter(resignedInSetena).map(b => b.id);
  if (resigned.length) mutate(d => { for (const b of d.projects) if (resigned.includes(b.id)) { b.status = 'resigned'; b.resignChecked = true; } });
  const resignMsg = resigned.length ? `${resigned.map(id => getData().projects.find(b => b.id === id)?.code).join(', ')} → «Renuncia» (su última anotación en SETENA lo dice)` : '';
  try {
    for (const b0 of getData().projects) {
      if (b0.archived) continue;
      let b = getData().projects.find(x => x.id === b0.id) ?? b0; // fresh: an earlier project may have moved a file into this one
      // every project with an opening date: active ones and also «Solicitud de Cierre» / terminadas (their history)
      const tracked = !b.noOpeningDate;
      let files: { path: string; size: number; modified: number }[];
      // files of an older name of the project («<código> - <nombre viejo>») come into the current folder
      try { adopted += await backend.adoptProjectFolder(b.code, projectFolder(b)); } catch { /* not on desktop */ }
      try { files = await backend.listTree(projectFolder(b)); } catch { continue; }
      if (!files.length) continue;
      // ---- PDFs from SETENA: read what each one is and put it in its folder (every project, once per file) ----
      if (budget.left > 0) {
        const r = await sortDocuments(b, files, budget, getData().projects.filter(x => !x.noOpeningDate || x.setena));
        if (r.read || r.moved) {
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
      // with the portal's list of entries: what someone else wrote (developer, SETENA staff, another consultant)
      // is not the regente's bitácora nor his inspection
      const log = b.setenaLog ?? [];
      const othersFiles = new Set(log.filter(e => !isMine(b, e.author)).flatMap(e => e.files));
      const mineDates = new Set(log.filter(e => isMine(b, e.author)).map(e => e.date));
      for (const f of files) {
        const m = SETENA_FILE.exec(f.path);
        if (!m) continue;
        const others = othersFiles.has(f.path.split('/').pop()!);
        const ym = `${m[1]}-${m[2]}`, date = m[3];
        // an entry in a month = that month's bitácora filled in
        if (monthExists(b, ym) && !others) earliest(sBits, `m:${ym}`, date);
        // photos = that month's inspection (also a photo SETENA got as a PDF: read by its content, docSort)
        if (IMG.test(f.path) || b.docs?.[f.path.split('/').pop()!]?.kind === 'photo') { const k = inspectionKeyFor(b, ym); if (k && !others) earliest(sVisits, k, date); shots[date] = (shots[date] ?? 0) + 1; }
      }
      // entries with text only (no files) are in that month's notes: «SETENA dd/mm/yyyy: …»
      for (const [k, e] of Object.entries(b.deliveries ?? {})) {
        if (!k.startsWith('m:') || !e.notes) continue;
        for (const mm of e.notes.matchAll(/^SETENA (\d{2})\/(\d{2})\/(\d{4}):/gm)) {
          const date = `${mm[3]}-${mm[2]}-${mm[1]}`, ym = date.slice(0, 7);
          if (log.length && !mineDates.has(date)) continue; // only someone else wrote that day
          if (monthExists(b, ym)) earliest(sBits, `m:${ym}`, date);
        }
      }
      if (JSON.stringify(shots) !== JSON.stringify(b.setenaPhotos ?? {})) photoRecords.push({ id: b.id, shots });
      for (const x of sBits) if (!deliveryOf(b, x.key).uploaded) bits.push({ id: b.id, ...x });
      for (const x of sVisits) if (!deliveryOf(b, x.key).visit) visits.push({ id: b.id, key: x.key, date: x.date <= today ? x.date : today });
      // Regencia documents and notas de recibido, each to the closest Regencia (date: from the SETENA name, else the folder month)
      // regencias checked by an earlier version with a document that covers ANOTHER semester: uncheck them
      // (only when that check's date is exactly that document's date and no document covers this one)
      // what each regencia PDF of a day covers: a semester («r:…») or 'extra' (initial / extra report, never a semester)
      const docKeysOfDate = new Map<string, Set<string>>(), covered = new Set<string>();
      for (const [name, info] of Object.entries(b.docs ?? {})) {
        if (info.kind !== 'regencia') continue;
        const d0 = /^(\d{4}-\d{2}-\d{2})_/.exec(name)?.[1], k = regenciaKeyForPeriod(b, info.period);
        const v = k ?? (isExtraReport(b, info.period) ? 'extra' : null);
        if (d0 && v) { docKeysOfDate.set(d0, new Set([...(docKeysOfDate.get(d0) ?? []), v])); if (k) covered.add(k); }
      }
      const docKeyOfDate = (date: string) => { const s0 = docKeysOfDate.get(date); return s0 ? ([...s0].find(x => x !== 'extra') ?? 'extra') : undefined; };
      for (const [k, e] of Object.entries(b.deliveries ?? {})) {
        if (!k.startsWith('r:') || !e.uploaded) continue;
        const ks = docKeysOfDate.get(e.uploaded);
        // checked with that day's PDF, but that PDF covers another semester (or is the initial report), and no PDF covers this one
        if (ks && !ks.has(k) && !covered.has(k)) wrong.push({ id: b.id, key: k, date: e.uploaded });
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
          // an initial / extra report (its period is no semester) never checks a semester, nor does its receipt
          const per = m[3] === 'Regencias' ? b.docs?.[m[4]]?.period : undefined;
          const own = m[3] === 'Regencias' ? (regenciaKeyForPeriod(b, per) ?? (isExtraReport(b, per) ? 'extra' : undefined)) : docKeyOfDate(date);
          const key = own === 'extra' ? null : own || regenciaKeyNear(b, date);
          const map = m[3] === 'Regencias' ? regDocs : recDocs;
          if (key) map.set(key, [...(map.get(key) ?? []), date]);
        }
      }
      // regencias sent before «Firma del cliente» existed: signed on the date of the client's digital signature
      for (const [k, e] of Object.entries(b.deliveries ?? {})) {
        if (!k.startsWith('r:') || !e.uploaded) continue;
        const sig = Object.entries(b.docs ?? {}).find(([n, x]) => n.startsWith(`${e.uploaded}_`) && x.kind === 'regencia' && x.clientSigned)?.[1].clientSigned;
        // not signed yet → the PDF's date; signed ON the upload day (filled before the PDF's signature could be read)
        // and the PDF says the client signed earlier → its real date
        if (!e.signed) signFills.push({ id: b.id, key: k, date: sig && sig <= e.uploaded ? sig : e.uploaded, fromPdf: !!sig });
        else if (sig && e.signed === e.uploaded && sig < e.uploaded) signFills.push({ id: b.id, key: k, date: sig, fromPdf: true, fix: true });
      }
      // SETENA is the truth: a semester marked as uploaded on a day SETENA has no regencia for, while SETENA has the PDF
      // that covers that semester on another day → the dates of that PDF (marked by hand at the due date, or by
      // «marcar todo como hecho», before the PDFs were read)
      {
        const own = Object.entries(b.docs ?? {}).filter(([, x]) => x.kind === 'regencia' && !x.uploadedIn && !x.misfiled && !x.final);
        const readTo = (b.setena?.readAt ?? today).slice(0, 10);
        for (const [k, e] of Object.entries(b.deliveries ?? {})) {
          if (!k.startsWith('r:') || !e.uploaded || e.uploaded > readTo) continue;
          // backed: a regencia PDF that day for this semester (or whose period couldn't be read)
          if (own.some(([n, x]) => n.startsWith(`${e.uploaded}_`) && (!periodEnd(x.period) || regenciaKeyForPeriod(b, x.period) === k))) continue;
          const cand = own.filter(([n, x]) => regenciaKeyForPeriod(b, x.period) === k && n.slice(0, 10) <= readTo).sort(([a], [c]) => a.localeCompare(c))[0];
          if (!cand) continue;
          const date = cand[0].slice(0, 10), sig = cand[1].clientSigned && cand[1].clientSigned <= date ? cand[1].clientSigned : null;
          const rec = Object.keys(b.docs ?? {}).filter(n => b.docs![n].kind === 'receipt' && n.slice(0, 10) >= date && n.slice(0, 10) <= addDays(date, 45)).map(n => n.slice(0, 10)).sort()[0] ?? null;
          const recBacked = !!e.received && Object.keys(b.docs ?? {}).some(n => n.startsWith(`${e.received}_`) && b.docs![n].kind === 'receipt');
          setenaFixes.push({ id: b.id, key: k, from: e.uploaded, uploaded: date, signed: sig ?? (e.signed && e.signed <= date ? e.signed : date),
            received: recBacked ? e.received : rec ?? (e.received && e.received >= date ? e.received : null) });
        }
      }
      // a semester not handed in, whose Elaboración / Firma came from an initial / extra report (left by an older
      // version when that report was un-assigned): those dates are not this semester's
      {
        const extra = Object.entries(b.docs ?? {}).filter(([, x]) => x.kind === 'regencia' && isExtraReport(b, x.period));
        const marks = new Set(extra.flatMap(([n, x]) => [n.slice(0, 10), x.clientSigned].filter(Boolean) as string[]));
        for (const [k, e] of Object.entries(b.deliveries ?? {})) {
          if (!k.startsWith('r:') || e.uploaded) continue;
          if ((e.letter && marks.has(e.letter)) || (e.signed && marks.has(e.signed))) orphanFixes.push({ id: b.id, key: k, letter: !!e.letter && marks.has(e.letter), signed: !!e.signed && marks.has(e.signed) });
        }
      }
      // postponed semesters: the pending regencias after the last one handed in move like it did (only dates the
      // app set itself or never set; a date moved by hand stays)
      {
        const want = regenciaShift(b, addMonths(today, 24)), mine = new Set(b.shiftedDues ?? []);
        for (const [k, due] of Object.entries(want)) {
          const e = deliveryOf(b, `r:${k}`);
          if (e.uploaded || e.due === due || (e.due && !mine.has(k))) continue;
          dueFixes.push({ id: b.id, key: k, due });
        }
        for (const k of mine) if (!want[k] && !deliveryOf(b, `r:${k}`).uploaded && deliveryOf(b, `r:${k}`).due) dueFixes.push({ id: b.id, key: k, due: null });
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
    if (!visits.length && !regs.length && !starts.length && !places.length && !bits.length && !wrong.length && !signFills.length && !dueFixes.length && !orphanFixes.length && !setenaFixes.length)
      return [sorted && `${sorted} archivo(s) de SETENA ordenados en Fotos / Regencias`, docsMsg, tidyMsg, resignMsg, renamed.length && `nombre corregido desde su regencia: ${renamed.join(', ')}`, locatedByDoc.length && `ubicación tomada de las coordenadas de su regencia: ${locatedByDoc.join(', ')}`, adopted && `${adopted} archivo(s) de una carpeta con el nombre viejo del proyecto pasados a la actual`].filter(Boolean).join(' · ');
    mutate(d => {
      for (const v of visits) { const b = d.projects.find(x => x.id === v.id); if (b && !deliveryOf(b, v.key).visit) { applyStep(b, v.key, 'visit', v.date); applyStep(b, v.key, 'photos', v.date); } }
      for (const f of dueFixes) {
        const b = d.projects.find(x => x.id === f.id); if (!b) continue;
        b.deliveries = { ...(b.deliveries ?? {}), [`r:${f.key}`]: { ...deliveryOf(b, `r:${f.key}`), due: f.due } };
        const mine = new Set(b.shiftedDues ?? []);
        if (f.due) mine.add(f.key); else mine.delete(f.key);
        b.shiftedDues = [...mine];
      }
      for (const f of signFills) {
        const b = d.projects.find(x => x.id === f.id); if (!b) continue;
        const e = deliveryOf(b, f.key);
        if (e.uploaded && (!e.signed || (f.fix && e.signed === e.uploaded))) {
          applyStep(b, f.key, 'signed', f.date);
          // it can't have been elaborated after the client signed it
          if (deliveryOf(b, f.key).letter && deliveryOf(b, f.key).letter! > f.date) applyStep(b, f.key, 'letter', f.date);
        }
      }
      for (const w of wrong) {
        const b = d.projects.find(x => x.id === w.id);
        if (!b || deliveryOf(b, w.key).uploaded !== w.date) continue;
        // the steps that came from that same PDF: its date, or the client's signature date written in it
        const sig = Object.entries(b.docs ?? {}).find(([n, x]) => n.startsWith(`${w.date}_`) && x.clientSigned)?.[1].clientSigned;
        for (const st of ['uploaded', 'letter', 'signed', 'received'] as const) { const v = deliveryOf(b, w.key)[st]; if (v && (v === w.date || v === sig)) applyStep(b, w.key, st, null); }
        if (deliveryOf(b, w.key).due === w.date) b.deliveries![w.key] = { ...deliveryOf(b, w.key), due: null };
      }
      for (const f of setenaFixes) {
        const b = d.projects.find(x => x.id === f.id);
        if (!b || deliveryOf(b, f.key).uploaded !== f.from) continue;
        const e = deliveryOf(b, f.key);
        b.deliveries = b.deliveries ?? {};
        b.deliveries[f.key] = { ...e, uploaded: f.uploaded, signed: f.signed, letter: e.letter && e.letter <= f.signed ? e.letter : f.signed, received: f.received };
        if (!b.regencias.includes(f.key.slice(2))) b.regencias = [...b.regencias, f.key.slice(2)].sort();
      }
      for (const o of orphanFixes) {
        const b = d.projects.find(x => x.id === o.id);
        if (!b || deliveryOf(b, o.key).uploaded) continue;
        if (o.signed) applyStep(b, o.key, 'signed', null);
        if (o.letter) applyStep(b, o.key, 'letter', null);
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
    return [docsMsg, sorted && `${sorted} archivo(s) de SETENA ordenados`, bits.length && `${bits.length} bitácora(s) marcadas por SETENA`, visits.length && `${visits.length} inspección(es) marcadas por sus fotos`, regs.length && `${regs.length} regencia(s) / nota(s) de recibido marcadas`, signFills.some(f => f.fromPdf) && `${signFills.filter(f => f.fromPdf).length} firma(s) del cliente leídas de las regencias`, dueFixes.some(f => f.due) && `${new Set(dueFixes.filter(f => f.due).map(f => f.id)).size} proyecto(s) con las regencias pendientes en su fecha nueva (semestres corridos, según el periodo de sus PDF)`, wrong.length && `${wrong.length} regencia(s) que estaban en el semestre equivocado corregidas (según el periodo de su PDF)`, setenaFixes.length && `${setenaFixes.length} regencia(s) con la fecha de SETENA (${[...new Set(setenaFixes.map(f => getData().projects.find(x => x.id === f.id)?.code))].join(', ')})`,
      starts.length && `${starts.length} carta(s) de inicio`, places.length && `ubicación de ${places.length} proyecto(s) tomada del GPS`, tidyMsg, resignMsg, renamed.length && `nombre corregido desde su regencia: ${renamed.join(', ')}`, locatedByDoc.length && `ubicación tomada de las coordenadas de su regencia: ${locatedByDoc.join(', ')}`, adopted && `${adopted} archivo(s) de una carpeta con el nombre viejo del proyecto pasados a la actual`].filter(Boolean).join(' · ');
  } finally { busy = false; }
}
