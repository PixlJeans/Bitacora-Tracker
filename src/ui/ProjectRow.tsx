// ===== Project row =====
// One line per project:  Code · Project · 🚗 Inspección · 📤 Informe · Status
// Both cells show the most urgent pending delivery (the month's Informe Regencial, or a Regencia): the
// inspection's date (scheduled, or its last day = 7 days before the informe) and the informe's due date,
// each with a ✓ button. Click anywhere else on the row to open the project.
import { useState } from 'react';
import type { Project, AppData, Status } from '../lib/types';
import { STATUSES, statusName, isActiveProject, isFinished } from '../lib/types';
import { nextDue, inspectionDeadline } from '../lib/schedule';
import { daysUntil, daysText } from './Delivery';
import { shortDate, monthNameOf, todayISO } from '../lib/dates';
import { archive, markStep, mutate } from '../lib/store';
import { Ic, Popover, toast } from './core';
import { openEditor } from './ProjectEditor';

export type Mode = { type: 'normal' } | { type: 'month'; mk: string } | { type: 'regencia' };

export function RowHeader() {
  return (
    <div className="prow3-h" aria-hidden>
      <span>Código</span><span>Proyecto</span><span>🚗 Inspección</span><span>📤 Informe</span><span>Estado</span><span />
    </div>
  );
}

export function ProjectRow({ d: _d, b, data }: { d: AppData; b: Project; mode?: Mode; data?: string }) {
  const today = todayISO();
  const [pop, setPop] = useState<HTMLElement | null>(null);
  const active = isActiveProject(b);
  const pf = active ? nextDue(b, today) : null;
  const e = pf ? b.deliveries?.[pf.key] : undefined;
  const monthly = pf?.type === 'monthly';
  const visited = pf ? (monthly ? b.visits.includes(pf.key.slice(2)) : !!e?.visit) : false;
  const inspDate = pf ? (e?.planned ?? inspectionDeadline(pf.date)) : null;
  const inspLate = !!pf && !visited && today > inspDate!;
  const what = pf ? (monthly ? `Informe ${monthNameOf(pf.key.slice(2)).split(' ')[0].toLowerCase()}` : 'Regencia') : '';

  function changeStatus(st: Status) {
    mutate(dd => { const x = dd.projects.find(y => y.id === b.id); if (x) x.status = st; });
    setPop(null);
    toast(`${b.code} → ${statusName(st)}` + (isFinished(st) ? ' · ya no genera entregas; ciérrala con 📦' : ''), true);
  }
  const mark = (step: 'visit' | 'uploaded', on: boolean) => {
    if (!pf) return;
    markStep(b.id, pf.key, step, on ? today : null);
    toast(on ? `✓ ${b.code}: ${step === 'visit' ? 'inspección hecha' : `${what} presentado`}` : `${b.code}: desmarcado`, true);
  };
  const stop = (ev: { stopPropagation(): void }) => ev.stopPropagation();

  return (
    <div className={`prow3 status-${b.status} ${b.archived ? 'archived' : ''} ${pf?.overdue || inspLate ? 'late' : ''}`} data-tour={data}
      onClick={() => openEditor(b)} title="Abrir el proyecto">
      <span className="c-code mono">{b.code}</span>
      <span className="c-name" title={b.name}>{b.name}</span>

      {active && b.noOpeningDate ? (
        <span className="c-missing" title="El PDF no traía la fecha de apertura: ábrelo para ponerla">📅 Falta la fecha de apertura · clic para ponerla</span>
      ) : <>
      {/* Inspección */}
      {pf ? (
        <span className={`c-task ${visited ? 'done' : inspLate ? 'overdue' : ''}`} data-tour={data ? 'monthly' : undefined}
          data-help-title="Inspección" data-help="La visita al proyecto: al menos 7 días antes del informe. Muestra el día programado (🗓) o el último día para hacerla (≤). ✓ cuando la hiciste.">
          <span className="c-task-txt">
            {visited ? <b>Hecha</b> : <b>{e?.planned ? '🗓 ' : '≤ '}{shortDate(inspDate!)}</b>}
            <small>{visited ? (e?.visit ? shortDate(e.visit) : '') : daysText(daysUntil(inspDate!, today))}</small>
          </span>
          <button className={`ck ${visited ? 'on' : ''}`} title={visited ? 'Desmarcar inspección' : 'Marcar inspección hecha hoy'} onClick={ev => { stop(ev); mark('visit', !visited); }}><Ic n="check" size={13} /></button>
        </span>
      ) : <span className="c-task na">—</span>}

      {/* Informe (or Regencia) */}
      {pf ? (
        <span className={`c-task ${pf.overdue ? 'overdue' : ''} ${monthly ? '' : 'reg'}`}
          data-help-title="Informe" data-help="El Informe Regencial del mes (o la Regencia semestral, en morado) que hay que presentar a SETENA, con su fecha. ✓ cuando lo presentaste.">
          <span className="c-task-txt">
            <b>{shortDate(pf.date)}{pf.date.slice(0, 4) !== today.slice(0, 4) ? ` ${pf.date.slice(2, 4)}` : ''}</b>
            <small>{what} · {daysText(pf.days)}</small>
          </span>
          <button className="ck" title={`Marcar ${what} presentado hoy`} onClick={ev => { stop(ev); mark('uploaded', true); }}><Ic n="check" size={13} /></button>
        </span>
      ) : <span className="c-task na">{b.archived ? 'Archivada' : '—'}</span>}
      </>}

      <button className={`status-chip status-${b.status}`} title="Cambiar estado" onClick={ev => { stop(ev); setPop(ev.currentTarget); }}
        data-help-title="Estado" data-help="Estado en SETENA. Solicitud de Cierre y Terminada ya no generan entregas.">{STATUSES.find(s => s.id === b.status)?.short}</button>

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
