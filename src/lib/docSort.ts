// ===== Sorts the PDFs downloaded from SETENA by what they ARE (read from their first page) =====
// Each PDF named «YYYY-MM-DD_…pdf» (the names the SETENA download gives) is read once; the result is kept in the
// project (`docs`). Its CONTENT decides its folder, also later (v68: a file the app had put in the wrong folder,
// e.g. a second copy of a regencia taken for a receipt, goes to the right one):
//   regencia → Regencias · nota de recibido → Notas de recibido · comunicado → Comunicados SETENA · carta → Cartas
//   garantía ambiental (bond, transfer to the guarantees account, renewal letter) → Garantía ambiental
//   photo saved as PDF → Fotos · other document / unreadable scan → Documentos
//   regencia of ANOTHER project we follow → that project's folder (its Regencias, or «Regencias en otra bitácora»
//   when its own SETENA bitácora doesn't have it: then it is a warning, not a done regencia)
// Scans without text are read with OCR (ocr.ts); Word files saved with a .pdf name are read as Word (docx.ts).
// A regencia / nota de recibido that was checked ONLY because of a file that turned out to be something else is
// unchecked (the same date as that file); the scanner then re-checks it if a real one is there.
import type { Project } from './types';
import { backend } from './backend';
import { mutate, applyStep, deliveryOf } from './store';
import { classifyDoc, KIND_FOLDER, type DocInfo } from './docKind';
import { regenciaKeyNear, monthFolderOf } from './folders';

/** A PDF from the SETENA download, inside a month folder: …/<Año>/<MM - Mes>/<carpeta>/<YYYY-MM-DD>_<…>.pdf */
const SETENA_PDF = /^(.*\/\d{4}\/\d{2} - [^/]+)\/(SETENA|Regencias|Notas de recibido|Documentos|Comunicados SETENA|Cartas|Garantía ambiental|Fotos|Regencias en otra bitácora)\/((\d{4}-\d{2}-\d{2})_[^/]+\.pdf)$/i;
const MAX_PER_RUN = 30; // reading PDFs takes a moment: the rest continue on the next scan
const OCR_PER_RUN = 5;  // OCR is slower (seconds per page): a few per scan
export const MISFILED_FOLDER = 'Regencias en otra bitácora';
/** The folder a document belongs in, by what it is. */
export const folderFor = (x: Pick<DocInfo, 'kind' | 'misfiled'>) => x.misfiled ? MISFILED_FOLDER : KIND_FOLDER[x.kind];
const codeKey = (c: string) => c.toUpperCase().replace(/\s/g, '');
const sameRegencia = (a: DocInfo, c: DocInfo) => a.kind === 'regencia' && ((!!a.ira && a.ira === c.ira) || (!!a.period && a.period === c.period));

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
    // a Word file saved by SETENA with a «.pdf» name
    const { isZip, docxText } = await import('./docx');
    if (isZip(buf)) return docxText(buf);
    // the digital signatures are not in the page text: read them from the file first (pdf.js may take the buffer)
    const sigs = signatureLines(buf);
    return `${await textFromPdf(buf.slice(0), 2)}${sigs ? `\n\n${sigs}` : ''}`;
  },
  /** OCR of a scanned PDF's first page (null = this reader can't do OCR here). */
  async ocr(path: string): Promise<{ text: string; photo: boolean } | null> {
    if (typeof document === 'undefined') return null;
    const { ocrPdf } = await import('./ocr');
    return ocrPdf(b64ToBuf(await backend.readB64(path)));
  }
};

export interface SortResult { read: number; moved: number; kinds: Record<string, number>; renamed?: string; located?: boolean }

/** A project name that is really an error the SETENA page showed («Problema al consultar información…»), or empty. */
/** PDFs that could not be opened in this session (not retried until the app restarts). */
const failedThisSession = new Set<string>();

export const isBrokenName = (b: Pick<Project, 'code' | 'name'>) =>
  !b.name.trim() || b.name.trim().toUpperCase() === b.code.toUpperCase() || /problema al consultar|remote server|error al|no se pudo/i.test(b.name);

