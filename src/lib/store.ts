// ===== Store (puerto de Cognose tools/04-store.js + Undo de 01-config.js) =====
// Una sola capa de datos: cada cambio pasa por `mutar()`, que guarda una copia para Deshacer,
// persiste en disco (con pequeño retardo) y vuelve a programar los avisos nativos.

import { useSyncExternalStore } from 'react';
import type { Ajustes, Bitacora, Datos, Estado } from './types';
import { ETIQUETAS_BASE } from './types';
import { backend } from './backend';
import { calcularAvisos } from './avisos';
import { todayISO, uid } from './fechas';

function semestralPorDefecto(): string {
  const d = new Date();
  const y = d.getFullYear(), m = d.getMonth();
  return m < 6 ? `${y}-07-15` : `${y + 1}-01-15`;
}

export const AJUSTES_BASE: Ajustes = {
  horaAviso: '08:00',
  semestralInicio: semestralPorDefecto(),
  diaAvisoDefecto: 1,
  notificaciones: true,
  autoInicio: true,
  tema: 'dark',
  acento: '#4ade80',
  tamano: 100,
  separadorCsv: ';'
};

const vacio = (): Datos => ({
  version: 1, bitacoras: [], etiquetas: ETIQUETAS_BASE.map(e => ({ ...e })), revisiones: [], pospuestos: [],
  ajustes: { ...AJUSTES_BASE }
});

let datos: Datos = vacio();
let listo = false;
const subs = new Set<() => void>();
const emitir = () => subs.forEach(f => f());

export const getDatos = () => datos;
export const estaListo = () => listo;
export function useDatos(): Datos {
  return useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb); }; }, () => datos);
}

/** Normaliza lo leído del disco (versiones viejas, campos faltantes, valores raros). */
export function normalizar(raw: any): Datos {
  const d = vacio();
  if (!raw || typeof raw !== 'object') return d;
  d.ajustes = { ...AJUSTES_BASE, ...(raw.ajustes || {}) };
  d.etiquetas = Array.isArray(raw.etiquetas) && raw.etiquetas.length ? raw.etiquetas.filter((e: any) => e && e.id) : d.etiquetas;
  d.revisiones = Array.isArray(raw.revisiones) ? raw.revisiones : [];
  d.pospuestos = Array.isArray(raw.pospuestos) ? raw.pospuestos.filter((p: any) => p && p.at > Date.now() - 864e5) : [];
  const estados: Estado[] = ['abierta', 'nueva', 'cierre'];
  d.bitacoras = (Array.isArray(raw.bitacoras) ? raw.bitacoras : [])
    .filter((b: any) => b && b.numero && b.nombre)
    .map((b: any): Bitacora => ({
      id: String(b.id || uid()),
      numero: String(b.numero).toUpperCase().trim(),
      nombre: String(b.nombre).trim(),
      estado: estados.includes(b.estado) ? b.estado : 'abierta',
      etiquetaId: d.etiquetas.some(e => e.id === b.etiquetaId) ? b.etiquetaId : d.etiquetas[d.etiquetas.length - 1].id,
      diaAviso: Math.min(28, Math.max(1, Number(b.diaAviso) || 1)),
      fechaInicio: /^\d{4}-\d{2}-\d{2}$/.test(b.fechaInicio || '') ? b.fechaInicio : todayISO(),
      notas: String(b.notas || ''),
      registros: Array.isArray(b.registros) ? [...new Set<string>(b.registros.filter((r: any) => /^\d{4}-\d{2}$/.test(r)))] : [],
      ultimaActualizacion: b.ultimaActualizacion || null,
      creada: b.creada || todayISO()
    }));
  return d;
}

// ---------- Persistencia ----------
let tGuardar: ReturnType<typeof setTimeout> | null = null;
let tProgramar: ReturnType<typeof setTimeout> | null = null;
export let errorGuardado: string | null = null;

function persistir() {
  if (tGuardar) clearTimeout(tGuardar);
  tGuardar = setTimeout(() => {
    backend.guardar(JSON.stringify(datos, null, 1))
      .then(() => { errorGuardado = null; })
      .catch(e => { errorGuardado = String(e); console.error('No se pudo guardar', e); });
  }, 250);
}

export function reprogramar() {
  if (tProgramar) clearTimeout(tProgramar);
  tProgramar = setTimeout(() => {
    const avisos = datos.ajustes.notificaciones ? calcularAvisos(datos) : [];
    backend.programar(avisos).catch(e => console.error('No se pudieron programar los avisos', e));
  }, 300);
}

// Recalcula cada hora (cambio de mes, avisos pospuestos vencidos, resumen semestral al día)
setInterval(() => { if (listo) reprogramar(); }, 3600e3);

export async function iniciar() {
  let raw: any = null;
  try {
    const txt = await backend.cargar();
    raw = txt ? JSON.parse(txt) : null;
  } catch (e) { console.error('Datos ilegibles, se empieza vacío', e); }
  datos = normalizar(raw);
  // Primer arranque: abrir con el sistema para que los avisos lleguen sin tener que abrir la app
  if (!raw && datos.ajustes.autoInicio) backend.autoInicio(true).catch(() => { /* opcional */ });
  listo = true;
  emitir();
  reprogramar();
}

// ---------- Undo (Ctrl+Z), igual que en Cognose ----------
const pila: string[] = [];
export const Undo = {
  push() {
    pila.push(JSON.stringify(datos));
    if (pila.length > 50) pila.shift();
  },
  pop(): boolean {
    const s = pila.pop();
    if (!s) return false;
    datos = JSON.parse(s);
    emitir(); persistir(); reprogramar();
    return true;
  },
  puede: () => pila.length > 0
};

/** Único punto de escritura. `undo:false` para cambios que no merecen deshacer (ajustes visuales). */
export function mutar(fn: (d: Datos) => void, opts: { undo?: boolean } = {}) {
  if (opts.undo !== false) Undo.push();
  const copia: Datos = structuredClone(datos);
  fn(copia);
  datos = copia;
  emitir();
  persistir();
  reprogramar();
}

/** Reemplaza todo (importar respaldo). */
export function reemplazar(nuevo: Datos) {
  Undo.push();
  datos = normalizar(nuevo);
  emitir(); persistir(); reprogramar();
}

// ---------- Operaciones de bitácoras ----------
export const existeNumero = (numero: string, ignorarId?: string) =>
  datos.bitacoras.some(b => b.id !== ignorarId && b.numero === numero.toUpperCase().trim());

export function etiquetaPorEstado(e: Estado): string {
  const ids = datos.etiquetas.map(x => x.id);
  const pref = e === 'nueva' ? 'proximo' : 'aldia';
  return ids.includes(pref) ? pref : ids[ids.length - 1];
}

export function registrarMes(id: string, mk: string, on = true) {
  mutar(d => {
    const b = d.bitacoras.find(x => x.id === id);
    if (!b) return;
    b.registros = on ? [...new Set([...b.registros, mk])] : b.registros.filter(r => r !== mk);
    if (on) b.ultimaActualizacion = todayISO();
    d.pospuestos = d.pospuestos.filter(p => !(p.ref === id && p.key.endsWith(mk)));
  });
}
