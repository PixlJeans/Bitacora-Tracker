// ===== Where each file is saved on disk (inside the data folder) =====
//   Proyectos/<Código - Nombre>/Inicio de obras/
//   Proyectos/<Código - Nombre>/<Año>/<MM - Mes>/Fotos/        ← photos of that month's Inspección
//   Proyectos/<Código - Nombre>/<Año>/<MM - Mes>/Regencias/    ← the Regencia documents (Word / PDF)
import type { Project } from './types';
import { inspectionDate, regenciaDue } from './schedule';

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** Same cleaning as the desktop app does on disk (folder_name in lib.rs): no \\ / : * ? " < > | */
export const cleanName = (s: string) => {
  const c = s.replace(/[\u0000-\u001f\\/:*?"<>|]/g, '-').trim().replace(/^\.+|\.+$/g, '').trim();
  return c ? [...c].slice(0, 120).join('') : 'Sin nombre';
};

export const projectFolder = (b: Pick<Project, 'code' | 'name'>) => `Proyectos/${cleanName(`${b.code} - ${b.name}`)}`;

/** Folder of one month of a project (by date), e.g. «…/2026/11 - Noviembre/Documentos». */
export const monthFolderOf = (b: Pick<Project, 'code' | 'name'>, ym: string, sub: 'Fotos' | 'Regencias' | 'Documentos' | 'SETENA') => `${projectFolder(b)}/${monthFolder(ym)}/${sub}`;

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

/** Folder part of a saved path ('a/b/c.jpg' → 'a/b'). */
export const folderOf = (path: string) => path.split('/').slice(0, -1).join('/');
