// ===== Project row =====
// One line per project:  Code · Project · 🚗 Inspección · 📋 Bitácora · 🗂️ Regencia · Status
// Each task cell shows the oldest one still pending (all on the opening day unless moved), how many are
// behind, and a ✓ to check it off. Click anywhere else on the row to open the project.
import { useState } from 'react';
import type { Project, AppData, Status } from '../lib/types';
import { STATUSES, statusName, isActiveProject, isFinished } from '../lib/types';
import { inClosure, closureNext } from '../lib/closure';
import { taskColumns, type TaskColumn, type TaskKind } from '../lib/schedule';
import { daysUntil, daysText } from './Delivery';
import { shortDate, monthNameOf, todayISO } from '../lib/dates';
import { archive, markStep, mutate } from '../lib/store';
import { Ic, Popover, toast } from './core';
import { openEditor } from './ProjectEditor';
import { agoText, daysSince } from '../lib/setenaInfo';

export type Mode = { type: 'normal' } | { type: 'month'; mk: string } | { type: 'regencia' };

export function RowHeader() {
  return (
    <div className="prow3-h" aria-hidden>
      <span>Código</span><span>Proyecto</span><span>🚗 Inspección</span><span>📋 Bitácora</span><span>🗂️ Regencia</span><span>Estado</span><span />
    </div>
  );
}

const KIND: Record<TaskKind, { name: string; step: 'visit' | 'uploaded'; help: string }> = {
  inspection: { name: 'Inspección', step: 'visit', help: 'La visita al proyecto, cada mes, el mismo día de la apertura (se puede mover). Muestra la más antigua que falta.' },
  bitacora: { name: 'Bitácora', step: 'uploaded', help: 'La bitácora del mes presentada a SETENA, el mismo día de la apertura (se puede mover). Muestra la más antigua que falta.' },
  regencia: { name: 'Regencia', step: 'uploaded', help: 'La Regencia cada 6 meses, el mismo día de la apertura (se puede mover).' }
};

function TaskCell({ b, kind, c }: { b: Project; kind: TaskKind; c: TaskColumn }) {
  const today = todayISO();
  const t = c.next;
  if (!t) return <span className="c-task done-all" title="Todo al día"><span className="c-task-txt"><b>✓ al día</b></span></span>;
  const k = KIND[kind];
  const label = kind === 'regencia' ? '' : monthNameOf(t.key.slice(2)).replace(/ de /, ' ');
  return (
    <span className={`c-task ${t.overdue ? 'overdue' : ''} ${kind === 'regencia' ? 'reg' : ''}`} data-help-title={k.name} data-help={k.help}>
      <span className="c-task-txt">
        <b>{shortDate(t.date)}{t.date.slice(0, 4) !== today.slice(0, 4) ? ` ${t.date.slice(2, 4)}` : ''}</b>
        <small>{c.behind > 1 ? `${c.behind} atrasadas` : label || daysText(daysUntil(t.date, today))}</small>
      </span>
      <button className="ck" title={`Marcar hecha: ${k.name}${label ? ' de ' + label : ''} (${shortDate(t.date)})`}
        onClick={ev => { ev.stopPropagation(); const d = t.date <= today ? t.date : today; markStep(b.id, t.key, k.step, d);
          toast(`✓ ${b.code}: ${k.name}${label ? ' ' + label : ''}`, true); }}><Ic n="check" size={13} /></button>
    </span>
  );
}

