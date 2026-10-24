// ===== Recordatorios (adaptación de Cognose neurons/calendar/cal-remind.js) =====
// Todo el cálculo de fechas vive aquí (TypeScript). El proceso nativo solo recibe una lista
// plana de avisos {key, at, until, title, body} y dispara la notificación del sistema cuando
// llega la hora, aunque la ventana esté oculta en la bandeja.
//
//  · Mensual: cada bitácora Abierta o Nueva, el día `diaAviso` de cada mes a la hora de aviso.
//    Si el mes ya se registró, no avisa. Si la app estaba cerrada, avisa al abrir (hasta fin de mes).
//  · Semestral: desde `semestralInicio`, cada 6 meses. Incluye TODAS las bitácoras activas
//    (también las de Solicitud de Cierre) con un resumen general. Se apaga al guardar la revisión.

import type { Aviso, Bitacora, Datos, Revision } from './types';
import { generaMensual } from './types';
import { diasEnMes, fromISO, mesKey, msEn, nombreMesKey, sumarMeses, toISO, todayISO, fechaLarga } from './fechas';

const DIA = 864e5;

export function fechaMensual(b: Bitacora, mk: string): string {
  const [y, m] = mk.split('-').map(Number);
  const dia = Math.min(Math.max(1, b.diaAviso || 1), diasEnMes(y, m - 1));
  return `${mk}-${String(dia).padStart(2, '0')}`;
}

export const registradoEn = (b: Bitacora, mk: string) => b.registros.includes(mk);

/** ¿Le toca aviso mensual a esta bitácora en el mes `mk`? (estado activo y fecha ≥ inicio del seguimiento) */
export const tocaEnMes = (b: Bitacora, mk: string) => generaMensual(b.estado) && fechaMensual(b, mk) >= b.fechaInicio;

/** Próximo aviso mensual sin registrar (desde el mes actual). */
export function siguienteMensual(b: Bitacora, hoy = todayISO()): { fecha: string; mes: string; vencida: boolean } | null {
  if (!generaMensual(b.estado)) return null;
  const base = fromISO(hoy);
  for (let i = 0; i < 24; i++) {
    const mk = mesKey(new Date(base.getFullYear(), base.getMonth() + i, 1, 12));
    if (!tocaEnMes(b, mk) || registradoEn(b, mk)) continue;
    const fecha = fechaMensual(b, mk);
    return { fecha, mes: mk, vencida: fecha <= hoy };
  }
  return null;
}

/** Fechas de revisión semestral entre [desde, hasta] (ISO). */
export function fechasSemestrales(inicio: string, desde: string, hasta: string): string[] {
  if (!inicio) return [];
  const out: string[] = [];
  // la primera revisión es `inicio`; nunca se generan fechas anteriores
  for (let i = 0; i < 400; i++) {
    const f = sumarMeses(inicio, i * 6);
    if (f > hasta) break;
    if (f >= desde) out.push(f);
  }
  return out;
}

export const revisionDe = (d: Datos, periodo: string): Revision | undefined =>
  d.revisiones.find(r => r.periodo === periodo);

export function resumen(d: Datos, hoy = todayISO()) {
  const mk = hoy.slice(0, 7);
  const act = d.bitacoras;
  return {
    total: act.length,
    abiertas: act.filter(b => b.estado === 'abierta').length,
    nuevas: act.filter(b => b.estado === 'nueva').length,
    cierre: act.filter(b => b.estado === 'cierre').length,
    sinRegistro: act.filter(b => tocaEnMes(b, mk) && fechaMensual(b, mk) <= hoy && !registradoEn(b, mk)).length
  };
}

export function textoResumen(d: Datos) {
  const r = resumen(d);
  return `${r.total} bitácoras: ${r.abiertas} abiertas · ${r.nuevas} nuevas · ${r.cierre} en solicitud de cierre. ` +
    `${r.sinRegistro} sin registro este mes.`;
}

