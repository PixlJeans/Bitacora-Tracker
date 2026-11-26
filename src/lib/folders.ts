// ===== Where each file is saved on disk (inside the data folder) =====
//   Proyectos/<Código - Nombre>/Inicio de obras/
//   Proyectos/<Código - Nombre>/<Año>/<MM - Mes>/Fotos/        ← photos of that month's Inspección
//   Proyectos/<Código - Nombre>/<Año>/<MM - Mes>/Regencias/    ← the Regencia documents (Word / PDF)
//   Proyectos/<Código - Nombre>/<Año>/<MM - Mes>/Notas de recibido/ ← the receipt SETENA sends for a Regencia
import type { Project } from './types';
import { inspectionDate, regenciaDue, regenciaDueDates, hasSchedule } from './schedule';
import { addMonths, fromISO } from './dates';

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** Same cleaning as the desktop app does on disk (folder_name in lib.rs): no \\ / : * ? " < > | */
export const cleanName = (s: string) => {
  const c = s.replace(/[\u0000-\u001f\\/:*?"<>|]/g, '-').trim().replace(/^\.+|\.+$/g, '').trim();
  return c ? [...c].slice(0, 120).join('') : 'Sin nombre';
};

export const projectFolder = (b: Pick<Project, 'code' | 'name'>) => `Proyectos/${cleanName(`${b.code} - ${b.name}`)}`;

/** Regencia whose (possibly moved) date falls in month `ym`, if any. */
export function regenciaKeyFor(b: Project, ym: string): string | null {
  const k = regenciaDueDates(b, b.openedOn, addMonths(`${ym}-01`, 7)).find(x => regenciaDue(b, x).slice(0, 7) === ym);
  return k ? `r:${k}` : null;
}

/** Regencia closest in time to `date` (within 6 months): a regencia is often uploaded a few months before or after
 *  its due date, so its document is matched to the nearest one. */
export function regenciaKeyNear(b: Project, date: string): string | null {
  const t = fromISO(date).getTime();
  let best: string | null = null, bestD = 184 * 864e5;
  for (const k of regenciaDueDates(b, b.openedOn, addMonths(date, 13))) {
    const d = Math.abs(fromISO(regenciaDue(b, k)).getTime() - t);
    if (d <= bestD) { best = k; bestD = d; }
  }
  return best ? `r:${best}` : null;
}

const IMG = /\.(jpe?g|png|gif|webp|heic|heif)$/i;
/** Where a file from SETENA goes, by the month of its entry (no guessing):
 *  photos → that month's Fotos · documents (PDF / Word) → that month's Regencias, or its «Notas de recibido» when
 *  `receipt` (a later document of the same day: SETENA's receipt of the regencia posted just before).
 *  While the project has no opening date: the month's SETENA folder. */
export function setenaTarget(b: Project, ym: string, name: string, receipt = false): string {
  if (!hasSchedule(b)) return monthFolderOf(b, ym, 'SETENA');
  return monthFolderOf(b, ym, IMG.test(name) ? 'Fotos' : receipt ? 'Notas de recibido' : 'Regencias');
}
export const isImage = (name: string) => IMG.test(name);

/** Folder of one month of a project (by date), e.g. «…/2026/11 - Noviembre/Documentos». */
export const monthFolderOf = (b: Pick<Project, 'code' | 'name'>, ym: string, sub: 'Fotos' | 'Regencias' | 'Notas de recibido' | 'Documentos' | 'SETENA') => `${projectFolder(b)}/${monthFolder(ym)}/${sub}`;

const monthFolder = (ym: string) => {
  const [y, m] = ym.split('-');
  return `${y}/${m} - ${MONTHS[Number(m) - 1]}`;
};

/** Folder of a delivery's files, in the month of its (possibly moved) date:
 *  'm:YYYY-MM' → <month of the inspection>/Fotos · 'r:YYYY-MM-DD' → <month of the Regencia>/Regencias · 's:start' → Inicio de obras. */
export function deliveryFolder(b: Project, key: string): string {
  if (key.startsWith('m:')) return `${projectFolder(b)}/${monthFolder(inspectionDate(b, key.slice(2)).slice(0, 7))}/Fotos`;
  if (key.startsWith('r:')) return `${projectFolder(b)}/${monthFolder(regenciaDue(b, key.slice(2)).slice(0, 7))}/Regencias`;
  return `${projectFolder(b)}/Inicio de obras`;
}

/** Folder of a Regencia's «nota de recibido» (the document SETENA sends back), next to its Regencias folder. */
export const receiptFolder = (b: Project, key: string) => deliveryFolder(b, key).replace(/\/Regencias$/, '/Notas de recibido');

/** Folder part of a saved path ('a/b/c.jpg' → 'a/b'). */
export const folderOf = (path: string) => path.split('/').slice(0, -1).join('/');