export function ProjectRow({ d: _d, b, data }: { d: AppData; b: Project; mode?: Mode; data?: string }) {
  const today = todayISO();
  const [pop, setPop] = useState<HTMLElement | null>(null);
  const active = isActiveProject(b);
  const cols = taskColumns(b, today);
  const late = (['inspection', 'bitacora', 'regencia'] as TaskKind[]).some(k => cols[k].next?.overdue);

  function changeStatus(st: Status) {
    mutate(dd => { const x = dd.projects.find(y => y.id === b.id); if (x) x.status = st; });
    setPop(null);
    toast(`${b.code} → ${statusName(st)}` + (isFinished(st) ? ' · ya no genera entregas; ciérrala con 📦' : ''), true);
  }
  const stop = (ev: { stopPropagation(): void }) => ev.stopPropagation();

  return (
    <div className={`prow3 status-${b.status} ${b.archived ? 'archived' : ''} ${late ? 'late' : ''}`} data-tour={data}
      onClick={() => openEditor(b)} title="Abrir el proyecto">
      <span className="c-code mono">{b.code}</span>
      <span className="c-name" title={b.name}>
        <span className="c-name-t">{b.name}</span>
        {b.setena && <SetenaActivity b={b} />}
      </span>

      {active && b.noOpeningDate ? (
        <span className="c-missing" title="El PDF no traía la fecha de apertura: ábrelo para ponerla">📅 Falta la fecha de apertura · clic para ponerla</span>
      ) : active ? <>
        <TaskCell b={b} kind="inspection" c={cols.inspection} />
        <TaskCell b={b} kind="bitacora" c={cols.bitacora} />
        <TaskCell b={b} kind="regencia" c={cols.regencia} />
      </> : <span className={`c-task na wide ${inClosure(b) ? 'cz-next' : ''}`}>{b.archived ? 'Archivada' : inClosure(b) ? `🔒 ${closureNext(b)?.text ?? 'Cerrado'}` : b.status === 'resigned' ? 'Renuncia: sin entregas' : 'Terminada: sin entregas'}</span>}

      <button className={`status-chip status-${b.status}`} title="Cambiar estado" onClick={ev => { stop(ev); setPop(ev.currentTarget); }}
        data-help-title="Estado" data-help="Estado en SETENA. Solicitud de Cierre ya no genera entregas mensuales: tiene sus pasos de cierre (informe final, aprobación, devolución de la garantía).">{STATUSES.find(s => s.id === b.status)?.short}</button>

      <span className="c-acc" onClick={stop}>
        {(isFinished(b.status) || b.archived) && (
          <button className="icon-btn sm" title={b.archived ? 'Restaurar a la lista' : 'Archivar (sale de la lista, no se borra)'}
            onClick={() => { archive(b.id, !b.archived); toast(b.archived ? `${b.code} restaurada` : `📦 ${b.code} archivada`, true); }}>
            <Ic n={b.archived ? 'upload' : 'download'} /></button>
        )}
      </span>

      {pop && (
        <span onClick={stop}>
        <Popover anchor={pop} onClose={() => setPop(null)} width={220}><>
          <div className="pop-title">Estado de {b.code}</div>
          {STATUSES.map(s => (
            <button key={s.id} className={`pop-opt status-${s.id} ${b.status === s.id ? 'on' : ''}`} onClick={() => changeStatus(s.id)}>
              <span className={`status-dot status-${s.id}`} />{s.name}{b.status === s.id && <Ic n="check" size={14} />}
            </button>))}
        </></Popover>
        </span>
      )}
    </div>
  );
}

/** Under the name: when this project was last written in SETENA (red after a month without entries). */
function SetenaActivity({ b }: { b: Project }) {
  const s = b.setena!, today = todayISO();
  const quiet = isActiveProject(b) && b.status === 'open' && !s.participationClosed && (!s.lastEntry || daysSince(s.lastEntry, today) > 35);
  return (
    <small className={`c-setena ${quiet ? 'quiet' : ''}`} title={`SETENA: ${s.entries} anotaciones${s.avance !== null ? ` · avance ${s.avance}%` : ''} (leído el ${s.readAt.slice(0, 10)})`}>
      {s.avance !== null && <span className="c-av" title={`avance ${s.avance}%`}><i style={{ width: `${s.avance}%` }} /></span>}
      <span className="c-st">🌐 {s.lastEntry ? `última anotación ${shortDate(s.lastEntry)}${s.lastEntry.slice(0, 4) !== today.slice(0, 4) ? ' ' + s.lastEntry.slice(0, 4) : ''} · ${agoText(s.lastEntry, today)}` : 'sin anotaciones en SETENA'}</span>
    </small>
  );
}
