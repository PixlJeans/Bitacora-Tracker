// ===== A project's REAL dates, as a list (replaces the month calendar in the project, v69) =====
// Regencias are not done on the day the schedule says: each one has its own dates (elaboración, firma, subida,
// recibido) read from the PDFs / SETENA or checked by hand. The list shows those; the due date is only shown while
// it is still pending. Same for the monthly inspección + bitácora.
import type { Project } from './types';
import { deliveryOf } from './store';
import { regenciaDueDates, regenciaDue, regenciaSubmitted, regenciaLive, monthlyDue, inspectionDate, monthLive, monthExists, hasSchedule } from './schedule';
import { addMonths, monthKeyOf, fromISO } from './dates';
import { isExtraReport, regenciaKeyForPeriod } from './folders';

export type RowState = 'done' | 'late' | 'soon' | 'future' | 'history';
export interface RegRow {
  key: string | null;          // null = a report outside the semesters (initial report…)
  due: string | null;
  period?: string; ira?: string;
  letter: string | null; signed: string | null; uploaded: string | null; received: string | null;
  state: RowState;
  date: string;                // the date it is sorted by: uploaded, else due
  note?: string;
  final?: boolean;
}
export interface MonthRow { mk: string; inspDue: string; visit: string | null; visited: boolean; bitDue: string; uploaded: string | null; up: boolean; state: RowState }

const fileDate = (n: string) => /^(\d{4}-\d{2}-\d{2})_/.exec(n)?.[1] ?? '';
const soonDays = 30;
const daysTo = (a: string, c: string) => Math.round((fromISO(c).getTime() - fromISO(a).getTime()) / 86400000);

function stateOf(done: boolean, due: string, today: string, live: boolean): RowState {
  if (done) return 'done';
  if (due < today) return live ? 'late' : 'history';
  return daysTo(today, due) <= soonDays ? 'soon' : 'future';
}

/** Every regencia of the project (newest first), with its real dates, plus the next one(s) to do. */
export function regenciaRows(b: Project, today: string): RegRow[] {
  const out: RegRow[] = [];
  const docs = Object.entries(b.docs ?? {}).filter(([, x]) => x.kind === 'regencia' && !x.misfiled && !x.uploadedIn);
  const used = new Set<string>();
  if (hasSchedule(b) || b.status === 'closing' || b.status === 'finished' || b.status === 'resigned') {
    const until = hasSchedule(b) ? addMonths(today, 7) : today;
    for (const key of regenciaDueDates(b, b.openedOn, until)) {
      const e = deliveryOf(b, `r:${key}`), due = regenciaDue(b, key);
      const up = e.uploaded ?? (regenciaSubmitted(b, key) ? due : null);
      // its PDF: the regencia uploaded that day (gives the period)
      const doc = up ? docs.find(([n]) => fileDate(n) === up) : undefined;
      if (doc) used.add(doc[0]);
      const live = hasSchedule(b) && regenciaLive(b, key, today);
      if (!up && !hasSchedule(b)) continue; // closed projects: only what was done
      // not handed in here, but uploaded in another project's bitácora by mistake
      const mis = up ? undefined : Object.entries(b.docs ?? {}).find(([, x]) => x.kind === 'regencia' && x.misfiled && regenciaKeyForPeriod(b, x.period) === `r:${key}`);
      out.push({ key, due, period: doc?.[1].period ?? mis?.[1].period, ira: doc?.[1].ira ?? mis?.[1].ira, letter: e.letter, signed: e.signed ?? null, uploaded: up, received: e.received,
        state: stateOf(!!up, due, today, live), date: up ?? due,
        note: mis ? `⚠️ Se subió el ${fileDate(mis[0]).split('-').reverse().join('/')} en la bitácora de ${mis[1].uploadedIn}, no en la de este proyecto` : undefined });
    }
  }
  // reports outside the semesters (initial report, final report, a second report the same semester)
  for (const [n, x] of docs) {
    if (used.has(n)) continue;
    const d = fileDate(n);
    if (!d || out.some(r => r.uploaded === d)) continue;
    out.push({ key: null, due: null, period: x.period, ira: x.ira, letter: null, signed: x.clientSigned ?? null, uploaded: d, received: null, state: 'done', date: d,
      final: !!x.final, note: x.final ? 'Informe final (cierre)' : isExtraReport(b, x.period) ? 'Informe fuera de los semestres (p. ej. el inicial)' : 'Informe adicional' });
  }
  return out.sort((a, c) => c.date.localeCompare(a.date));
}

/** The monthly inspección + bitácora, newest first: from `from` (default 12 months back) to next month. */
export function monthRows(b: Project, today: string, months = 12): MonthRow[] {
  if (b.noOpeningDate) return [];
  const out: MonthRow[] = [];
  const end = addMonths(`${today.slice(0, 7)}-01`, hasSchedule(b) ? 1 : 0);
  for (let i = 0; i < months + 1; i++) {
    const mk = monthKeyOf(fromISO(addMonths(end, -i)));
    if (!monthExists(b, mk)) continue;
    const e = deliveryOf(b, `m:${mk}`);
    const visited = b.visits.includes(mk), up = b.uploads.includes(mk);
    if (!hasSchedule(b) && !visited && !up) continue;
    const inspDue = inspectionDate(b, mk), bitDue = monthlyDue(b, mk);
    out.push({ mk, inspDue, visit: e.visit, visited, bitDue, uploaded: e.uploaded, up,
      state: stateOf(visited && up, visited ? bitDue : inspDue, today, monthLive(mk, today)) });
  }
  return out;
}

/** The next things to do, for the header line: next inspección / bitácora and next regencia step. */
export function nextDates(b: Project, today: string): { insp: string | null; reg: RegRow | null } {
  const m = monthRows(b, today, 2).filter(r => !r.visited || !r.up).sort((a, c) => a.mk.localeCompare(c.mk))[0];
  const reg = regenciaRows(b, today).filter(r => r.key && !r.uploaded).sort((a, c) => a.date.localeCompare(c.date)).find(r => r.state !== 'history') ?? null;
  return { insp: m ? (m.visited ? m.bitDue : m.inspDue) : null, reg };
}
