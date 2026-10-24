// ===== Extracción de bitácoras desde el texto de un PDF de SETENA (o texto pegado) =====
// Trabaja por líneas y tolera los formatos más comunes:
//   · tabla:      "D1-0170-2020   CONDOMINIO VISTA DEL BOSQUE   Abierta"
//   · flecha:     "D1-0170-2020 → CONDOMINIO VISTA DEL BOSQUE"
//   · secciones:  un encabezado "Solicitud de Cierre" seguido de la lista de bitácoras
//   · nombres partidos en dos líneas (la línea siguiente, sin número, continúa el nombre)
// Cada resultado lleva `dudas` cuando algo no quedó claro, para revisarlo en la vista previa.

import type { Estado } from './types';

export interface Extraida {
  numero: string;
  nombre: string;
  estado: Estado;
  estadoDetectado: boolean;
  dudas: string[];
}

const RE_NUM = /\b([A-Z]{1,3}\d{0,2})\s*[-–—‐]\s*(\d{1,6})\s*[-–—‐]\s*((?:19|20)\d{2})\b/gi;
const RE_ESTADO = /solicitud\s+de\s+cierre|sol\.?\s*(?:de\s+)?cierre|en\s+cierre|abiertas?|nuevas?/i;

export function normalizarNumero(raw: string): string {
  const m = new RegExp(RE_NUM.source, 'i').exec(raw.trim());
  if (!m) return raw.trim().toUpperCase().replace(/\s+/g, '');
  return `${m[1].toUpperCase()}-${m[2].padStart(4, '0')}-${m[3]}`;
}

export const numeroValido = (n: string) => /^[A-Z]{1,3}\d{0,2}-\d{4,6}-(19|20)\d{2}$/.test(n);

export function estadoDe(txt: string): Estado | null {
  const m = RE_ESTADO.exec(txt);
  if (!m) return null;
  const s = m[0].toLowerCase();
  if (s.includes('cierre')) return 'cierre';
  if (s.startsWith('nueva')) return 'nueva';
  return 'abierta';
}

const quitarAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Limpia el nombre: separadores, fechas sueltas, el estado y encabezados de tabla. */
export function limpiarNombre(s: string): string {
  return s
    .replace(new RegExp(RE_ESTADO.source, 'gi'), ' ')
    .replace(/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g, ' ')          // fechas 12/03/2020
    .replace(/[→⇒➔|•·;:\t]+/g, ' ')
    .replace(/^\s*[-–—=>]+\s*/, '')
    .replace(/\s*[-–—]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.]+|[\s,.]+$/g, '')
    .trim();
}

const ES_ENCABEZADO = (l: string) => {
  const s = quitarAcentos(l).toLowerCase();
  return /\b(numero|n[º°o]\.?\s*de\s*bitacora|expediente)\b/.test(s) && /\b(proyecto|nombre|estado)\b/.test(s);
};

const RUIDO = (l: string) => {
  const s = quitarAcentos(l).toLowerCase().trim();
  return !s || /^p(agina|ag\.?)\s*\d+/.test(s) || /^\d+\s*(de|\/)\s*\d+$/.test(s) || /^\d+$/.test(s) ||
    /secretaria tecnica nacional ambiental|setena|ministerio de ambiente|^fecha( de)? (impresion|emision|reporte)/.test(s);
};

export function extraerBitacoras(texto: string): Extraida[] {
  const lineas = texto.replace(/\r/g, '').split('\n').map(l => l.replace(/ /g, ' ').trim());
  const out: Extraida[] = [];
  const vistos = new Map<string, Extraida>();
  let seccion: Estado | null = null;
  let ultima = null as Extraida | null;

  for (const linea of lineas) {
    if (!linea || RUIDO(linea) || ES_ENCABEZADO(linea)) { if (!linea) ultima = null; continue; }
    const matches = [...linea.matchAll(new RegExp(RE_NUM.source, 'gi'))];

    if (!matches.length) {
      const est = estadoDe(linea);
      const palabras = linea.split(/\s+/).length;
      // Encabezado de sección: "BITÁCORAS ABIERTAS", "Solicitud de Cierre", "Estado: Nueva"
      if (est && palabras <= 6 && limpiarNombre(linea.replace(/bit[aá]coras?|estado|proyectos?/gi, '')).length <= 3) {
        if (ultima && !ultima.estadoDetectado && ultima === out[out.length - 1] && palabras <= 3 && !/bit[aá]cora/i.test(linea)) {
          // estado en la línea siguiente a la bitácora (celda partida)
          ultima.estado = est; ultima.estadoDetectado = true; ultima.dudas = ultima.dudas.filter(d => !d.startsWith('Estado'));
        } else {
          seccion = est;
        }
        continue;
      }
      // Continuación del nombre en la línea siguiente
      if (ultima && linea.length < 90 && /[A-ZÁÉÍÓÚÑ]/.test(linea) && linea === linea.toUpperCase()) {
        const extra = limpiarNombre(linea);
        if (extra) ultima.nombre = (ultima.nombre + ' ' + extra).trim();
        if (est && !ultima.estadoDetectado) { ultima.estado = est; ultima.estadoDetectado = true; }
      }
      continue;
    }

    matches.forEach((m, i) => {
      const numero = `${m[1].toUpperCase()}-${m[2].padStart(4, '0')}-${m[3]}`;
      const ini = (m.index ?? 0) + m[0].length;
      const fin = i + 1 < matches.length ? matches[i + 1].index ?? linea.length : linea.length;
      const resto = linea.slice(ini, fin);
      const antes = i === 0 ? linea.slice(0, m.index) : '';
      const estLinea = estadoDe(resto) ?? estadoDe(antes);
      const nombre = limpiarNombre(resto) || limpiarNombre(antes);
      const dudas: string[] = [];
      if (!nombre) dudas.push('Sin nombre de proyecto: complétalo');
      if (!estLinea && !seccion) dudas.push('Estado no encontrado: se asumió «Abierta»');
      if (!/^D1-/.test(numero)) dudas.push('El número no empieza con D1-');

      const prev = vistos.get(numero);
      if (prev) {               // repetida: completa lo que falte
        if (!prev.nombre && nombre) prev.nombre = nombre;
        if (!prev.estadoDetectado && (estLinea || seccion)) { prev.estado = (estLinea || seccion)!; prev.estadoDetectado = true; }
        ultima = prev;
        return;
      }
      const e: Extraida = {
        numero, nombre,
        estado: estLinea ?? seccion ?? 'abierta',
        estadoDetectado: !!(estLinea || seccion),
        dudas
      };
      vistos.set(numero, e);
      out.push(e);
      ultima = e;
    });
  }
  // recalcula dudas de nombre (pudo completarse con la línea siguiente)
  out.forEach(e => { if (e.nombre) e.dudas = e.dudas.filter(d => !d.startsWith('Sin nombre')); });
  return out;
}
