// ===== What the SETENA portal says about each project, in plain words =====
import type { AppData, Project } from './types';
import { isActiveProject } from './types';
import { fromISO } from './dates';

const DAY = 864e5;
export const daysSince = (iso: string, today: string) => Math.round((fromISO(today).getTime() - fromISO(iso).getTime()) / DAY);

/** «hace 3 días» / «hace 5 meses» / «hace 2 años». */
export function agoText(iso: string, today: string): string {
  const d = daysSince(iso, today);
  if (d <= 0) return 'hoy';
  if (d === 1) return 'ayer';
  if (d < 45) return `hace ${d} días`;
  if (d < 730) return `hace ${Math.round(d / 30.4)} meses`;
  return `hace ${Math.floor(d / 365)} años`;
}

/** Active projects with no SETENA entry for more than `days` days (or never), oldest first.
 *  Not counted: projects whose participation is closed. */
export function quietInSetena(d: AppData, today: string, days = 35): { b: Project; last: string | null }[] {
  return d.projects
    .filter(b => !b.archived && b.setena && isActiveProject(b) && b.status === 'open' && !b.setena.participationClosed)
    .map(b => ({ b, last: b.setena!.lastEntry }))
    .filter(x => !x.last || daysSince(x.last, today) > days)
    .sort((a, c) => (a.last ?? '').localeCompare(c.last ?? ''));
}
