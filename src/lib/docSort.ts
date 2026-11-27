// ===== Sorts the PDFs downloaded from SETENA by what they ARE (read from their first page) =====
// Each PDF named «YYYY-MM-DD_…pdf» (the names the SETENA download gives) is read once; the result is kept in the
// project (`docs`), so it is never read or moved again — if you move it by hand afterwards, your choice stays.
//   regencia → Regencias · nota de recibido → Notas de recibido · comunicado → Comunicados SETENA · carta → Cartas
//   regencia of another project, other document, scan without text → Documentos (not counted as a regencia)
// A regencia / nota de recibido that was checked ONLY because of a file that turned out to be something else is
// unchecked (the same date as that file); the scanner then re-checks it if a real one is there.
import type { Project } from './types';
import { backend } from './backend';
import { mutate, applyStep, deliveryOf } from './store';
import { classifyDoc, KIND_FOLDER, type DocInfo } from './docKind';
import { regenciaKeyNear } from './folders';

/** A PDF from the SETENA download, inside a month folder: …/<Año>/<MM - Mes>/<carpeta>/<YYYY-MM-DD>_<…>.pdf */
const SETENA_PDF = /^(.*\/\d{4}\/\d{2} - [^/]+)\/(SETENA|Regencias|Notas de recibido|Documentos|Comunicados SETENA|Cartas)\/((\d{4}-\d{2}-\d{2})_[^/]+\.pdf)$/i;
const MAX_PER_RUN = 30; // reading PDFs takes a moment: the rest continue on the next scan

function b64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}

/** Text of the first pages of a PDF of the data folder (replaceable in tests). */
import { signatureLines } from './pdfSig';

export const docReader = {
  async text(path: string): Promise<string> {
    const { textFromPdf } = await import('./pdf');
    const buf = b64ToBuf(await backend.readB64(path));
    // the digital signatures are not in the page text: read them from the file first (pdf.js may take the buffer)
    const sigs = signatureLines(buf);
    return `${await textFromPdf(buf.slice(0), 2)}${sigs ? `\n\n${sigs}` : ''}`;
  }
};

export interface SortResult { read: number; moved: number; kinds: Record<string, number>; renamed?: string; located?: boolean }

/** A project name that is really an error the SETENA page showed («Problema al consultar información…»), or empty. */
/** PDFs that could not be opened in this session (not retried until the app restarts). */
const failedThisSession = new Set<string>();

export const isBrokenName = (b: Pick<Project, 'code' | 'name'>) =>
  !b.name.trim() || b.name.trim().toUpperCase() === b.code.toUpperCase() || /problema al consultar|remote server|error al|no se pudo/i.test(b.name);

