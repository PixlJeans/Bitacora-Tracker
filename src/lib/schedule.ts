// ===== Automatic deliveries and reminders (adapted from Cognose neurons/calendar/cal-remind.js) =====
// Everything is computed from the OPENING DATE, but each due date can be ADJUSTED by hand (deliveries[key].due):
//
//  · INFORME REGENCIAL (monthly) — every month, on the same day as the opening (Jan 15 → Feb 15, Mar 15…; a 31st falls
//    on the last day of short months). Steps: visit → photos → letter → uploaded to SETENA. Done with visit + upload.
//  · REGENCIA (every 6 months) — exactly every 6 months from the opening (Jan 15 → Jul 15 → Jan 15…).
//    Reminders from 1 month before, at 14, 7 and 1 day, on the day and 7 days after. Done when marked uploaded.
//  · New and Open: both, always. Closing request (already finished), Finished or archived: none.
//
// The native process only receives the flat list {key, at, until, title, body} and fires the notification.

import type { Reminder, Project, AppData, Step } from './types';
import { isActiveProject, isFinished } from './types';
import { daysInMonth, shortDate, longDate, fromISO, monthKeyOf, msAt, monthNameOf, addDays, addMonths, toISO, todayISO } from './dates';

const DAY = 864e5;
const daysBetween = (a: string, b: string) => Math.round((fromISO(b).getTime() - fromISO(a).getTime()) / DAY);

/** When tracking starts: whatever was due long before the project was added to the app counts as handled
 *  (otherwise a 2020 project would show dozens of «overdue» deliveries). */
/** Deliveries are only calculated for active projects with a known opening date. */
export const hasSchedule = (b: Project) => isActiveProject(b) && !b.noOpeningDate;

/** Monthly keys ('YYYY-MM' of the informe's own month) whose (adjusted) due date falls in month `mk`:
 *  an informe can be moved to another month, so it shows up where it was moved. */
export function monthlyKeysDueIn(b: Project, mk: string, withInspection = false): string[] {
  const base = fromISO(`${mk}-15`), out: string[] = [];
  for (let i = -3; i <= 3; i++) {
    const k = monthKeyOf(new Date(base.getFullYear(), base.getMonth() + i, 1, 12));
    if (dueInMonth(b, k) && (monthlyDue(b, k).slice(0, 7) === mk || (withInspection && inspectionDate(b, k).slice(0, 7) === mk))) out.push(k);
  }
  return out;
}

/** Opening date worked out from the next Informe Regencial and the next Regencia, for projects whose
 *  opening date is unknown: the informe gives the day; the Regencia (every 6 months) gives the months. */
export function openingFrom(nextInforme: string, nextRegencia: string, code: string, today = todayISO()): string {
  const day = fromISO(nextInforme).getDate();
  const r = fromISO(nextRegencia);
  let d = `${monthKeyOf(new Date(r.getFullYear(), r.getMonth(), 1, 12))}-${String(Math.min(day, daysInMonth(r.getFullYear(), r.getMonth()))).padStart(2, '0')}`;
  const year = Number(code.match(/-(\d{4})$/)?.[1]) || 0;
  const floor = year ? `${year}-01-01` : addMonths(today, -6);
  d = addMonths(d, -6);
  while (addMonths(d, -6) >= floor && d > addMonths(today, -6 * 40)) d = addMonths(d, -6);
  return d < today ? d : addMonths(d, -6);
}

/** Everything since the opening counts: earlier months can be checked off as done too. */
export const trackingStart = (b: Project) => b.openedOn;

// ---------------- Informe Regencial (mensual) ----------------
/** Automatic due date of the month's Informe Regencial (same day as the opening). */
export function monthlyDueAuto(b: Project, mk: string): string {
  const [y, m] = mk.split('-').map(Number);
  const day = Math.min(fromISO(b.openedOn).getDate(), daysInMonth(y, m - 1));
  return `${mk}-${String(day).padStart(2, '0')}`;
}
/** Due date of the month's Informe Regencial: the one adjusted by hand, or the automatic one. */
export const monthlyDue = (b: Project, mk: string): string => b.deliveries?.[`m:${mk}`]?.due ?? monthlyDueAuto(b, mk);
/** Due date of a Regencia (key = automatic date): the one adjusted by hand, or the automatic one. */
export const regenciaDue = (b: Project, key: string): string => b.deliveries?.[`r:${key}`]?.due ?? key;

