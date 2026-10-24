// ===== Exportar a CSV (se abre directo en Excel: UTF-8 con BOM) =====
import type { Datos } from './types';
import { estadoNombre } from './types';
import { fechaMensual, registradoEn } from './avisos';
import { todayISO } from './fechas';

export function aCsv(d: Datos): string {
  const sep = d.ajustes.separadorCsv || ';';
  const q = (v: unknown) => {
    const s = String(v ?? '');
    return /["\n\r;,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const mk = todayISO().slice(0, 7);
  const et = (id: string) => d.etiquetas.find(e => e.id === id)?.nombre ?? '';
  const cab = ['Número', 'Proyecto', 'Estado', 'Color / prioridad', 'Día de aviso mensual', 'Próximo aviso',
    'Fecha de inicio', 'Última actualización', 'Registrado este mes', 'Meses registrados', 'Notas'];
  const filas = d.bitacoras.map(b => [
    b.numero, b.nombre, estadoNombre(b.estado), et(b.etiquetaId), b.diaAviso,
    b.estado === 'cierre' ? '—' : fechaMensual(b, mk), b.fechaInicio, b.ultimaActualizacion ?? '',
    b.estado === 'cierre' ? 'N/A' : registradoEn(b, mk) ? 'Sí' : 'No',
    [...b.registros].sort().join(' '), b.notas
  ]);
  return '﻿' + [cab, ...filas].map(f => f.map(q).join(sep)).join('\r\n') + '\r\n';
}
