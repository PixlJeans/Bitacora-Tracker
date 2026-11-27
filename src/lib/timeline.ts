// ===== Project history for «Línea de tiempo» (pure: tested in test/timeline.test.ts) =====
// Built only from what the app already knows: SETENA entries copied into the month notes («SETENA dd/mm/aaaa: …»),
// the tasks done (with their dates), the SETENA documents read by the scanner (project.docs) and the photos of
// each month. Nothing is guessed: a task ticked without a recorded date is marked `exact: false`.
import type { Project } from './types';
import { KIND_NAME } from './docKind';
import { daysInMonth, shortDate } from './dates';

export type TlKind = 'setena' | 'visit' | 'bitacora' | 'regencia' | 'receipt' | 'doc' | 'start';
export interface TlItem { date: string; kind: TlKind; title: string; text?: string; tag?: string; exact: boolean; count?: number }

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
      if (dl.signed) out.push({ date: dl.signed, kind: 'regencia', title: '🖊️ Firmada por el cliente', exact: true });
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
  // closing (only what was checked by hand: the final regencia's PDF is already in the list below)
  if (b.closure?.approved) out.push({ date: b.closure.approved, kind: 'doc', title: '✅ Cierre aprobado por SETENA', exact: true });
  if (b.closure?.guarantee) out.push({ date: b.closure.guarantee, kind: 'doc', title: '💵 Garantía ambiental devuelta al propietario', exact: true });
  // SETENA documents read by the scanner (their file name starts with the entry date)
  for (const [name, info] of Object.entries(b.docs ?? {})) {
    const date = /^(\d{4}-\d{2}-\d{2})_/.exec(name)?.[1];
    if (!date || info.kind === 'photo' || info.movedTo) continue; // photos: counted with the SETENA photos · moved: shown in its project
    const kind: TlKind = info.kind === 'regencia' ? 'regencia' : info.kind === 'receipt' ? 'receipt' : 'doc';
    const title = info.kind === 'regencia' ? `Informe de regencia${info.ira ? ' ' + info.ira : ''}${info.final ? ' (final)' : ''}`
      + (info.uploadedIn ? ` · subida en la bitácora de ${info.uploadedIn}${info.misfiled ? ' (no en la suya)' : ''}` : '')
      : info.kind === 'receipt' ? `Nota de recibido${info.number ? ' ' + info.number : ''}`
      : info.kind === 'guarantee' ? `🛡️ Garantía ambiental${info.validTo ? ` (vigencia hasta ${shortDate(info.validTo)} ${info.validTo.slice(2, 4)})` : ''}`
      : info.closingRejected ? '⚠️ SETENA no aceptó la solicitud de cierre' : `Documento: ${KIND_NAME[info.kind]}`;
    out.push({ date, kind, title, text: info.period ? `Periodo ${info.period}` : undefined, tag: info.ocr ? 'escaneado' : 'PDF', exact: true });
    // the client's digital signature inside the regencia (they sign it, then it is sent to SETENA)
    if (info.kind === 'regencia' && info.clientSigned)
      out.push({ date: info.clientSigned, kind: 'regencia', title: `🖊️ Firmada por el cliente${info.clientName ? ` (${info.clientName})` : ''}`, tag: 'firma digital', exact: true });
  }
  // photos uploaded to SETENA (counted by the folder scanner, by the date of their entry)
  for (const [date, n] of Object.entries(b.setenaPhotos ?? {}))
    out.push({ date, kind: 'visit', title: `📷 ${n} foto${n === 1 ? '' : 's'} en SETENA`, tag: 'fotos', exact: true });
  if (b.setenaStart) out.push({ date: b.setenaStart, kind: 'start', title: 'Primera anotación en SETENA (inicio de la bitácora)', exact: true });
  const rank: Record<TlKind, number> = { receipt: 0, regencia: 1, bitacora: 2, setena: 3, visit: 4, doc: 5, start: 6 };
  return merge(dedupe(out)).sort((a, c) => c.date.localeCompare(a.date) || rank[a.kind] - rank[c.kind]);
}


/** The same thing seen twice is shown once: a ticked task proven by a SETENA entry (bitácora: any entry that month)
 *  or PDF (regencia / receipt: same day) disappears and that entry gets a «✓» tag (the task stays checked in Entregas).
 *  A task with no proof in SETENA is kept, tagged «marcada en la app · sin anotación en SETENA». */
function merge(items: TlItem[]): TlItem[] {
  const drop = new Set<TlItem>();
  const on = (date: string, f: (x: TlItem) => boolean) => items.find(x => x.date === date && x.exact && f(x));
  const APP = 'marcada en la app · sin anotación en SETENA';
  for (const x of items) {
    if (x.kind === 'visit' && x.title === 'Inspección' && x.exact) {
      // an inspection is proven by the photos uploaded to SETENA that day
      const ph = on(x.date, y => y.kind === 'visit' && y.tag === 'fotos');
      if (ph) { drop.add(x); ph.tag = '✓ inspección'; }
    } else if (x.title === '🖊️ Firmada por el cliente' && x.exact) {
      // the check of that day = the digital signature read from the PDF
      if (on(x.date, y => y.tag === 'firma digital')) drop.add(x);
    } else if (x.kind === 'bitacora') {
      // the bitácora IS the SETENA entry: any entry that month proves it; none = only ticked in the app
      const e = items.find(y => y.kind === 'setena' && y.date === x.date) ?? items.find(y => y.kind === 'setena' && y.date.slice(0, 7) === x.date.slice(0, 7));
      if (e) { drop.add(x); e.tag = '✓ bitácora'; } else x.tag = APP;
    } else if (!x.exact) {
      continue;
    } else if (x.kind === 'regencia' && (x.title === 'Regencia subida a SETENA' || x.title === 'Elaboración de regencia')) {
      const pdf = on(x.date, y => y.kind === 'regencia' && y.tag?.startsWith('PDF') === true);
      if (pdf) { drop.add(x); pdf.tag = 'PDF · ✓ subida'; } else if (x.title === 'Regencia subida a SETENA') x.tag = `${x.tag ? x.tag + ' · ' : ''}${APP}`;
    } else if (x.kind === 'receipt' && x.title === 'Nota de recibido de la regencia') {
      const pdf = on(x.date, y => y.kind === 'receipt' && y.tag?.startsWith('PDF') === true);
      if (pdf) { drop.add(x); pdf.tag = 'PDF · ✓ recibida'; } else x.tag = APP;
    }
  }
  return items.filter(x => !drop.has(x));
}

/** The same PDF uploaded twice to SETENA on the same day (same title and text): shown once, «PDF ×2». */
function dedupe(items: TlItem[]): TlItem[] {
  const seen = new Map<string, { x: TlItem; n: number }>();
  const out: TlItem[] = [];
  for (const x of items) {
    if (x.tag !== 'PDF') { out.push(x); continue; }
    const k = `${x.date}|${x.kind}|${x.title}|${x.text ?? ''}`;
    const s = seen.get(k);
    if (s) { s.n++; s.x.count = s.n; continue; }
    seen.set(k, { x, n: 1 }); out.push(x);
  }
  return out;
}

/** Open / new project whose LAST SETENA entry says the regente resigned («Se presenta nota de Renuncia»), not
 *  turned into «Renuncia» before. Content rule only. */
export function resignedInSetena(b: Project): boolean {
  if (b.archived || b.resignChecked || (b.status !== 'open' && b.status !== 'new')) return false;
  const last = timelineOf(b).find(x => x.kind === 'setena');
  return !!last && /\brenuncia\b/i.test(last.text ?? '');
}