export const uploadedIn = (b: Project, mk: string) => b.uploads.includes(mk);
export const visitedIn = (b: Project, mk: string) => b.visits.includes(mk);
export const completeIn = (b: Project, mk: string) => uploadedIn(b, mk) && visitedIn(b, mk);

/** Is there an Informe Regencial in `mk`? (active, after the opening and within tracking) */
export const dueInMonth = (b: Project, mk: string) => {
  if (!hasSchedule(b)) return false;
  const f = monthlyDueAuto(b, mk);
  return f > b.openedOn && f >= trackingStart(b);
};

/** Next monthly Informe Regencial not completed yet (from the current month). */
export function nextMonthly(b: Project, today = todayISO()): { date: string; month: string; overdue: boolean } | null {
  if (!hasSchedule(b)) return null;
  const base = fromISO(today);
  for (let i = 0; i < 24; i++) {
    const mk = monthKeyOf(new Date(base.getFullYear(), base.getMonth() + i, 1, 12));
    if (!dueInMonth(b, mk) || completeIn(b, mk)) continue;
    const date = monthlyDue(b, mk);
    return { date: date, month: mk, overdue: date <= today };
  }
  return null;
}

// ---------------- Regencia (every 6 months) ----------------
export function regenciaDueDates(b: Project, from: string, until: string): string[] {
  const out: string[] = [];
  for (let k = 1; k < 200; k++) {
    const v = addMonths(b.openedOn, 6 * k);
    if (v > until) break;
    if (v >= from) out.push(v);
  }
  return out;
}
export const reminderFrom = (due: string) => addMonths(due, -1);
export const regenciaSubmitted = (b: Project, due: string) => b.regencias.includes(due);
/** Regencia (key = automatic date) whose (adjusted) due date falls in month `mk`, or null. */
export const regenciaInMonth = (b: Project, mk: string) =>
  regenciaDueDates(b, addMonths(`${mk}-01`, -6), addMonths(`${mk}-28`, 6))
    .find(v => hasSchedule(b) && v >= trackingStart(b) && regenciaDue(b, v).slice(0, 7) === mk) ?? null;

export type RegenciaState = 'overdue' | 'dueSoon' | 'future';
/** `key` = automatic date (identifies the Regencia); `due` = due date (adjusted if it was changed). */
export interface RegenciaInfo { b: Project; key: string; due: string; from: string; status: RegenciaState; days: number; code: number }

export function nextRegencia(b: Project, today = todayISO()): RegenciaInfo | null {
  if (!hasSchedule(b)) return null;
  const from = trackingStart(b);
  for (let k = 1; k < 200; k++) {
    const key = addMonths(b.openedOn, 6 * k);
    if (key < from || regenciaSubmitted(b, key)) continue;
    const due = regenciaDue(b, key);
    const ad = reminderFrom(due);
    const status: RegenciaState = due < today ? 'overdue' : today >= ad ? 'dueSoon' : 'future';
    return { b, key: key, due: due, from: ad, status: status, days: daysBetween(today, due), code: k };
  }
  return null;
}

// ---------------- Priority by date ----------------
/** A pending delivery: a month's Informe Regencial or a semiannual Regencia. */
export interface PendingItem {
  b: Project;
  type: 'monthly' | 'semiannual';
  key: string;       // 'm:YYYY-MM' | 'r:YYYY-MM-DD'
  date: string;       // due date (adjusted)
  planned: string | null; // scheduled visit date, if any
  overdue: boolean;
  days: number;        // days from today (negative = overdue)
}

