// ===== Store (puerto de Cognose tools/04-store.js + Undo de 01-config.js) =====
// Una sola capa de datos: cada cambio pasa por `mutar()`, que guarda una copia para Deshacer,
// persiste en disco (con pequeño retardo) y vuelve a programar los avisos nativos.

import { useSyncExternalStore } from 'react';
import type { Ajustes, Bitacora, Datos, Estado } from './types';
import { ETIQUETAS_BASE } from './types';
import { backend } from './backend';
import { calcularAvisos } from './avisos';
import { todayISO, uid } from './fechas';

export const AJUSTES_BASE: Ajustes = {
  horaAviso: '08:00',
  notificaciones: true,
  autoInicio: true,
  tema: 'dark',
  acento: '#4ade80',
  tamano: 100,
  separadorCsv: ';',
  tutorialVisto: false
};

export const vacio = (): Datos => ({
  version: 3, importacion: null, bitacoras: [], etiquetas: ETIQUETAS_BASE.map(e => ({ ...e })),
  revisiones: [], pospuestos: [],
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
  const { semestralInicio: _v1, diaAvisoDefecto: _v2, ...aj } = raw.ajustes || {};
  d.ajustes = { ...AJUSTES_BASE, ...aj };
  d.etiquetas = Array.isArray(raw.etiquetas) && raw.etiquetas.length ? raw.etiquetas.filter((e: any) => e && e.id) : d.etiquetas;
  // v1 usaba prioridad (Urgente / Pendiente próximo / Al día): pasa a avance (Pendiente / En proceso / Listo)
  const renombre: Record<string, string> = { 'Urgente': 'Pendiente', 'Pendiente próximo': 'En proceso', 'Al día': 'Listo' };
  d.etiquetas = d.etiquetas.map(e => (renombre[e.nombre] ? { ...e, nombre: renombre[e.nombre] } : e));
  d.revisiones = Array.isArray(raw.revisiones) ? raw.revisiones : [];
  const imp = raw.importacion;
  d.importacion = imp && Array.isArray(imp.filas) && imp.filas.some((f: any) => f && f.resultado === 'pendiente')
    ? { archivo: String(imp.archivo || ''), inicio: String(imp.inicio || todayISO()), i: Math.max(0, Number(imp.i) || 0), filas: imp.filas }
    : null;
  d.pospuestos = Array.isArray(raw.pospuestos) ? raw.pospuestos.filter((p: any) => p && p.at > Date.now() - 864e5) : [];
  const estados: Estado[] = ['abierta', 'nueva', 'cierre', 'terminada'];
  const iso = (v: any) => /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null;
  const meses = (v: any) => Array.isArray(v) ? [...new Set<string>(v.filter((r: any) => /^\d{4}-\d{2}$/.test(r)))] : [];
  const vistos = new Set<string>();
  d.bitacoras = (Array.isArray(raw.bitacoras) ? raw.bitacoras : [])
    .filter((b: any) => b && String(b.numero || '').trim())
    .map((b: any): Bitacora => {
      let id = String(b.id || uid());
      if (vistos.has(id)) id = uid();          // ids repetidos ocultaban bitácoras en la lista
      vistos.add(id);
      return {
        id,
        numero: String(b.numero).toUpperCase().trim(),
        nombre: String(b.nombre || '').trim() || 'PROYECTO SIN NOMBRE',
        estado: estados.includes(b.estado) ? b.estado : 'abierta',
        etiquetaId: d.etiquetas.some(e => e.id === b.etiquetaId) ? b.etiquetaId : d.etiquetas[d.etiquetas.length - 1].id,
        apertura: iso(b.apertura) || iso(b.fechaInicio) || todayISO(),   // v1 guardaba «fechaInicio»
        notas: String(b.notas || ''),
        registros: meses(b.registros),
        inspecciones: meses(b.inspecciones),
        informes: Array.isArray(b.informes) ? [...new Set<string>(b.informes.filter(iso))] : [],
        archivada: !!b.archivada,
        archivadaEl: iso(b.archivadaEl),
        ultimaActualizacion: b.ultimaActualizacion || null,
        creada: iso(b.creada) || todayISO()
      };
    });
  return d;
}

// ---------- Persistencia ----------
let tGuardar: ReturnType<typeof setTimeout> | null = null;
let tProgramar: ReturnType<typeof setTimeout> | null = null;
export let errorGuardado: string | null = null;

function persistir() {
  if (tGuardar) clearTimeout(tGuardar);
  tGuardar = setTimeout(() => {
    const json = JSON.stringify(datos, null, 1);
    backend.guardar(json)
      .then(() => { errorGuardado = null; respaldoDiario(json); })
      .catch(e => { errorGuardado = String(e); console.error('No se pudo guardar', e); });
  }, 250);
}

// Un respaldo automático por día en <carpeta de datos>/respaldos (se guardan los 20 más recientes)
function respaldoDiario(json: string) {
  const hoy = todayISO();
  let ultimo = '';
  try { ultimo = localStorage.getItem('bt_ultimo_respaldo') || ''; } catch { /* sin storage */ }
  if (ultimo === hoy || !datos.bitacoras.length) return;
  backend.respaldo(`auto-${hoy}.json`, json)
    .then(() => { try { localStorage.setItem('bt_ultimo_respaldo', hoy); } catch { /* sin storage */ } })
    .catch(() => { /* opcional */ });
}

/** Restablecer de fábrica: deja un respaldo de seguridad y vuelve al estado inicial (tutorial incluido). */
export async function restablecerFabrica(): Promise<string | null> {
  let ruta: string | null = null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  try { ruta = await backend.respaldo(`antes-de-restablecer-${stamp}.json`, JSON.stringify(datos, null, 1)); } catch { /* opcional */ }
  pila.length = 0;
  datos = vacio();
  try { Object.keys(localStorage).filter(k => k.startsWith('bt_') && !k.startsWith('bt_respaldo_')).forEach(k => localStorage.removeItem(k)); } catch { /* sin storage */ }
  emitir(); persistir(); reprogramar();
  return ruta;
}

/** Vuelve a leer los datos del disco (tras cambiar de carpeta). */
export async function recargar() {
  let raw: any = null;
  try { const txt = await backend.cargar(); raw = txt ? JSON.parse(txt) : null; } catch { /* vacío */ }
  pila.length = 0;
  datos = normalizar(raw);
  emitir(); reprogramar();
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
  void e;   // todo empieza como «Pendiente» (rojo)
  const pref = ids.find(id => id === 'pendiente' || id === 'urgente');
  return pref ?? ids[0];
}

export type TareaMes = 'bitacora' | 'inspeccion';

/** Marca / desmarca el llenado de bitácora o la inspección de un mes. */
export function marcarMes(id: string, mk: string, tarea: TareaMes | 'ambas', on = true) {
  mutar(d => {
    const b = d.bitacoras.find(x => x.id === id);
    if (!b) return;
    const set = (arr: string[]) => on ? [...new Set([...arr, mk])] : arr.filter(r => r !== mk);
    if (tarea !== 'inspeccion') b.registros = set(b.registros);
    if (tarea !== 'bitacora') b.inspecciones = set(b.inspecciones);
    if (on) b.ultimaActualizacion = todayISO();
    if (b.registros.includes(mk) && b.inspecciones.includes(mk))
      d.pospuestos = d.pospuestos.filter(p => !(p.ref === id && p.key.startsWith(`m:${id}:${mk}`)));
  });
}

/** Marca / desmarca un informe regencial como entregado. */
export function marcarInforme(id: string, vence: string, on = true) {
  mutar(d => {
    const b = d.bitacoras.find(x => x.id === id);
    if (!b) return;
    b.informes = on ? [...new Set([...b.informes, vence])] : b.informes.filter(v => v !== vence);
    if (on) b.ultimaActualizacion = todayISO();
    d.pospuestos = d.pospuestos.filter(p => !p.key.startsWith(`i:${id}:${vence}`));
  });
}

/** Archiva / restaura una bitácora (sale de la lista activa y de los recordatorios, sin borrarse). */
export function archivar(id: string, on = true) {
  mutar(d => {
    const b = d.bitacoras.find(x => x.id === id);
    if (!b) return;
    b.archivada = on;
    b.archivadaEl = on ? todayISO() : null;
    if (on) d.pospuestos = d.pospuestos.filter(p => p.ref !== id);
  });
}