/** Bitácoras cuyo aviso de este mes ya llegó y siguen sin registrarse. */
export function pendientesDelMes(d: Datos, hoy = todayISO()): Bitacora[] {
  const mk = hoy.slice(0, 7);
  return d.bitacoras.filter(b =>
    tocaEnMes(b, mk) && !registradoEn(b, mk) && fechaMensual(b, mk) <= hoy);
}

/** Próxima revisión semestral pendiente (puede estar vencida si no se ha hecho). */
export function proximaSemestral(d: Datos, hoy = todayISO()): { fecha: string; vencida: boolean } | null {
  const fechas = fechasSemestrales(d.ajustes.semestralInicio, sumarMeses(hoy, -6), sumarMeses(hoy, 7));
  for (const f of fechas) {
    if (revisionDe(d, f)) continue;
    if (sumarMeses(f, 6) <= hoy) continue; // ya la reemplazó la siguiente
    return { fecha: f, vencida: f <= hoy };
  }
  return null;
}

/** Lo que dibuja el micro-calendario para un mes: por día, bitácoras con aviso y si hay revisión semestral. */
export function marcasDelMes(d: Datos, base: Date) {
  const mk = mesKey(base);
  const porDia = new Map<string, { mensual: Bitacora[]; semestral: boolean }>();
  const get = (iso: string) => {
    let v = porDia.get(iso);
    if (!v) porDia.set(iso, (v = { mensual: [], semestral: false }));
    return v;
  };
  for (const b of d.bitacoras) {
    if (!tocaEnMes(b, mk)) continue;
    get(fechaMensual(b, mk)).mensual.push(b);
  }
  const first = `${mk}-01`, last = `${mk}-${diasEnMes(base.getFullYear(), base.getMonth())}`;
  fechasSemestrales(d.ajustes.semestralInicio, first, last).forEach(f => { get(f).semestral = true; });
  return porDia;
}

/** Lista plana de avisos para el proceso nativo (próximos 12 meses + lo que quedó pendiente). */
export function calcularAvisos(d: Datos, now = Date.now()): Aviso[] {
  const hora = d.ajustes.horaAviso || '08:00';
  const hoy = toISO(new Date(now));
  const out: Aviso[] = [];
  const base = new Date(now);

  for (const b of d.bitacoras) {
    if (!generaMensual(b.estado)) continue;
    for (let i = 0; i < 12; i++) {
      const mdate = new Date(base.getFullYear(), base.getMonth() + i, 1, 12);
      const mk = mesKey(mdate);
      if (!tocaEnMes(b, mk) || registradoEn(b, mk)) continue;
      const fecha = fechaMensual(b, mk);
      const until = new Date(mdate.getFullYear(), mdate.getMonth() + 1, 1, 0, 0, 0).getTime();
      out.push({
        key: `m:${b.id}:${mk}`,
        at: msEn(fecha, hora),
        until,
        title: `📋 Registrar bitácora ${b.numero}`,
        body: `${b.nombre} — actualiza el registro de ${nombreMesKey(mk)}.`,
        kind: 'mensual',
        ref: b.id
      });
    }
  }

  const resumenTxt = textoResumen(d);
  for (const f of fechasSemestrales(d.ajustes.semestralInicio, toISO(new Date(now - 30 * DIA)), sumarMeses(hoy, 13))) {
    if (revisionDe(d, f)) continue;
    const at = msEn(f, hora);
    out.push({
      key: `s:${f}`,
      at,
      until: at + 30 * DIA,
      title: '🗂️ Revisión semestral de bitácoras',
      body: `Toca la revisión del ${fechaLarga(f)}. ${resumenTxt}`,
      kind: 'semestral',
      ref: f
    });
  }

  for (const p of d.pospuestos) {
    if (p.at < now - DIA) continue;
    out.push({ key: `${p.key}@${p.at}`, at: p.at, until: p.at + DIA, title: p.title, body: p.body, kind: p.kind, ref: p.ref });
  }

  return out.filter(a => a.until > now).sort((a, b) => a.at - b.at);
}

/** Próximos N avisos (para la barra lateral). */
export function proximosAvisos(d: Datos, n = 5, now = Date.now()) {
  return calcularAvisos(d, now).filter(a => a.at > now).slice(0, n);
}

