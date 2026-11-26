// ===== Project history for «Línea de tiempo» (pure: tested in test/timeline.test.ts) =====
// Built only from what the app already knows: SETENA entries copied into the month notes («SETENA dd/mm/aaaa: …»),
// the tasks done (with their dates), the SETENA documents read by the scanner (project.docs) and the photos of
// each month. Nothing is guessed: a task ticked without a recorded date is marked `exact: false`.
import type { Project } from './types';
import { KIND_NAME } from './docKind';
import { daysInMonth, shortDate } from './dates';

export type TlKind = 'setena' | 'visit' | 'bitacora' | 'regencia' | 'receipt' | 'doc' | 'start';
export interface TlItem { date: string; kind: TlKind; title: string; text?: string; tag?: string; exact: boolean }

const SETENA_LINE = /^SETENA (\d{2})\/(\d{2})\/(\d{4}):\s?(.*)$/;

/** The day a monthly task falls on (the opening day, cut to the month's length). */
function taskDay(b: Project, mk: string): string {
  const day = Number(b.openedOn.slice(8, 10)) || 1;
  const [y, m] = mk.split('-').map(Number);
  return `${mk}-${String(Math.min(day, daysInMonth(y, m - 1))).padStart(2, '0')}`;
}

/** Every event of the project, newest first. */
export function timelineOf(b: Project): TlItem[] {
  const out: TlItem[] = [];
  const dels = b.deliveries ?? {};
  const datedMonths = new Set<string>();
  for (const [key, dl] of Object.entries(dels)) {
    if (key.startsWith('m:')) {
      const mk = key.slice(2);
      if (dl.visit) { out.push({ date: dl.visit, kind: 'visit', title: 'Inspección', exact: true }); datedMonths.add('v' + mk); }
      if (dl.uploaded) { out.push({ date: dl.uploaded, kind: 'bitacora', title: 'Llenado de bitácora', exact: true }); datedMonths.add('u' + mk); }
      const photos = (dl.files ?? []).filter(f => f.type === 'photo');
      if (photos.length) out.push({ date: photos.map(f => f.takenOn).filter(Boolean).sort()[0] || dl.visit || taskDay(b, mk), kind: 'visit', title: `${photos.length} foto${photos.length === 1 ? '' : 's'} en la app`, exact: photos.some(f => f.takenOn) });
      // the month's notes: SETENA entries are dated lines; the rest is the user's own note for the month
      const own: string[] = [];
      let inSetena: TlItem | null = null; // the SETENA entry the previous line belonged to
      for (const line of (dl.notes ?? '').split('\n')) {
        const m = SETENA_LINE.exec(line.trim());
        if (m) { inSetena = { date: `${m[3]}-${m[2]}-${m[1]}`, kind: 'setena', title: 'Anotación en SETENA', text: m[4], exact: true }; out.push(inSetena); }
        else if (!line.trim()) inSetena = null;
        // a following line of a SETENA entry (texts with line breaks) stays with that entry
        else if (inSetena) inSetena.text = `${inSetena.text}\n${line}`;
        else own.push(line);
      }
      if (own.length) out.push({ date: taskDay(b, mk), kind: 'doc', title: '📝 Nota del mes', text: own.join('\n'), exact: false });
    } else if (key.startsWith('r:')) {
      const due = key.slice(2);
      if (dl.letter) out.push({ date: dl.letter, kind: 'regencia', title: 'Elaboración de regencia', tag: `vence ${shortDate(due)} ${due.slice(2, 4)}`, exact: true });
      if (dl.uploaded) out.push({ date: dl.uploaded, kind: 'regencia', title: 'Regencia subida a SETENA', tag: `vence ${shortDate(due)} ${due.slice(2, 4)}`, exact: true });
      if (dl.received) out.push({ date: dl.received, kind: 'receipt', title: 'Nota de recibido de la regencia', exact: true });
    } else if (key === 's:start' && dl.uploaded) {
      out.push({ date: dl.uploaded, kind: 'start', title: 'Carta de Inicio de obras', exact: true });
    }
  }
  // tasks ticked before dates were recorded (older versions): shown on their scheduled day
  for (const mk of b.visits) if (!datedMonths.has('v' + mk)) out.push({ date: taskDay(b, mk), kind: 'visit', title: 'Inspección', exact: false });
  for (const mk of b.uploads) if (!datedMonths.has('u' + mk)) out.push({ date: taskDay(b, mk), kind: 'bitacora', title: 'Llenado de bitácora', exact: false });
  for (const due of b.regencias) if (!dels[`r:${due}`]?.uploaded) out.push({ date: due, kind: 'regencia', title: 'Regencia presentada', exact: false });
  // SETENA documents read by the scanner (their file name starts with the entry date)
  for (const [name, info] of Object.entries(b.docs ?? {})) {
    const date = /^(\d{4}-\d{2}-\d{2})_/.exec(name)?.[1];
    if (!date) continue;
    const kind: TlKind = info.kind === 'regencia' ? 'regencia' : info.kind === 'receipt' ? 'receipt' : 'doc';
    const title = info.kind === 'regencia' ? `Informe de regencia${info.ira ? ' ' + info.ira : ''}${info.final ? ' (final)' : ''}`
      : info.kind === 'receipt' ? `Nota de recibido${info.number ? ' ' + info.number : ''}` : `Documento: ${KIND_NAME[info.kind]}`;
    out.push({ date, kind, title, text: info.period ? `Periodo ${info.period}` : undefined, tag: 'PDF', exact: true });
  }
  if (b.setenaStart) out.push({ date: b.setenaStart, kind: 'start', title: 'Primera anotación en SETENA (inicio de la bitácora)', exact: true });
  const rank: Record<TlKind, number> = { receipt: 0, regencia: 1, bitacora: 2, setena: 3, visit: 4, doc: 5, start: 6 };
  return merge(out).sort((a, c) => c.date.localeCompare(a.date) || rank[a.kind] - rank[c.kind]);
}


/** The same thing seen twice is shown once: a ticked task on the same day as the SETENA entry or PDF that proves it
 *  disappears, and that entry gets a «✓» tag (the task stays checked in Entregas). */
function merge(items: TlItem[]): TlItem[] {
  const drop = new Set<TlItem>();
  const on = (date: string, f: (x: TlItem) => boolean) => items.find(x => x.date === date && x.exact && f(x));
  for (const x of items) {
    if (!x.exact) continue;
    if (x.kind === 'bitacora') {
      const e = on(x.date, y => y.kind === 'setena');
      if (e) { drop.add(x); e.tag = '✓ bitácora'; }
    } else if (x.kind === 'regencia' && (x.title === 'Regencia subida a SETENA' || x.title === 'Elaboración de regencia')) {
      const pdf = on(x.date, y => y.kind === 'regencia' && y.tag?.startsWith('PDF') === true);
      if (pdf) { drop.add(x); pdf.tag = 'PDF · ✓ subida'; }
    } else if (x.kind === 'receipt' && x.title === 'Nota de recibido de la regencia') {
      const pdf = on(x.date, y => y.kind === 'receipt' && y.tag?.startsWith('PDF') === true);
      if (pdf) { drop.add(x); pdf.tag = 'PDF · ✓ recibida'; }
    }
  }
  return items.filter(x => !drop.has(x));
}
