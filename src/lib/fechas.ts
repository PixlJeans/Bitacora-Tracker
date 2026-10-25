// ===== Fechas (puerto de Cognose tools/02-dates.js) =====
export const LOCALE = 'es-CR';

export const toISO = (d: Date) =>
  d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export const todayISO = () => toISO(new Date());
export const fromISO = (s: string) => new Date(s + 'T12:00:00');
export const mesKey = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
export const diasEnMes = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

export const DOW_CORTO = ['D', 'L', 'K', 'M', 'J', 'V', 'S'];

/** Cuadrícula del mes empezando en domingo: 42 celdas (fechas ISO). */
export function gridMes(base: Date): string[] {
  const first = new Date(base.getFullYear(), base.getMonth(), 1, 12);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  return Array.from({ length: 42 }, (_, k) => {
    const d = new Date(start);
    d.setDate(start.getDate() + k);
    return toISO(d);
  });
}

/** Suma meses respetando el fin de mes (31 ene + 1 mes = 28/29 feb). */
export function sumarMeses(iso: string, n: number): string {
  const d = fromISO(iso);
  const dia = d.getDate();
  const y = d.getFullYear(), m = d.getMonth() + n;
  const ny = y + Math.floor(m / 12), nm = ((m % 12) + 12) % 12;
  return toISO(new Date(ny, nm, Math.min(dia, diasEnMes(ny, nm)), 12));
}

export const sumarDias = (iso: string, n: number) => {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
};

/** ms epoch de una fecha ISO a la hora 'HH:MM' local. */
export function msEn(iso: string, hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  const d = fromISO(iso);
  d.setHours(h || 0, m || 0, 0, 0);
  return d.getTime();
}

export const fechaLarga = (iso: string) =>
  fromISO(iso).toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
export const fechaCorta = (iso: string) =>
  fromISO(iso).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const nombreMes = (d: Date) => cap(d.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' }));
export const nombreMesKey = (k: string) => nombreMes(fromISO(k + '-01'));

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