/** All pending deliveries of a project up to `until` (includes overdue ones from recent months). */
export function pendingOf(b: Project, today = todayISO(), until = addMonths(today, 2)): PendingItem[] {
  if (!hasSchedule(b)) return [];
  const out: PendingItem[] = [];
  for (const mk of monthsSinceOpening(b, until)) {
    if (!dueInMonth(b, mk) || completeIn(b, mk)) continue;
    const date = monthlyDue(b, mk);
    const insp = visitedIn(b, mk) ? null : inspectionDate(b, mk);
    const first = [insp, uploadedIn(b, mk) ? null : date].filter((x): x is string => !!x).sort()[0];
    if (first > until) continue;
    out.push({ b, type: 'monthly', key: `m:${mk}`, date, planned: insp, overdue: first < today, days: daysBetween(today, first) });
  }
  const from = trackingStart(b);
  for (const key of regenciaDueDates(b, from, addMonths(until, 6))) {
    if (regenciaSubmitted(b, key)) continue;
    const date = regenciaDue(b, key), planned = b.deliveries?.[`r:${key}`]?.planned ?? null;
    if (date > until && !(planned && planned <= until)) continue;
    out.push({ b, type: 'semiannual', key: `r:${key}`, date, planned, overdue: date < today, days: daysBetween(today, date) });
  }
  return out.sort((a, c) => sortDate(a).localeCompare(sortDate(c)));
}

/** Month keys from the month after the opening up to `until` (at most 15 years). */
export function monthsSinceOpening(b: Project, until: string): string[] {
  const o = fromISO(b.openedOn), out: string[] = [];
  for (let i = 1; i < 180; i++) {
    const mk = monthKeyOf(new Date(o.getFullYear(), o.getMonth() + i, 1, 12));
    if (`${mk}-01` > until) break;
    out.push(mk);
  }
  return out;
}

// ---------------- The three tasks: Inspección (monthly) · Bitácora (monthly) · Regencia (every 6 months) ----------------
// All three fall on the opening day; each one can be moved to any other date (even another month).
export type TaskKind = 'inspection' | 'bitacora' | 'regencia';
export interface Task { b: Project; kind: TaskKind; key: string; date: string; overdue: boolean; days: number }
export interface TaskColumn { next: Task | null; behind: number }

/** Inspection date of a month: moved by hand (`planned`) or the automatic one (opening day). */
export const inspectionDate = (b: Project, mk: string): string => b.deliveries?.[`m:${mk}`]?.planned ?? monthlyDueAuto(b, mk);

/** For the list: the oldest pending task of each kind, and how many are already past their date. */
export function taskColumns(b: Project, today = todayISO()): Record<TaskKind, TaskColumn> {
  const col = (): TaskColumn => ({ next: null, behind: 0 });
  const r: Record<TaskKind, TaskColumn> = { inspection: col(), bitacora: col(), regencia: col() };
  if (!hasSchedule(b)) return r;
  const add = (kind: TaskKind, key: string, date: string) => {
    const c = r[kind];
    if (date < today) c.behind++;
    if (!c.next || date < c.next.date) c.next = { b, kind, key, date, overdue: date < today, days: daysBetween(today, date) };
  };
  const until = addMonths(today, 14);
  for (const mk of monthsSinceOpening(b, until)) {
    if (!dueInMonth(b, mk)) continue;
    if (!visitedIn(b, mk)) add('inspection', `m:${mk}`, inspectionDate(b, mk));
    if (!uploadedIn(b, mk)) add('bitacora', `m:${mk}`, monthlyDue(b, mk));
  }
  for (const key of regenciaDueDates(b, b.openedOn, addMonths(until, 6)))
    if (!regenciaSubmitted(b, key)) add('regencia', `r:${key}`, regenciaDue(b, key));
  return r;
}

/** Everything dated before `before` that is still pending (to check it all off at once). */
export function pendingBefore(b: Project, before: string): { key: string; step: 'visit' | 'uploaded'; date: string }[] {
  if (!hasSchedule(b)) return [];
  const out: { key: string; step: 'visit' | 'uploaded'; date: string }[] = [];
  for (const mk of monthsSinceOpening(b, before)) {
    if (!dueInMonth(b, mk)) continue;
    const i = inspectionDate(b, mk), u = monthlyDue(b, mk);
    if (!visitedIn(b, mk) && i < before) out.push({ key: `m:${mk}`, step: 'visit', date: i });
    if (!uploadedIn(b, mk) && u < before) out.push({ key: `m:${mk}`, step: 'uploaded', date: u });
  }
  for (const key of regenciaDueDates(b, b.openedOn, before)) {
    const d = regenciaDue(b, key);
    if (!regenciaSubmitted(b, key) && d < before) out.push({ key: `r:${key}`, step: 'uploaded', date: d });
  }
  return out;
}

