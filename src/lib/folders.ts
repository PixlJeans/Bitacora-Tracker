// ===== Where each file is saved on disk (inside the data folder) =====
//   Proyectos/<Código - Nombre>/Inicio de obras/
//   Proyectos/<Código - Nombre>/<Año>/<MM - Mes>/Fotos/        ← photos of that month's Inspección
//   Proyectos/<Código - Nombre>/<Año>/<MM - Mes>/Regencias/    ← the Regencia documents (Word / PDF)
import type { Project } from './types';

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** Same cleaning as the desktop app does on disk (folder_name in lib.rs): no \\ / : * ? " < > | */
export const cleanName = (s: string) => {
  const c = s.replace(/[\u0000-\u001f\\/:*?"<>|]/g, '-').trim().replace(/^\.+|\.+$/g, '').trim();
  return c ? [...c].slice(0, 120).join('') : 'Sin nombre';
};

export const projectFolder = (b: Pick<Project, 'code' | 'name'>) => `Proyectos/${cleanName(`${b.code} - ${b.name}`)}`;

const monthFolder = (ym: string) => {
  const [y, m] = ym.split('-');
  return `${y}/${m} - ${MONTHS[Number(m) - 1]}`;
};

/** Folder of a delivery's files: 'm:YYYY-MM' → Fotos, 'r:YYYY-MM-DD' → Regencias, 's:start' → Inicio de obras. */
export function deliveryFolder(b: Pick<Project, 'code' | 'name'>, key: string): string {
  if (key.startsWith('m:')) return `${projectFolder(b)}/${monthFolder(key.slice(2, 9))}/Fotos`;
  if (key.startsWith('r:')) return `${projectFolder(b)}/${monthFolder(key.slice(2, 9))}/Regencias`;
  return `${projectFolder(b)}/Inicio de obras`;
}

/** Folder part of a saved path ('a/b/c.jpg' → 'a/b'). */
export const folderOf = (path: string) => path.split('/').slice(0, -1).join('/');
