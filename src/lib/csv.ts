// ===== Exportar a CSV (se abre directo en Excel: UTF-8 con BOM) =====
import type { Datos } from './types';
import { estadoNombre, estaActiva } from './types';
import { fechaMensual, inspeccionadoEn, proximoInforme, registradoEn, siguienteMensual } from './avisos';
import { fromISO, todayISO } from './fechas';

export function aCsv(d: Datos): string {
  const sep = d.ajustes.separadorCsv || ';';
  const q = (v: unknown) => {
    const s = String(v ?? '');
    return /["\n\r;,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const hoy = todayISO(), mk = hoy.slice(0, 7);
  const et = (id: string) => d.etiquetas.find(e => e.id === id)?.nombre ?? '';
  const cab = ['Número', 'Proyecto', 'Estado', 'Avance', 'Archivada', 'Fecha de apertura', 'Día de revisión mensual', 'Revisión de este mes',
    'Bitácora este mes', 'Inspección este mes', 'Próxima revisión pendiente', 'Próximo informe regencial', 'Estado del informe',
    'Informes entregados', 'Meses con bitácora', 'Meses con inspección', 'Notas'];
  const filas = d.bitacoras.map(b => {
    const inf = proximoInforme(b, hoy), act = estaActiva(b);
    return [
      b.numero, b.nombre, estadoNombre(b.estado), et(b.etiquetaId), b.archivada ? 'Sí' : 'No', b.apertura,
      act ? fromISO(b.apertura).getDate() : '—', act ? fechaMensual(b, mk) : '—',
      act ? (registradoEn(b, mk) ? 'Sí' : 'No') : 'N/A', act ? (inspeccionadoEn(b, mk) ? 'Sí' : 'No') : 'N/A',
      siguienteMensual(b, hoy)?.fecha ?? '', inf?.vence ?? '', inf ? { vencido: 'Vencido', aviso: 'En aviso', futuro: 'Próximo' }[inf.estado] : '',
      [...b.informes].sort().join(' '), [...b.registros].sort().join(' '), [...b.inspecciones].sort().join(' '), b.notas
    ];
  });
  return '\ufeff' + [cab, ...filas].map(f => f.map(q).join(sep)).join('\r\n') + '\r\n';
}