/** Which Informe Regencial (month) does a visit made on `date` belong to? That month's if it is still pending,
 *  otherwise next month's. null if none applies. */
export function monthForVisit(b: Project, date: string): string | null {
  const m0 = date.slice(0, 7);
  const m1 = addMonths(`${m0}-01`, 1).slice(0, 7);
  if (dueInMonth(b, m0) && !completeIn(b, m0)) return m0;
  if (dueInMonth(b, m1) && !completeIn(b, m1)) return m1;
  return dueInMonth(b, m0) ? m0 : null;
}

/** Which delivery does something dated `date` (a photo, a visit) belong to? The Informe Regencial of that month
 *  if `date` is on or before its due date, otherwise next month's. Ignores the tracking start, so old photos are
 *  filed too. null before the first monthly informe. */
export function deliveryKeyForDate(b: Project, date: string): string | null {
  const exists = (mk: string) => monthlyDueAuto(b, mk) > b.openedOn;
  const m0 = date.slice(0, 7);
  const m1 = addMonths(`${m0}-01`, 1).slice(0, 7);
  if (exists(m0) && date <= monthlyDue(b, m0)) return `m:${m0}`;
  if (exists(m1)) return `m:${m1}`;
  return null;
}

/** The most urgent item of a project (to sort the list by date). */
export function nextDue(b: Project, today = todayISO()): PendingItem | null {
  return pendingOf(b, today, addMonths(today, 14))[0] ?? null;
}

/** Date an item is sorted by: the earliest of its pending tasks (inspection while not done, then the bitácora). */
export const sortDate = (x: PendingItem) => {
  if (x.type !== 'monthly') return x.date;
  const mk = x.key.slice(2);
  return [x.planned, uploadedIn(x.b, mk) ? null : x.date].filter((v): v is string => !!v).sort()[0] ?? x.date;
};

/** Agenda: every pending delivery of every project, by scheduled visit / due date (most urgent first). */
export function agenda(d: AppData, today = todayISO(), until = addDays(today, 45)): PendingItem[] {
  return d.projects.flatMap(b => pendingOf(b, today, until))
    .sort((a, c) => sortDate(a).localeCompare(sortDate(c)) || a.b.code.localeCompare(c.b.code));
}

export const upcomingRegencias = (d: AppData, today = todayISO()) =>
  d.projects.map(b => nextRegencia(b, today)).filter((x): x is RegenciaInfo => !!x).sort((a, c) => a.due.localeCompare(c.due));

// ---------------- State of a month (for each project's calendar) ----------------
export type MonthState = 'outside' | 'done' | 'partial' | 'overdue' | 'today' | 'future';
export function monthState(b: Project, mk: string, today = todayISO()): MonthState {
  if (!dueInMonth(b, mk)) return 'outside';
  if (completeIn(b, mk)) return 'done';
  const f = monthlyDue(b, mk);
  if (mk < today.slice(0, 7)) return uploadedIn(b, mk) || visitedIn(b, mk) ? 'partial' : 'overdue';
  if (mk === today.slice(0, 7)) return f <= today ? (uploadedIn(b, mk) || visitedIn(b, mk) ? 'partial' : 'overdue') : 'today';
  return uploadedIn(b, mk) || visitedIn(b, mk) ? 'partial' : 'future';
}

// ---------------- Summaries ----------------
export function pendingThisMonth(d: AppData, today = todayISO()): Project[] {
  const mk = today.slice(0, 7);
  return d.projects.filter(b => monthlyKeysDueIn(b, mk).some(k => !completeIn(b, k) && monthlyDue(b, k) <= today));
}

