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

import type { Reminder, Project, AppData } from './types';
import { INSPECTION_LEAD_DAYS, isActiveProject, isFinished } from './types';
import { daysInMonth, shortDate, longDate, fromISO, monthKeyOf, msAt, monthNameOf, addDays, addMonths, toISO, todayISO } from './dates';

const DAY = 864e5;
const daysBetween = (a: string, b: string) => Math.round((fromISO(b).getTime() - fromISO(a).getTime()) / DAY);

/** When tracking starts: whatever was due long before the project was added to the app counts as handled
 *  (otherwise a 2020 project would show dozens of «overdue» deliveries). */
export const trackingStart = (b: Project) => {
  const added = addMonths(b.createdOn, -1);
  return added > b.openedOn ? added : b.openedOn;
};

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
  if (!isActiveProject(b)) return false;
  const f = monthlyDueAuto(b, mk);
  return f > b.openedOn && f >= trackingStart(b);
};

/** Next monthly Informe Regencial not completed yet (from the current month). */
export function nextMonthly(b: Project, today = todayISO()): { date: string; month: string; overdue: boolean } | null {
  if (!isActiveProject(b)) return null;
  const base = fromISO(today);
  for (let i = 0; i < 24; i++) {
    const mk = monthKeyOf(new Date(base.getFullYear(), base.getMonth() + i, 1, 12));
    if (!dueInMonth(b, mk) || completeIn(b, mk)) continue;
    const date = monthlyDue(b, mk);
    return { date: date, month: mk, overdue: date <= today };
  }
  return null;
}

const missingText = (b: Project, mk: string) =>
  [!visitedIn(b, mk) && 'la inspección', !uploadedIn(b, mk) && 'presentar el informe'].filter(Boolean).join(' y ');

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
    .find(v => v >= trackingStart(b) && regenciaDue(b, v).slice(0, 7) === mk) ?? null;

export type RegenciaState = 'overdue' | 'dueSoon' | 'future';
/** `key` = automatic date (identifies the Regencia); `due` = due date (adjusted if it was changed). */
export interface RegenciaInfo { b: Project; key: string; due: string; from: string; status: RegenciaState; days: number; code: number }

export function nextRegencia(b: Project, today = todayISO()): RegenciaInfo | null {
  if (!isActiveProject(b)) return null;
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
  if (!isActiveProject(b)) return [];
  const out: PendingItem[] = [];
  const base = fromISO(today);
  for (let i = -3; i < 26; i++) {
    const mk = monthKeyOf(new Date(base.getFullYear(), base.getMonth() + i, 1, 12));
    if (!dueInMonth(b, mk) || completeIn(b, mk)) continue;
    const date = monthlyDue(b, mk), planned = b.deliveries?.[`m:${mk}`]?.planned ?? null;
    if (date > until && !(planned && planned <= until)) continue;
    out.push({ b, type: 'monthly', key: `m:${mk}`, date, planned, overdue: date < today, days: daysBetween(today, date) });
  }
  const from = trackingStart(b);
  for (const key of regenciaDueDates(b, from, addMonths(until, 6))) {
    if (regenciaSubmitted(b, key)) continue;
    const date = regenciaDue(b, key), planned = b.deliveries?.[`r:${key}`]?.planned ?? null;
    if (date > until && !(planned && planned <= until)) continue;
    out.push({ b, type: 'semiannual', key: `r:${key}`, date, planned, overdue: date < today, days: daysBetween(today, date) });
  }
  return out.sort((a, c) => a.date.localeCompare(c.date));
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

/** The most urgent item of a project (to sort the list by date). */
export function nextDue(b: Project, today = todayISO()): PendingItem | null {
  return pendingOf(b, today, addMonths(today, 14))[0] ?? null;
}

/** Last day to do the inspection: 7 days before the informe is due. */
export const inspectionDeadline = (due: string) => addDays(due, -INSPECTION_LEAD_DAYS);

/** Date an item is sorted by: while the inspection is pending, its scheduled day (or its deadline);
 *  once inspected, the informe due date. */
export const sortDate = (x: PendingItem) =>
  x.b.deliveries?.[x.key]?.visit ? x.date : x.planned ?? inspectionDeadline(x.date);

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
  return d.projects.filter(b => dueInMonth(b, mk) && !completeIn(b, mk) && monthlyDue(b, mk) <= today);
}

