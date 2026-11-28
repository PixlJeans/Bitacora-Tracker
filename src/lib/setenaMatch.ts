// ===== Every SETENA entry ↔ what the app tracks, 1 to 1 (v70) =====
// Each entry of the project's SETENA bitácora is matched with the app's item it proves:
//   an entry by the regente               → that month's «Llenado de bitácora»
//   …with photos                          → that month's «Inspección»
//   …with a regencia PDF                  → that semester's regencia «Subida» (or the closing report, or an extra report)
//   SETENA's receipt                      → the regencia's «Nota de recibido»
//   guarantee / SETENA notice / letter    → shown as what it is
//   an entry by someone else (developer, SETENA staff, another consultant) → NOT the regente's bitácora
// and the other way: what the app has as done that SETENA doesn't show («solo en la app»).
// With the portal's list of entries (`setenaLog`, from «Descargar de SETENA») it is exact; before that, the entries
// are rebuilt from what was saved (month notes «SETENA dd/mm/yyyy: …», the SETENA photos and PDFs by date).
import type { Project } from './types';
import { isActiveProject, statusName } from './types';
import type { DocKind } from './docKind';
import { deliveryOf } from './store';
import { monthExists, inspectionKeyFor } from './schedule';
import { closureOf } from './closure';
import { isExtraReport, regenciaKeyForPeriod } from './folders';

export interface SetenaLink { label: string; key?: string; ok: boolean }
export interface SetenaItem {
  date: string; time?: number | null; author: string; mine: boolean; text: string;
  photos: number; docs: { name: string; kind: DocKind | 'unread'; label: string }[];
  links: SetenaLink[]; exact: boolean;
}
export interface AppOnly { key: string; date: string; label: string }

const REGENTE = /JIM[EÉ]NEZ\s+(?:JIM[EÉ]NEZ\s+)?P[EÉ]REZ/i;
const IMG = /\.(jpe?g|png|gif|webp|heic|bmp)$/i;
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const monthLabel = (mk: string) => `${MONTHS[+mk.slice(5, 7) - 1]} ${mk.slice(0, 4)}`;
const addDaysISO = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const d3 = (iso: string) => `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(2, 4)}`;