export function summary(d: AppData, today = todayISO()) {
  const mk = today.slice(0, 7);
  const act = d.projects.filter(b => !b.archived);
  const regInfo = upcomingRegencias(d, today);
  // Informes whose (possibly moved) due date is this month and already reached
  const due = act.flatMap(b => monthlyKeysDueIn(b, mk).filter(k => monthlyDue(b, k) <= today).map(k => ({ b, k })));
  const count = (f: (x: { b: Project; k: string }) => boolean) => new Set(due.filter(f).map(x => x.b.id)).size;
  return {
    total: act.length,
    activeProjects: act.filter(isActiveProject).length,
    open: act.filter(b => b.status === 'open').length,
    new: act.filter(b => b.status === 'new').length,
    closing: act.filter(b => b.status === 'closing').length,
    finishedCount: act.filter(b => b.status === 'finished').length,
    finished: act.filter(b => isFinished(b.status)).length,
    archivedCount: d.projects.filter(b => b.archived).length,
    pendingMonth: count(x => !completeIn(x.b, x.k)),
    notUploaded: count(x => !uploadedIn(x.b, x.k)),
    notVisited: count(x => !visitedIn(x.b, x.k)),
    regenciasDueSoon: regInfo.filter(i => i.status === 'dueSoon').length,
    regenciasOverdue: regInfo.filter(i => i.status === 'overdue').length
  };
}

/** A month's Informes Regenciales (tabs «Mes actual» / «Mes próximo»). */
export function monthTasks(d: AppData, mk: string) {
  return d.projects.flatMap(b => monthlyKeysDueIn(b, mk)
    .map(k => ({ b, mk: k, date: monthlyDue(b, k), regencia: regenciaInMonth(b, mk) })))
    .sort((a, c) => a.date.localeCompare(c.date) || a.b.code.localeCompare(c.b.code));
}

// ---------------- Reminders for the native process ----------------
export function computeReminders(d: AppData, now = Date.now()): Reminder[] {
  const today = toISO(new Date(now));
  const time = d.settings.reminderTime || '08:00';
  const out: Reminder[] = [];
  const base = new Date(now);

  for (const b of d.projects) {
    if (!hasSchedule(b)) continue;
    // Bitácora (monthly) and Inspección (monthly): both on the opening day unless moved
    for (let i = -3; i < 12; i++) {
      const mk = monthKeyOf(new Date(base.getFullYear(), base.getMonth() + i, 1, 12));
      if (!dueInMonth(b, mk)) continue;
      if (!uploadedIn(b, mk)) {
        const date = monthlyDue(b, mk);
        const monthDate = fromISO(date);
        out.push({
          key: `m:${b.id}:${mk}`,
          at: msAt(date, time),
          until: Math.max(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1, 0, 0, 0).getTime(), msAt(date, time) + 7 * DAY),
          title: `📋 Bitácora · ${b.code}`,
          body: `${b.name} — presentar la bitácora de ${monthNameOf(mk)}.`,
          kind: 'monthly',
          ref: b.id
        });
      }
      if (!visitedIn(b, mk)) {
        const insp = inspectionDate(b, mk);
        if (insp < addDays(today, -1)) continue;
        out.push({
          key: `v:${b.id}:${mk}:${insp}:0`, at: msAt(addDays(insp, -1), '18:00'), until: msAt(insp, time),
          title: `🚗 Inspección mañana · ${b.code}`, body: `${b.name} — inspección de ${monthNameOf(mk)}. Fotos con GPS.`, kind: 'visit', ref: b.id
        });
        out.push({
          key: `v:${b.id}:${mk}:${insp}:1`, at: msAt(insp, time), until: msAt(insp, '23:59') + 2 * DAY,
          title: `🚗 Inspección hoy · ${b.code}`, body: `${b.name} — inspección de ${monthNameOf(mk)}. Fotos con GPS.`, kind: 'visit', ref: b.id
        });
      }
    }
    // Regencia (semestral)
    for (const key of regenciaDueDates(b, addMonths(today, -8), addMonths(today, 14))) {
      if (regenciaSubmitted(b, key)) continue;
      const due = regenciaDue(b, key);
      if (due < addDays(today, -60)) continue;
      const points = [reminderFrom(due), addDays(due, -14), addDays(due, -7), addDays(due, -1), due, addDays(due, 7)];
      points.forEach((p, n) => {
        const at = msAt(p, time);
        const until = n + 1 < points.length ? msAt(points[n + 1], time) : at + 30 * DAY;
        const days = daysBetween(p, due);
        const when = days > 1 ? `vence en ${days} días (${shortDate(due)})` : days === 1 ? 'vence mañana' : days === 0 ? 'vence HOY' : `venció el ${shortDate(due)}`;
        out.push({
          key: `i:${b.id}:${key}:${n}`,
          at, until,
          title: `🗂️ Regencia (semestral) · ${b.code}`,
          body: `${b.name} — ${when}. Apertura: ${longDate(b.openedOn)}.`,
          kind: 'regencia',
          ref: b.id
        });
      });
    }
  }

  // Friday: what comes next week (to plan the routes)
  for (let k = 0; k < 2; k++) {
    const wd = base.getDay();
    const fri = addDays(today, ((5 - wd + 7) % 7) + 7 * k);
    const mon = addDays(fri, 3), sun = addDays(fri, 9);
    const r = reportTasks(d, fri, sun);
    const next = r.upcoming.filter(t => t.date >= mon);
    const insp = next.filter(t => t.kind === 'inspection').length;
    const bit = next.filter(t => t.kind === 'bitacora').length;
    const reg = new Set(next.filter(t => t.kind === 'regElab' || t.kind === 'regUpload').map(t => t.key)).size;
    const late = r.overdue.length;
    out.push({
      key: `w:${fri}`, at: msAt(fri, time), until: msAt(fri, '23:59') + 2 * DAY,
      title: `📅 Próxima semana: ${insp} inspección(es)${reg ? `, ${reg} regencia(s)` : ''}`,
      body: [`${shortDate(mon)} – ${shortDate(sun)}: ${insp} inspecciones, ${bit} bitácoras${reg ? `, ${reg} regencias` : ''}.`, late ? `Atrasadas: ${late}.` : '', 'Abre «Rutas» para planear el recorrido.'].filter(Boolean).join(' '),
      kind: 'weekly', ref: ''
    });
  }

  for (const p of d.snoozed) {
    if (p.at < now - DAY) continue;
    out.push({ key: `${p.key}@${p.at}`, at: p.at, until: p.at + DAY, title: p.title, body: p.body, kind: p.kind, ref: p.ref });
  }
  return out.filter(a => a.until > now).sort((a, b) => a.at - b.at);
}