/** Reads and places the new SETENA PDFs of one project. `files` = its tree (paths relative to the data folder). */
export async function sortDocuments(b: Project, files: { path: string }[], budget: { left: number; ocr?: number } = { left: MAX_PER_RUN }, all: Project[] = []): Promise<SortResult> {
  const res: SortResult = { read: 0, moved: 0, kinds: {} };
  const known = b.docs ?? {};
  const found: Record<string, DocInfo & { placed: boolean }> = {};
  const unchecks: { key: string; step: 'uploaded' | 'received'; date: string }[] = [];
  const pending: (() => Promise<void>)[] = [];
  const movedIn: { id: string; name: string; info: DocInfo & { placed: boolean } }[] = [];
  // a broken name is fixed from the cover of one of its regencias (read again if it was read before this existed)
  let needName = isBrokenName(b);
  let newName: string | null = null;
  // a project without a location takes it from its regencia's «Coordenadas» (same: read again if needed)
  let needPlace = !b.location;
  let placeLl: { lat: number; lng: number; text: string } | null = null;
  if (needPlace) {
    const withLl = Object.entries(known).filter(([, x]) => x.kind === 'regencia' && x.lat !== undefined && x.lng !== undefined).sort(([a], [c]) => c.localeCompare(a))[0];
    if (withLl) { placeLl = { lat: withLl[1].lat!, lng: withLl[1].lng!, text: withLl[1].place ?? '' }; needPlace = false; }
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
    // a scan read before OCR existed: read it again with OCR (it may be placed anew)
    const rescan = !!k && k.kind === 'notext' && !k.ocr && (budget.ocr ?? OCR_PER_RUN) > 0;
    if (k && !reread && !rescan) { relocate(f.path, m, k); continue; }
    if (failedThisSession.has(f.path)) continue;
    if (budget.left <= 0) break;
    budget.left--;
    const name = m[3];
    let info: DocInfo;
    // a file that can't be opened right now (OneDrive still downloading it, open in another program…) is NOT a scan
    // without text: nothing is changed, moved or unchecked, and it is tried again in a later session
    try {
      info = classifyDoc(await docReader.text(f.path), b.code);
      // no text inside: a scan or a photo → OCR (a few per scan; the rest wait, as «sin texto», for the next one)
      if (info.kind === 'notext' && (budget.ocr ?? OCR_PER_RUN) > 0) {
        budget.ocr = (budget.ocr ?? OCR_PER_RUN) - 1;
        const o = await docReader.ocr(f.path);
        if (o) {
          info = o.photo ? { kind: 'photo' } : classifyDoc(o.text, b.code);
          // OCR misreads digits: «another project» only when its number is exactly one we follow
          if (info.kind === 'foreign' && !all.some(x => info.expediente && codeKey(x.code) === codeKey(info.expediente))) info = { ...info, kind: 'regencia', expediente: undefined };
          info = { ...info, ocr: 1 };
        }
      }
    } catch { failedThisSession.add(f.path); continue; }
    res.read++;
    if (needName && info.kind === 'regencia' && info.project) { newName = info.project; needName = false; }
    if (needPlace && info.kind === 'regencia' && info.lat !== undefined && info.lng !== undefined) { placeLl = { lat: info.lat, lng: info.lng, text: info.place ?? '' }; needPlace = false; }
    if (k && !rescan) { found[m[3]] = { ...k, ...info, kind: k.kind, placed: k.placed }; relocate(f.path, m, found[m[3]]); continue; } // read again only for the name / place / signatures
    if (k && rescan && info.kind === 'notext') { found[name] = { ...k, ocr: 1 }; continue; } // OCR found nothing either
    res.kinds[info.kind] = (res.kinds[info.kind] ?? 0) + 1;
    found[name] = { ...info, placed: true };
    await place(f.path, m, found[name]);
  }

  /** Puts a file where its content says (another project's regencia: in that project). */
  async function place(path: string, m: RegExpExecArray, info: DocInfo & { placed: boolean }) {
    const [, month, sub, name, date] = m;
    if (info.kind === 'foreign') {
      const other = all.find(x => x.id !== b.id && info.expediente && codeKey(x.code) === codeKey(info.expediente));
      if (!other) { if (sub !== 'Documentos') await moveTo(path, `${month}/Documentos`, sub, info, date); return; }
      const own = Object.entries(other.docs ?? {}).some(([n, x]) => n !== name && !x.uploadedIn && sameRegencia(x, info));
      const ym = date.slice(0, 7);
      const target = monthFolderOf(other, ym, own ? 'Regencias' : MISFILED_FOLDER);
      try {
        await backend.moveAttachment(path, target); res.moved++;
        found[name] = { kind: 'foreign', expediente: info.expediente, movedTo: other.code, placed: true };
        movedIn.push({ id: other.id, name, info: { ...info, kind: 'regencia', uploadedIn: b.code, misfiled: own ? undefined : true, placed: true } });
        maybeUncheck(sub, 'foreign', date);
      } catch { /* in use: next scan */ }
      return;
    }
    const to = folderFor(info) ?? (sub === 'SETENA' ? 'Documentos' : null);
    if (to && to !== sub) await moveTo(path, `${month}/${to}`, sub, info, date);
  }
  async function moveTo(path: string, folder: string, sub: string, info: DocInfo, date: string) {
    try { await backend.moveAttachment(path, folder); res.moved++; } catch { return; /* in use: it stays */ }
    maybeUncheck(sub, info.kind, date);
  }
  /** It was taken as a regencia / receipt because of its folder: undo that check if it came from this file. */
  function maybeUncheck(sub: string, kind: string, date: string) {
    const key = regenciaKeyNear(b, date);
    if (key && sub === 'Regencias' && kind !== 'regencia' && deliveryOf(b, key).uploaded === date) unchecks.push({ key, step: 'uploaded', date });
    if (key && sub === 'Notas de recibido' && kind !== 'receipt' && deliveryOf(b, key).received === date) unchecks.push({ key, step: 'received', date });
  }
  /** A file read before, in a folder that doesn't match what it is: moved (content wins), without reading it again. */
  function relocate(path: string, m: RegExpExecArray, k: DocInfo & { placed: boolean }) {
    if (k.movedTo) return;
    const want = k.kind === 'foreign' ? (all.some(x => x.id !== b.id && k.expediente && codeKey(x.code) === codeKey(k.expediente)) ? 'elsewhere' : 'Documentos') : folderFor(k);
    if (want && want !== m[2]) pending.push(() => place(path, m, k));
  }
  for (const go of pending) await go();
  if (res.read || newName || placeLl || res.moved || Object.keys(found).length) {
    mutate(d => {
      for (const mi of movedIn) { const o = d.projects.find(y => y.id === mi.id); if (o) o.docs = { ...(o.docs ?? {}), [mi.name]: mi.info }; }
      const x = d.projects.find(y => y.id === b.id);
      if (!x) return;
      x.docs = { ...(x.docs ?? {}), ...found };
      if (newName && isBrokenName(x)) { x.name = newName; res.renamed = newName; }
      if (placeLl && !x.location) { x.location = { ...placeLl, source: 'regencia' }; res.located = true; }
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
