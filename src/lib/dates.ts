// ===== Dates (port of Cognose tools/02-dates.js) =====
export const LOCALE = 'es-CR';

export const toISO = (d: Date) =>
  d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export const todayISO = () => toISO(new Date());
export const fromISO = (s: string) => new Date(s + 'T12:00:00');
export const monthKeyOf = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
export const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

export const DOW_SHORT = ['D', 'L', 'K', 'M', 'J', 'V', 'S'];

/** Month grid starting on Sunday: 42 cells (ISO dates). */
export function monthGrid(base: Date): string[] {
  const first = new Date(base.getFullYear(), base.getMonth(), 1, 12);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  return Array.from({ length: 42 }, (_, k) => {
    const d = new Date(start);
    d.setDate(start.getDate() + k);
    return toISO(d);
  });
}

/** Adds months keeping the end of the month (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(iso: string, n: number): string {
  const d = fromISO(iso);
  const day = d.getDate();
  const y = d.getFullYear(), m = d.getMonth() + n;
  const ny = y + Math.floor(m / 12), nm = ((m % 12) + 12) % 12;
  return toISO(new Date(ny, nm, Math.min(day, daysInMonth(ny, nm)), 12));
}

export const addDays = (iso: string, n: number) => {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
};

/** Epoch ms of an ISO date at local time 'HH:MM'. */
export function msAt(iso: string, time: string): number {
  const [h, m] = time.split(':').map(Number);
  const d = fromISO(iso);
  d.setHours(h || 0, m || 0, 0, 0);
  return d.getTime();
}

export const longDate = (iso: string) =>
  fromISO(iso).toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
export const shortDate = (iso: string) =>
  fromISO(iso).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const monthName = (d: Date) => cap(d.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' }));
export const monthNameOf = (k: string) => monthName(fromISO(k + '-01'));

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
