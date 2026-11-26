// ===== CSV export (opens straight in Excel: UTF-8 with BOM) =====
import type { AppData } from './types';
import { statusName, isActiveProject } from './types';
import { monthlyDue, visitedIn, nextDue, nextRegencia, uploadedIn } from './schedule';
import { fromISO, todayISO } from './dates';

export function toCsv(d: AppData): string {
  const separator = d.settings.csvSeparator || ';';
  const q = (v: unknown) => {
    const s = String(v ?? '');
    return /["\n\r;,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const today = todayISO(), mk = today.slice(0, 7);
  const et = (id: string) => d.labels.find(e => e.id === id)?.name ?? '';
  const cab = ['Número', 'Proyecto', 'Estado', 'Avance', 'Archivada', 'Fecha de apertura', 'Día del Informe Regencial', 'Informe Regencial de este mes',
    'Subido este mes', 'Visita este mes', 'Próxima entrega pendiente', 'Próxima Regencia', 'Estado de la Regencia',
    'Regencias subidas', 'Meses subidos', 'Meses con visita', 'Latitud', 'Longitud', 'Notas'];
  const rows = d.projects.map(b => {
    const regInfo = nextRegencia(b, today), act = isActiveProject(b);
    return [
      b.code, b.name, statusName(b.status), et(b.labelId), b.archived ? 'Sí' : 'No', b.openedOn,
      act ? fromISO(b.openedOn).getDate() : '—', act ? monthlyDue(b, mk) : '—',
      act ? (uploadedIn(b, mk) ? 'Sí' : 'No') : 'N/A', act ? (visitedIn(b, mk) ? 'Sí' : 'No') : 'N/A',
      nextDue(b, today)?.date ?? '', regInfo?.due ?? '', regInfo ? { overdue: 'Vencido', dueSoon: 'En aviso', future: 'Próximo' }[regInfo.status] : '',
      [...b.regencias].sort().join(' '), [...b.uploads].sort().join(' '), [...b.visits].sort().join(' '), b.location?.lat ?? '', b.location?.lng ?? '', b.notes
    ];
  });
  return '\ufeff' + [cab, ...rows].map(f => f.map(q).join(separator)).join('\r\n') + '\r\n';
}
