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
export const docReader = {
  async text(path: string): Promise<string> {
    const { textFromPdf } = await import('./pdf');
    return textFromPdf(b64ToBuf(await backend.readB64(path)), 2);
  }
};

export interface SortResult { read: number; moved: number; kinds: Record<string, number> }

/** Reads and places the new SETENA PDFs of one project. `files` = its tree (paths relative to the data folder). */
export async function sortDocuments(b: Project, files: { path: string }[], budget = { left: MAX_PER_RUN }): Promise<SortResult> {
  const res: SortResult = { read: 0, moved: 0, kinds: {} };
  const known = b.docs ?? {};
  const found: Record<string, DocInfo & { placed: boolean }> = {};
  const unchecks: { key: string; step: 'uploaded' | 'received'; date: string }[] = [];
  for (const f of files) {
    const m = SETENA_PDF.exec(f.path);
    if (!m || known[m[3]]) continue;
    if (budget.left <= 0) break;
    budget.left--;
    const [, month, sub, name, date] = m;
    let info: DocInfo;
    try { info = classifyDoc(await docReader.text(f.path), b.code); } catch { info = { kind: 'notext' }; }
    res.read++;
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
  if (res.read) {
    mutate(d => {
      const x = d.projects.find(y => y.id === b.id);
      if (!x) return;
      x.docs = { ...(x.docs ?? {}), ...found };
      for (const u of unchecks) {
        if (deliveryOf(x, u.key)[u.step] !== u.date) continue;
        applyStep(x, u.key, u.step, null);
        if (u.step === 'uploaded') {
          // it was also marked «elaborada» and moved to that date by the same file
          if (deliveryOf(x, u.key).letter === u.date) applyStep(x, u.key, 'letter', null);
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
