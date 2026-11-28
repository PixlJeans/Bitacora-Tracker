// ===== «Plan de la semana»: the pending inspections spread over the days left in the week =====
// Every pending inspection (late ones too: catching up is the point) is one stop per project. A stop that already
// has a day this week (scheduled with «📅 Programar», or due that day) keeps it. The rest are grouped by distance
// into trips (nearby projects together) and each trip goes, most urgent first, to the day with the fewest stops.
// A trip never has more than `maxPerDay` stops (bigger ones are split by nearest neighbour). Pure: tested.
import type { Project } from './types';
import { addDays, fromISO } from './dates';
import { distanceKm, groupNearby } from './geo';

export interface PlanStop { b: Project; date: string }

/** The days a week's plan can use: Monday–Friday from today on; on a weekend (or if none left) the days left;
 *  a past week: its Monday–Friday. */
export function planDays(mon: string, today: string): string[] {
  const week = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  const work = week.filter(d => { const w = fromISO(d).getDay(); return w >= 1 && w <= 5; });
  if (week[6] < today) return work;
  const ahead = work.filter(d => d >= today);
  if (ahead.length) return ahead;
  const rest = week.filter(d => d >= today);
  return rest.length ? rest : work;
}

/** Splits a group into chunks of at most `max`, walking from the most urgent stop to the nearest next one. */
function chunks<T extends PlanStop>(g: T[], max: number): T[][] {
  if (g.length <= max) return [g];
  const left = [...g].sort((a, c) => a.date.localeCompare(c.date));
  const out: T[][] = [];
  while (left.length) {
    const cur = [left.shift()!];
    while (cur.length < max && left.length) {
      const last = cur[cur.length - 1].b.location!;
      let bi = 0;
      left.forEach((s, i) => { if (distanceKm(last, s.b.location!) < distanceKm(last, left[bi].b.location!)) bi = i; });
      cur.push(left.splice(bi, 1)[0]);
    }
    out.push(cur);
  }
  return out;
}

/** `overflow`: what doesn't fit in the days left (at most `maxPerDay` stops a day): it goes to next week's plan. */
export function planWeek<T extends PlanStop>(stops: T[], days: string[], radiusKm: number, maxPerDay = 6): { days: { day: string; stops: T[] }[]; withoutLocation: T[]; overflow: T[] } {
  const byDay = new Map<string, T[]>(days.map(d => [d, []]));
  const free: T[] = [];
  for (const s of stops) (byDay.has(s.date) ? byDay.get(s.date)! : free).push(s);
  const { groups, withoutLocation } = groupNearby(free, radiusKm);
  const trips = groups.flatMap(g => chunks(g, maxPerDay))
    .map(g => ({ g, first: g.reduce((m, s) => (s.date < m ? s.date : m), g[0].date) }))
    .sort((a, c) => a.first.localeCompare(c.first) || c.g.length - a.g.length);
  const overflow: T[] = [];
  const room = (d: string) => maxPerDay - byDay.get(d)!.length;
  for (const t of trips) {
    // the day with the fewest stops where the whole trip fits (the earliest on a tie)
    const fits = days.filter(d => room(d) >= t.g.length).sort((x, y) => byDay.get(x)!.length - byDay.get(y)!.length || x.localeCompare(y));
    if (fits.length) { byDay.get(fits[0])!.push(...t.g); continue; }
    // no day has room for all of it: fill the room left (earliest days first); the rest waits for next week
    const rest = [...t.g];
    for (const d of days) while (rest.length && room(d) > 0) byDay.get(d)!.push(rest.shift()!);
    overflow.push(...rest);
  }
  return { days: days.map(day => ({ day, stops: byDay.get(day)! })).filter(x => x.stops.length), withoutLocation, overflow };
}

/** The week to plan when the screen opens: from Friday afternoon on, this week is over → next week. */
export const planMonday = (today: string, now = new Date()) => {
  const wd = fromISO(today).getDay();
  return wd === 6 || wd === 0 || (wd === 5 && now.getHours() >= 14) ? addDays(mondayOfISO(today), 7) : mondayOfISO(today);
};
const mondayOfISO = (iso: string) => { const wd = fromISO(iso).getDay(); return addDays(iso, wd === 0 ? -6 : 1 - wd); };