export function summary(d: AppData, today = todayISO()) {
  const mk = today.slice(0, 7);
  const act = d.projects.filter(b => !b.archived);
  const regInfo = upcomingRegencias(d, today);
  const due = act.filter(b => dueInMonth(b, mk) && monthlyDue(b, mk) <= today);
  return {
    total: act.length,
    activeProjects: act.filter(isActiveProject).length,
    open: act.filter(b => b.status === 'open').length,
    new: act.filter(b => b.status === 'new').length,
    closing: act.filter(b => b.status === 'closing').length,
    finishedCount: act.filter(b => b.status === 'finished').length,
    finished: act.filter(b => isFinished(b.status)).length,
    archivedCount: d.projects.filter(b => b.archived).length,
    pendingMonth: due.filter(b => !completeIn(b, mk)).length,
    notUploaded: due.filter(b => !uploadedIn(b, mk)).length,
    notVisited: due.filter(b => !visitedIn(b, mk)).length,
    regenciasDueSoon: regInfo.filter(i => i.status === 'dueSoon').length,
    regenciasOverdue: regInfo.filter(i => i.status === 'overdue').length
  };
}

/** A month's Informes Regenciales (tabs «Mes actual» / «Mes próximo»). */
export function monthTasks(d: AppData, mk: string) {
  return d.projects.filter(b => dueInMonth(b, mk))
    .map(b => ({ b, date: monthlyDue(b, mk), regencia: regenciaInMonth(b, mk) }))
    .sort((a, c) => a.date.localeCompare(c.date) || a.b.code.localeCompare(c.b.code));
}

// ---------------- Reminders for the native process ----------------
export function computeReminders(d: AppData, now = Date.now()): Reminder[] {
  const today = toISO(new Date(now));
  const time = d.settings.reminderTime || '08:00';
  const out: Reminder[] = [];
  const base = new Date(now);

  for (const b of d.projects) {
    if (!isActiveProject(b)) continue;
    // Informe Regencial (mensual)
    for (let i = 0; i < 12; i++) {
      const monthDate = new Date(base.getFullYear(), base.getMonth() + i, 1, 12);
      const mk = monthKeyOf(monthDate);
      if (!dueInMonth(b, mk) || completeIn(b, mk)) continue;
      const date = monthlyDue(b, mk);
      out.push({
        key: `m:${b.id}:${mk}`,
        at: msAt(date, time),
        until: Math.max(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1, 0, 0, 0).getTime(), msAt(date, time) + 7 * DAY),
        title: `📋 Informe Regencial · ${b.code}`,
        body: `${b.name} — ${monthNameOf(mk)}: falta ${missingText(b, mk)}.`,
        kind: 'monthly',
        ref: b.id
      });
      // Inspection: 7 days before the informe, if it isn't done and not scheduled for another day
      const e = b.deliveries?.[`m:${mk}`];
      if (!visitedIn(b, mk) && !e?.planned) {
        const insp = inspectionDeadline(date);
        out.push({
          key: `n:${b.id}:${mk}`, at: msAt(insp, time), until: msAt(date, time),
          title: `🚗 Inspección · ${b.code}`,
          body: `${b.name} — hacer la inspección esta semana (el informe vence el ${shortDate(date)}).`,
          kind: 'visit', ref: b.id
        });
      }
    }
    // Regencia (semestral)
    const from = trackingStart(b);
    for (const key of regenciaDueDates(b, addMonths(today, -8), addMonths(today, 14))) {
      if (key < from || regenciaSubmitted(b, key)) continue;
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

  // Scheduled visits: a reminder the day before (evening) and on the morning of the visit
  for (const b of d.projects) {
    if (!isActiveProject(b)) continue;
    for (const [key, e] of Object.entries(b.deliveries ?? {})) {
      if (!e.planned || e.visit || e.planned < addDays(today, -1)) continue;
      const what = key.startsWith('m:') ? `Informe Regencial de ${monthNameOf(key.slice(2))}` : 'Regencia';
      out.push({
        key: `v:${b.id}:${key}:${e.planned}:0`, at: msAt(addDays(e.planned, -1), '18:00'), until: msAt(e.planned, time),
        title: `🚗 Inspección mañana · ${b.code}`, body: `${b.name} — ${what}. Fotos con GPS y luego la carta.`, kind: 'visit', ref: b.id
      });
      out.push({
        key: `v:${b.id}:${key}:${e.planned}:1`, at: msAt(e.planned, time), until: msAt(e.planned, '23:59'),
        title: `🚗 Inspección hoy · ${b.code}`, body: `${b.name} — ${what}. Fotos con GPS y luego la carta.`, kind: 'visit', ref: b.id
      });
    }
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
