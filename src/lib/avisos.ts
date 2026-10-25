// ===== Revisiones automáticas y recordatorios (adaptación de Cognose neurons/calendar/cal-remind.js) =====
// Todo se calcula desde la FECHA DE APERTURA; el usuario solo cambia el estado:
//
//  · REVISIÓN MENSUAL — cada mes, el mismo día de la apertura (15 ene → 15 feb, 15 mar…; un 31 cae
//    el último día de los meses cortos). Incluye llenado de bitácora + inspección. Se apaga al marcar ambas.
//  · INFORME REGENCIAL (revisión semestral) — cada 6 meses exactos desde la apertura
//    (15 ene → 15 jul → 15 ene…). Avisos desde 1 mes antes, a 14, 7 y 1 día, el día y 7 días después.
//  · Nueva, Abierta y Solicitud de Cierre: ambas, siempre. Terminada o archivada: ninguna.
//
// El proceso nativo solo recibe la lista plana {key, at, until, title, body} y dispara la notificación.

import type { Aviso, Bitacora, Datos } from './types';
import { estaActiva } from './types';
import { diasEnMes, fechaCorta, fechaLarga, fromISO, mesKey, msEn, nombreMesKey, sumarDias, sumarMeses, toISO, todayISO } from './fechas';

const DIA = 864e5;
const diasEntre = (a: string, b: string) => Math.round((fromISO(b).getTime() - fromISO(a).getTime()) / DIA);

/** Desde cuándo se le da seguimiento: lo que venció mucho antes de darla de alta en la app se da por atendido
 *  (si no, una bitácora de 2020 aparecería con decenas de revisiones «vencidas»). */
export const inicioSeguimiento = (b: Bitacora) => {
  const alta = sumarMeses(b.creada, -1);
  return alta > b.apertura ? alta : b.apertura;
};

// ---------------- Revisión mensual ----------------
export function fechaMensual(b: Bitacora, mk: string): string {
  const [y, m] = mk.split('-').map(Number);
  const dia = Math.min(fromISO(b.apertura).getDate(), diasEnMes(y, m - 1));
  return `${mk}-${String(dia).padStart(2, '0')}`;
}

export const registradoEn = (b: Bitacora, mk: string) => b.registros.includes(mk);
export const inspeccionadoEn = (b: Bitacora, mk: string) => b.inspecciones.includes(mk);
export const completoEn = (b: Bitacora, mk: string) => registradoEn(b, mk) && inspeccionadoEn(b, mk);

/** ¿Hay revisión mensual en `mk`? (activa, después de la apertura y dentro del seguimiento) */
export const tocaEnMes = (b: Bitacora, mk: string) => {
  if (!estaActiva(b)) return false;
  const f = fechaMensual(b, mk);
  return f > b.apertura && f >= inicioSeguimiento(b);
};

/** Próxima revisión mensual sin completar (desde el mes actual). */
export function siguienteMensual(b: Bitacora, hoy = todayISO()): { fecha: string; mes: string; vencida: boolean } | null {
  if (!estaActiva(b)) return null;
  const base = fromISO(hoy);
  for (let i = 0; i < 24; i++) {
    const mk = mesKey(new Date(base.getFullYear(), base.getMonth() + i, 1, 12));
    if (!tocaEnMes(b, mk) || completoEn(b, mk)) continue;
    const fecha = fechaMensual(b, mk);
    return { fecha, mes: mk, vencida: fecha <= hoy };
  }
  return null;
}

const faltaTxt = (b: Bitacora, mk: string) =>
  [!registradoEn(b, mk) && 'llenado de bitácora', !inspeccionadoEn(b, mk) && 'inspección'].filter(Boolean).join(' e ');

// ---------------- Informe regencial (cada 6 meses) ----------------
export function vencimientosInforme(b: Bitacora, desde: string, hasta: string): string[] {
  const out: string[] = [];
  for (let k = 1; k < 200; k++) {
    const v = sumarMeses(b.apertura, 6 * k);
    if (v > hasta) break;
    if (v >= desde) out.push(v);
  }
  return out;
}
export const avisoDesde = (vence: string) => sumarMeses(vence, -1);
export const informeEntregado = (b: Bitacora, vence: string) => b.informes.includes(vence);
/** Vencimiento de informe que cae en el mes `mk` (o null). */
export const informeEnMes = (b: Bitacora, mk: string) =>
  vencimientosInforme(b, `${mk}-01`, `${mk}-31`).find(v => v.slice(0, 7) === mk && v >= inicioSeguimiento(b)) ?? null;

export type EstadoInforme = 'vencido' | 'aviso' | 'futuro';
export interface InfoInforme { b: Bitacora; vence: string; desde: string; estado: EstadoInforme; dias: number; numero: number }

export function proximoInforme(b: Bitacora, hoy = todayISO()): InfoInforme | null {
  if (!estaActiva(b)) return null;
  const desde = inicioSeguimiento(b);
  for (let k = 1; k < 200; k++) {
    const vence = sumarMeses(b.apertura, 6 * k);
    if (vence < desde || informeEntregado(b, vence)) continue;
    const ad = avisoDesde(vence);
    const estado: EstadoInforme = vence < hoy ? 'vencido' : hoy >= ad ? 'aviso' : 'futuro';
    return { b, vence, desde: ad, estado, dias: diasEntre(hoy, vence), numero: k };
  }
  return null;
}

export const proximosInformes = (d: Datos, hoy = todayISO()) =>
  d.bitacoras.map(b => proximoInforme(b, hoy)).filter((x): x is InfoInforme => !!x).sort((a, c) => a.vence.localeCompare(c.vence));

