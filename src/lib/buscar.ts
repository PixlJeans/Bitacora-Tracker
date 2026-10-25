// ===== Búsqueda de bitácoras =====
// Corrige el buscador anterior, que:
//  · comparaba con acentos/mayúsculas tal cual («urbanizacion» no encontraba «URBANIZACIÓN»),
//  · no buscaba en el estado ni aceptaba el número sin guiones o sin ceros («D1 170 2020»),
//  · y se combinaba en silencio con otros filtros (día del calendario, estado, color, «Pendientes»),
//    así que bitácoras existentes parecían no aparecer.
// Ahora cada palabra buscada debe aparecer en algún campo, sin importar acentos, mayúsculas ni guiones.
import type { Bitacora, Datos } from './types';
import { estadoNombre } from './types';

export const normalizar = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim();

/** Variantes del número para que coincida escrito de varias formas. */
function variantesNumero(numero: string): string[] {
  const n = normalizar(numero);
  const sinCeros = n.replace(/-0+(\d)/g, '-$1');             // d1-170-2020
  return [n, n.replace(/-/g, ''), n.replace(/-/g, ' '), sinCeros, sinCeros.replace(/-/g, ' '), sinCeros.replace(/-/g, '')];
}

export function textoBuscable(d: Datos, b: Bitacora): string {
  const et = d.etiquetas.find(e => e.id === b.etiquetaId)?.nombre ?? '';
  return normalizar([...variantesNumero(b.numero), b.nombre, estadoNombre(b.estado), b.estado, et, b.archivada ? 'archivada' : '', b.notas].join(' | '));
}

/** true si la bitácora coincide con TODAS las palabras de la consulta. */
export function coincide(d: Datos, b: Bitacora, consulta: string): boolean {
  const q = normalizar(consulta);
  if (!q) return true;
  const hay = textoBuscable(d, b);
  if (hay.includes(q)) return true;
  const tokens = q.split(' ').filter(Boolean);
  return tokens.every(t => hay.includes(t) || hay.includes(t.replace(/-/g, '')) || hay.includes(t.replace(/^0+/, '')));
}

export const buscar = (d: Datos, consulta: string) => d.bitacoras.filter(b => coincide(d, b, consulta));