export function upcomingReminders(d: AppData, n = 5, now = Date.now()) {
  return computeReminders(d, now).filter(a => a.at > now).slice(0, n);
}

// ---------------- Informe de estado: what is pending and what comes next ----------------
export type ReportKind = 'inspection' | 'bitacora' | 'regElab' | 'regUpload';
export interface ReportTask { b: Project; kind: ReportKind; key: string; step: Step; date: string; month: string }
export const REPORT_LABEL: Record<ReportKind, string> = {
  inspection: '🚗 Inspección', bitacora: '📋 Llenado de bitácora', regElab: '✍️ Elaboración de regencia', regUpload: '📤 Subir regencia'
};

/** Every task not done yet with a date up to `until`: `overdue` (before today) and `upcoming` (today … until), by date. */
export function reportTasks(d: AppData, today: string, until: string) {
  const all: ReportTask[] = [];
  for (const b of d.projects) {
    if (!hasSchedule(b)) continue;
    for (const mk of monthsSinceOpening(b, until)) {
      if (!dueInMonth(b, mk)) continue;
      if (!visitedIn(b, mk)) all.push({ b, kind: 'inspection', key: `m:${mk}`, step: 'visit', date: inspectionDate(b, mk), month: mk });
      if (!uploadedIn(b, mk)) all.push({ b, kind: 'bitacora', key: `m:${mk}`, step: 'uploaded', date: monthlyDue(b, mk), month: mk });
    }
    for (const key of regenciaDueDates(b, b.openedOn, addMonths(until, 6))) {
      const date = regenciaDue(b, key), e = b.deliveries?.[`r:${key}`];
      if (regenciaSubmitted(b, key)) continue;
      if (!e?.letter) all.push({ b, kind: 'regElab', key: `r:${key}`, step: 'letter', date, month: key.slice(0, 7) });
      all.push({ b, kind: 'regUpload', key: `r:${key}`, step: 'uploaded', date, month: key.slice(0, 7) });
    }
  }
  const inRange = all.filter(t => t.date <= until).sort((a, c) => a.date.localeCompare(c.date) || a.b.code.localeCompare(c.b.code));
  return {
    overdue: inRange.filter(t => t.date < today),
    upcoming: inRange.filter(t => t.date >= today),
    noDate: d.projects.filter(b => isActiveProject(b) && b.noOpeningDate)
  };
}
