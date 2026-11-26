// ===== Project search =====
// Fixes the previous search box, which:
//  · compared accents/case as-is («urbanizacion» didn't find «URBANIZACIÓN»),
//  · didn't search the status nor accept the code without dashes or zeros («D1 170 2020»),
//  · and was silently combined with other filters (calendar day, status, color, «Pendientes»),
//    so existing projects seemed to be missing.
// Now every search word must appear in some field, ignoring accents, case and dashes.
import type { Project, AppData } from './types';
import { statusName } from './types';

export const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim();

/** Variants of the code so it matches however it is typed. */
function codeVariants(code: string): string[] {
  const n = normalize(code);
  const noZeros = n.replace(/-0+(\d)/g, '-$1');             // d1-170-2020
  return [n, n.replace(/-/g, ''), n.replace(/-/g, ' '), noZeros, noZeros.replace(/-/g, ' '), noZeros.replace(/-/g, '')];
}

export function searchableText(d: AppData, b: Project): string {
  const et = d.labels.find(e => e.id === b.labelId)?.name ?? '';
  return normalize([...codeVariants(b.code), b.name, statusName(b.status), b.status, et, b.archived ? 'archived' : '', b.notes].join(' | '));
}

/** true if the project matches ALL the words of the query. */
export function matches(d: AppData, b: Project, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  const has = searchableText(d, b);
  if (has.includes(q)) return true;
  const tokens = q.split(' ').filter(Boolean);
  return tokens.every(t => has.includes(t) || has.includes(t.replace(/-/g, '')) || has.includes(t.replace(/^0+/, '')));
}

export const checkForUpdate = (d: AppData, query: string) => d.projects.filter(b => matches(d, b, query));