/** Reads and places the new SETENA PDFs of one project. `files` = its tree (paths relative to the data folder). */
export async function sortDocuments(b: Project, files: { path: string }[], budget = { left: MAX_PER_RUN }): Promise<SortResult> {
  const res: SortResult = { read: 0, moved: 0, kinds: {} };
  const known = b.docs ?? {};
  const found: Record<string, DocInfo & { placed: boolean }> = {};
  const unchecks: { key: string; step: 'uploaded' | 'received'; date: string }[] = [];
  // a broken name is fixed from the cover of one of its regencias (read again if it was read before this existed)
  let needName = isBrokenName(b);
  let newName: string | null = null;
  // a project without a location takes it from its regencia's «Coordenadas» (same: read again if needed)
  let needPlace = !b.location;
  let place: { lat: number; lng: number; text: string } | null = null;
  if (needPlace) {
    const withLl = Object.entries(known).filter(([, x]) => x.kind === 'regencia' && x.lat !== undefined && x.lng !== undefined).sort(([a], [c]) => c.localeCompare(a))[0];
    if (withLl) { place = { lat: withLl[1].lat!, lng: withLl[1].lng!, text: withLl[1].place ?? '' }; needPlace = false; }
  }
  // already read with its name: no need to open anything
  if (needName) {
    const named = Object.entries(known).filter(([, x]) => x.kind === 'regencia' && x.project).sort(([a], [c]) => c.localeCompare(a))[0];
    if (named) { newName = named[1].project!; needName = false; }
  }
  const newest = [...files].sort((a, c) => c.path.localeCompare(a.path));
  for (const f of needName || needPlace ? newest : files) {
    const m = SETENA_PDF.exec(f.path);
    if (!m) continue;
    const k = known[m[3]];
    // read again (once) a regencia read by an older version: for the name, the place or the client's signature
    const reread = !!k && k.kind === 'regencia' && ((needName && !k.project) || (needPlace && k.lat === undefined && !k.noPlace)
      || (!k.clientSigned && !k.regenteSigned && (k.sigV ?? 0) < 2));
    if (k && !reread) continue;
    if (failedThisSession.has(f.path)) continue;
    if (budget.left <= 0) break;
    budget.left--;
    const [, month, sub, name, date] = m;
    let info: DocInfo;
    // a file that can't be opened right now (OneDrive still downloading it, open in another program…) is NOT a scan
    // without text: nothing is changed, moved or unchecked, and it is tried again in a later session
    try { info = classifyDoc(await docReader.text(f.path), b.code); } catch { failedThisSession.add(f.path); continue; }
    res.read++;
    if (needName && info.kind === 'regencia' && info.project) { newName = info.project; needName = false; }
    if (needPlace && info.kind === 'regencia' && info.lat !== undefined && info.lng !== undefined) { place = { lat: info.lat, lng: info.lng, text: info.place ?? '' }; needPlace = false; }
    if (k) { found[m[3]] = { ...k, ...info, placed: k.placed }; continue; } // read again only for the name / place
    res.kinds[info.kind] = (res.kinds[info.kind] ?? 0) + 1;
    const to = KIND_FOLDER[info.kind] ?? 'Documentos';
    if (to !== sub) {
      try { await backend.moveAttachment(f.path, `${month}/${to}`); res.moved++; } catch { /* in use: it stays, and it is not read again */ }
      // it was taken as a regencia / receipt because of its folder: undo that check if it came from this file
      const key = regenciaKeyNear(b, date);
      if (key && sub === 'Regencias' && info.kind !== 'regencia' && deliveryOf(b, key).uploaded === date) unchecks.push({ key, step: 'uploaded', date });
      if (key && sub === 'Notas de recibido' && info.kind !== 'receipt' && deliveryOf(b, key).received === date) unchecks.push({ key, step: 'received', date });
    }
    found[name] = { ...info, placed: true };
  }
  if (res.read || newName || place) {
    mutate(d => {
      const x = d.projects.find(y => y.id === b.id);
      if (!x) return;
      x.docs = { ...(x.docs ?? {}), ...found };
      if (newName && isBrokenName(x)) { x.name = newName; res.renamed = newName; }
      if (place && !x.location) { x.location = { ...place, source: 'regencia' }; res.located = true; }
      for (const u of unchecks) {
        if (deliveryOf(x, u.key)[u.step] !== u.date) continue;
        applyStep(x, u.key, u.step, null);
        if (u.step === 'uploaded') {
          // it was also marked «elaborada» and moved to that date by the same file
          if (deliveryOf(x, u.key).letter === u.date) applyStep(x, u.key, 'letter', null);
          if (deliveryOf(x, u.key).signed === u.date) applyStep(x, u.key, 'signed', null);
          if (deliveryOf(x, u.key).due === u.date) x.deliveries![u.key] = { ...deliveryOf(x, u.key), due: null };
        }
      }
    }, { undo: false });
  }
  return res;
}

/** The regencia documents (IRA code and period) known for a folder's files, e.g. for a Regencia card. */
export function regenciaLabels(b: Project, names: string[]): string[] {
  return names.map(n => b.docs?.[n]).filter((x): x is NonNullable<typeof x> => !!x && x.kind === 'regencia' && !!x.ira)
    .map(x => `${x.final ? 'Final ' : ''}${x.ira}${x.period ? ` (${x.period})` : ''}`);
}