/** Whether an entry's author is the regente (or the author is unknown). */
export function isMine(b: Project, author: string): boolean {
  if (!author.trim()) return true;
  if (REGENTE.test(author)) return true;
  const me = (b.setena?.people ?? [])[0]?.replace(/\s*\(.*$/, '').trim().toUpperCase();
  return !!me && author.trim().toUpperCase() === me;
}

/** The project's SETENA entries (newest first). */
export function setenaItems(b: Project): SetenaItem[] {
  const raw: { date: string; time?: number | null; author: string; text: string; files: string[]; photos?: number; exact: boolean }[] = [];
  if (b.setenaLog?.length) {
    for (const e of b.setenaLog) raw.push({ ...e, exact: true });
  } else {
    // rebuilt by date: texts from the month notes, photos counted per date, PDFs by their date-named files
    const byDate = new Map<string, { texts: string[]; files: string[]; photos: number }>();
    const at = (d: string) => byDate.get(d) ?? (byDate.set(d, { texts: [], files: [], photos: 0 }), byDate.get(d)!);
    for (const [k, e] of Object.entries(b.deliveries ?? {})) {
      if (!k.startsWith('m:') || !e.notes) continue;
      for (const m of e.notes.matchAll(/^SETENA (\d{2})\/(\d{2})\/(\d{4}): ?(.*)$/gm)) at(`${m[3]}-${m[2]}-${m[1]}`).texts.push(m[4]);
    }
    for (const [d, n] of Object.entries(b.setenaPhotos ?? {})) at(d).photos += n;
    for (const name of Object.keys(b.docs ?? {})) {
      const d = /^(\d{4}-\d{2}-\d{2})_/.exec(name)?.[1];
      if (d && !b.docs![name].uploadedIn) at(d).files.push(name);
    }
    for (const [date, x] of byDate) raw.push({ date, author: '', text: x.texts.join('\n'), files: x.files, photos: x.photos, exact: false });
  }
  const c = closureOf(b);
  const regByUpload = new Map<string, string>(), regByReceipt = new Map<string, string>();
  for (const [k, e] of Object.entries(b.deliveries ?? {})) {
    if (!k.startsWith('r:')) continue;
    if (e.uploaded) regByUpload.set(e.uploaded, k);
    if (e.received) regByReceipt.set(e.received, k);
  }
  const sem = (period?: string) => regenciaKeyForPeriod(b, period);
  const out: SetenaItem[] = raw.map(r => {
    const ym = r.date.slice(0, 7);
    // rebuilt entries have no author: one with only SETENA's own papers (its receipt, a notice) and no text or photos is SETENA's
    const setenaOnly = !r.exact && !r.text.trim() && !(r.photos ?? 0) && r.files.length > 0 && r.files.every(f => ['receipt', 'setena'].includes(b.docs?.[f]?.kind ?? ''));
    const mine = setenaOnly ? false : isMine(b, r.author);
    const photos = (r.photos ?? 0) + r.files.filter(f => IMG.test(f) || b.docs?.[f]?.kind === 'photo').length;
    const docs = r.files.filter(f => !IMG.test(f) && b.docs?.[f]?.kind !== 'photo').map(name => {
      const x = b.docs?.[name];
      const label = !x ? 'documento (todavía sin leer)' : x.kind === 'regencia' ? `regencia${x.ira ? ' ' + x.ira : ''}${x.period ? ` (${x.period})` : ''}`
        : x.kind === 'foreign' ? `regencia de ${x.movedTo ?? x.expediente ?? 'otro proyecto'}` : x.kind === 'receipt' ? `nota de recibido${x.number ? ' ' + x.number : ''}`
        : x.kind === 'guarantee' ? 'garantía ambiental' : x.kind === 'setena' ? (x.closingRejected ? 'comunicado: no aceptó el cierre' : 'comunicado de SETENA')
        : x.kind === 'letter' ? 'carta' : x.kind === 'notext' ? 'escaneado (sin leer)' : 'otro documento';
      return { name, kind: (x?.kind ?? 'unread') as DocKind | 'unread', label };
    });
    const links: SetenaLink[] = [];
    if (!mine) links.push({ label: setenaOnly ? 'de SETENA: no cuenta como bitácora del regente' : `escrita por ${r.author}: no cuenta como bitácora del regente`, ok: true });
    else {
      if (monthExists(b, ym)) {
        const k = `m:${ym}`, ok = !!deliveryOf(b, k).uploaded || b.uploads.includes(ym);
        // a project that no longer has monthly deliveries (cierre, renuncia, terminada): the entry is history
        links.push(ok || isActiveProject(b) ? { label: `Bitácora de ${monthLabel(ym)}`, key: k, ok } : { label: `anotación (${statusName(b.status)}: sin entregas mensuales)`, ok: true });
      }
      if (photos) { const k = inspectionKeyFor(b, ym); if (k) links.push({ label: `Inspección de ${monthLabel(k.slice(2))}`, key: k, ok: b.visits.includes(k.slice(2)) || !!deliveryOf(b, k).visit }); }
      for (const dd of docs) {
        const x = b.docs?.[dd.name];
        if (!x) { links.push({ label: 'documento sin leer todavía', ok: false }); continue; }
        if (x.kind === 'regencia') {
          const k = regByUpload.get(r.date);
          if (x.final) links.push({ label: 'Informe final (cierre) subido', ok: c.uploaded === r.date || !!c.uploaded });
          else if (isExtraReport(b, x.period)) links.push({ label: 'informe fuera de los semestres (p. ej. el inicial)', ok: true });
          else if (k && (!sem(x.period) || sem(x.period) === k)) links.push({ label: `Regencia del semestre ${d3(k.slice(2))}: subida`, key: k, ok: true });
          else if (sem(x.period) && deliveryOf(b, sem(x.period)!).uploaded) {
            const k2 = sem(x.period)!, up = deliveryOf(b, k2).uploaded!;
            // that semester's own upload day has its PDF too: SETENA got it twice; if not, the app has the wrong day
            const backed = Object.entries(b.docs ?? {}).some(([n, y]) => n.startsWith(`${up}_`) && y.kind === 'regencia' && (!y.period || sem(y.period) === k2));
            links.push(backed ? { label: `otra versión de la regencia del semestre ${d3(k2.slice(2))} (subida también el ${d3(up)})`, key: k2, ok: true }
              : { label: `regencia del semestre ${d3(k2.slice(2))}: la app la tiene subida el ${d3(up)}, SETENA dice este día`, key: k2, ok: false });
          }
          else links.push({ label: 'regencia: la app no tiene ningún semestre subido ese día', ok: false });
        } else if (x.kind === 'receipt') {
          const k = regByReceipt.get(r.date);
          // else: SETENA's receipt of the report handed in shortly before (initial report, a second copy), or of a letter that day
          const before = Object.entries(b.docs ?? {}).filter(([n, y]) => y.kind === 'regencia' && !y.uploadedIn && n.slice(0, 10) <= r.date && n.slice(0, 10) >= addDaysISO(r.date, -45)).map(([n]) => n.slice(0, 10)).sort().pop();
          const sameDay = r.files.map(f => b.docs?.[f]?.kind).find(kk => kk === 'letter' || kk === 'guarantee' || kk === 'notext');
          links.push(k ? { label: `Nota de recibido de la regencia ${d3(k.slice(2))}`, key: k, ok: true }
            : c.received === r.date ? { label: 'Nota de recibido del informe final', ok: true }
            : before ? { label: `nota de recibido del informe subido el ${d3(before)}`, ok: true }
            : sameDay ? { label: `nota de recibido de la ${sameDay === 'letter' ? 'carta' : sameDay === 'guarantee' ? 'garantía' : 'documento'} de ese día`, ok: true }
            : { label: 'nota de recibido: la app no la tiene en ninguna regencia', ok: false });
        }
      }
    }
    return { date: r.date, time: r.time, author: r.author, mine, text: r.text, photos, docs, links, exact: r.exact };
  });
  return out.sort((a, c2) => c2.date.localeCompare(a.date) || (c2.time ?? 0) - (a.time ?? 0));
}

/** What the app has as done that no SETENA entry shows (within what SETENA was read up to). */
export function appOnly(b: Project, items = setenaItems(b)): AppOnly[] {
  if (!b.setena && !items.length) return [];
  const upTo = (b.setena?.readAt ?? '').slice(0, 10) || (items[0]?.date ?? '');
  const from = b.setenaStart ?? items[items.length - 1]?.date ?? b.openedOn;
  const mineMonths = new Set(items.filter(i => i.mine).map(i => i.date.slice(0, 7)));
  const photoKeys = new Set(items.filter(i => i.mine && i.photos).map(i => inspectionKeyFor(b, i.date.slice(0, 7))).filter(Boolean) as string[]);
  const dates = new Set(items.filter(i => i.mine).map(i => i.date));
  const out: AppOnly[] = [];
  const inRange = (d: string) => d >= from.slice(0, 7) && d <= upTo;
  for (const ym of b.uploads) if (inRange(ym) && ym <= upTo.slice(0, 7) && !mineMonths.has(ym)) out.push({ key: `m:${ym}`, date: `${ym}-01`, label: `Bitácora de ${monthLabel(ym)} marcada, pero SETENA no tiene ninguna anotación del regente ese mes` });
  for (const ym of b.visits) if (inRange(ym) && ym <= upTo.slice(0, 7) && !photoKeys.has(`m:${ym}`)) out.push({ key: `m:${ym}`, date: `${ym}-01`, label: `Inspección de ${monthLabel(ym)} marcada, pero en SETENA no hay fotos de ese mes` });
  for (const [k, e] of Object.entries(b.deliveries ?? {})) {
    if (!k.startsWith('r:') || !e.uploaded || !inRange(e.uploaded)) continue;
    // SETENA shows it that day (or within 3 days: an upload after midnight, a date typed by hand)
    const near = [...dates].some(d => Math.abs(Date.parse(d) - Date.parse(e.uploaded!)) <= 3 * 864e5);
    if (!near) out.push({ key: k, date: e.uploaded, label: `Regencia del semestre ${d3(k.slice(2))} marcada como subida el ${d3(e.uploaded)}, pero SETENA no tiene anotación ese día` });
  }
  return out.sort((a, c) => c.date.localeCompare(a.date));
}

/** Counts for a header: entries, matched, not matched in the app, and done only in the app. */
export function matchSummary(b: Project) {
  const items = setenaItems(b), only = appOnly(b, items);
  const links = items.flatMap(i => i.links);
  return { items: items.length, mine: items.filter(i => i.mine).length, ok: links.filter(l => l.ok).length, missing: links.filter(l => !l.ok).length, only: only.length, exact: items.some(i => i.exact) };
}