// ---------------- Estado de un mes (para el mini-calendario de cada proyecto) ----------------
export type EstadoMes = 'fuera' | 'hecho' | 'parcial' | 'vencido' | 'hoy' | 'futuro';
export function estadoMes(b: Bitacora, mk: string, hoy = todayISO()): EstadoMes {
  if (!tocaEnMes(b, mk)) return 'fuera';
  if (completoEn(b, mk)) return 'hecho';
  const f = fechaMensual(b, mk);
  if (mk < hoy.slice(0, 7)) return registradoEn(b, mk) || inspeccionadoEn(b, mk) ? 'parcial' : 'vencido';
  if (mk === hoy.slice(0, 7)) return f <= hoy ? (registradoEn(b, mk) || inspeccionadoEn(b, mk) ? 'parcial' : 'vencido') : 'hoy';
  return registradoEn(b, mk) || inspeccionadoEn(b, mk) ? 'parcial' : 'futuro';
}

// ---------------- Resúmenes ----------------
export function pendientesDelMes(d: Datos, hoy = todayISO()): Bitacora[] {
  const mk = hoy.slice(0, 7);
  return d.bitacoras.filter(b => tocaEnMes(b, mk) && !completoEn(b, mk) && fechaMensual(b, mk) <= hoy);
}

export function resumen(d: Datos, hoy = todayISO()) {
  const mk = hoy.slice(0, 7);
  const act = d.bitacoras.filter(b => !b.archivada);
  const inf = proximosInformes(d, hoy);
  const debidas = act.filter(b => tocaEnMes(b, mk) && fechaMensual(b, mk) <= hoy);
  return {
    total: act.length,
    activas: act.filter(estaActiva).length,
    abiertas: act.filter(b => b.estado === 'abierta').length,
    nuevas: act.filter(b => b.estado === 'nueva').length,
    cierre: act.filter(b => b.estado === 'cierre').length,
    terminadas: act.filter(b => b.estado === 'terminada').length,
    archivadas: d.bitacoras.filter(b => b.archivada).length,
    pendientesMes: debidas.filter(b => !completoEn(b, mk)).length,
    sinRegistro: debidas.filter(b => !registradoEn(b, mk)).length,
    sinInspeccion: debidas.filter(b => !inspeccionadoEn(b, mk)).length,
    informesAviso: inf.filter(i => i.estado === 'aviso').length,
    informesVencidos: inf.filter(i => i.estado === 'vencido').length
  };
}

/** Revisiones de un mes (pestañas «Mes actual» / «Mes próximo»). */
export function tareasDelMes(d: Datos, mk: string) {
  return d.bitacoras.filter(b => tocaEnMes(b, mk))
    .map(b => ({ b, fecha: fechaMensual(b, mk), informe: informeEnMes(b, mk) }))
    .sort((a, c) => a.fecha.localeCompare(c.fecha) || a.b.numero.localeCompare(c.b.numero));
}

// ---------------- Avisos para el proceso nativo ----------------
export function calcularAvisos(d: Datos, now = Date.now()): Aviso[] {
  const hoy = toISO(new Date(now));
  const hora = d.ajustes.horaAviso || '08:00';
  const out: Aviso[] = [];
  const base = new Date(now);

  for (const b of d.bitacoras) {
    if (!estaActiva(b)) continue;
    // Revisión mensual
    for (let i = 0; i < 12; i++) {
      const mdate = new Date(base.getFullYear(), base.getMonth() + i, 1, 12);
      const mk = mesKey(mdate);
      if (!tocaEnMes(b, mk) || completoEn(b, mk)) continue;
      const fecha = fechaMensual(b, mk);
      out.push({
        key: `m:${b.id}:${mk}`,
        at: msEn(fecha, hora),
        until: new Date(mdate.getFullYear(), mdate.getMonth() + 1, 1, 0, 0, 0).getTime(),
        title: `📋 Revisión mensual · ${b.numero}`,
        body: `${b.nombre} — ${nombreMesKey(mk)}: falta ${faltaTxt(b, mk)}.`,
        kind: 'mensual',
        ref: b.id
      });
    }
    // Informe regencial
    const desde = inicioSeguimiento(b);
    for (const vence of vencimientosInforme(b, sumarDias(hoy, -60), sumarMeses(hoy, 14))) {
      if (vence < desde || informeEntregado(b, vence)) continue;
      const puntos = [avisoDesde(vence), sumarDias(vence, -14), sumarDias(vence, -7), sumarDias(vence, -1), vence, sumarDias(vence, 7)];
      puntos.forEach((p, n) => {
        const at = msEn(p, hora);
        const until = n + 1 < puntos.length ? msEn(puntos[n + 1], hora) : at + 30 * DIA;
        const dias = diasEntre(p, vence);
        const cuando = dias > 1 ? `vence en ${dias} días (${fechaCorta(vence)})` : dias === 1 ? 'vence mañana' : dias === 0 ? 'vence HOY' : `venció el ${fechaCorta(vence)}`;
        out.push({
          key: `i:${b.id}:${vence}:${n}`,
          at, until,
          title: `🗂️ Informe regencial · ${b.numero}`,
          body: `${b.nombre} — ${cuando}. Apertura: ${fechaLarga(b.apertura)}.`,
          kind: 'informe',
          ref: b.id
        });
      });
    }
  }

  for (const p of d.pospuestos) {
    if (p.at < now - DIA) continue;
    out.push({ key: `${p.key}@${p.at}`, at: p.at, until: p.at + DIA, title: p.title, body: p.body, kind: p.kind, ref: p.ref });
  }
  return out.filter(a => a.until > now).sort((a, b) => a.at - b.at);
}

export function proximosAvisos(d: Datos, n = 5, now = Date.now()) {
  return calcularAvisos(d, now).filter(a => a.at > now).slice(0, n);
}
