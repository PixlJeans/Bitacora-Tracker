// ===== Project row (tabs) =====
// One line per project, in columns:
//   Progress · Code · Name · Next date · Status · I · Inf · Regencia · Edit
//   I = inspection (site visit) for the month · Inf = Informe Regencial presented to SETENA · Regencia = semiannual one presented
// The delivery calendar lives INSIDE the editor (see ProjectCalendar.tsx).
import { useState } from 'react';
import type { Project, AppData, Status } from '../lib/types';
import { STATUSES, statusName, isActiveProject, isFinished } from '../lib/types';
import { monthlyDue, regenciaSubmitted, visitedIn, nextDue, nextRegencia, uploadedIn, dueInMonth, inspectionDeadline } from '../lib/schedule';
import { StepsMini, daysUntil, daysText } from './Delivery';
import { shortDate, monthNameOf, todayISO } from '../lib/dates';
import { archive, markRegencia, markMonth, mutate } from '../lib/store';
import { Ic, Popover, toast } from './core';
import { openEditor, deleteProject } from './ProjectEditor';

export type Mode = { type: 'normal' } | { type: 'month'; mk: string } | { type: 'regencia' };

export function RowHeader() {
  return (
    <div className="prow-h" aria-hidden>
      <span>Avance</span><span>Código</span><span>Proyecto</span><span>Próxima fecha</span><span>Estado</span>
      <span title="Inspección (visita al proyecto), al menos 7 días antes del informe">I</span><span title="Informe Regencial presentado a SETENA">Inf</span><span>Regencia</span><span />
    </div>
  );
}

export function ProjectRow({ d, b, mode: mode = { type: 'normal' }, data }: { d: AppData; b: Project; mode?: Mode; data?: string }) {
  const today = todayISO();
  const [pop, setPop] = useState<{ el: HTMLElement; type: 'avance' | 'status' } | null>(null);
  const et = d.labels.find(e => e.id === b.labelId);
  const active = isActiveProject(b);
  const regInfo = nextRegencia(b, today);
  const pf = nextDue(b, today);

  // Month that V and S refer to: the tab's, or the month of the next pending delivery (or the current one)
  const mk = mode.type === 'month' ? mode.mk : (pf?.type === 'monthly' && pf.key.slice(2) <= today.slice(0, 7) ? pf.key.slice(2) : today.slice(0, 7));
  const monthApplies = active && dueInMonth(b, mk);
  const uploaded = uploadedIn(b, mk), visited = visitedIn(b, mk);

  // Next date: the most urgent pending delivery (Informe Regencial or Regencia), or the tab's
  type Kind = 'Inf. Regencial' | 'Regencia';
  let date: { f: string; type: Kind; overdue: boolean; key: string } | null = null;
  if (active) {
    if (mode.type === 'month') date = { f: monthlyDue(b, mode.mk), type: 'Inf. Regencial', overdue: monthlyDue(b, mode.mk) < today && !(uploaded && visited), key: `m:${mode.mk}` };
    else if (mode.type === 'regencia' && regInfo) date = { f: regInfo.due, type: 'Regencia', overdue: regInfo.status === 'overdue', key: `r:${regInfo.key}` };
    else {
      const p = pf;
      if (p) date = { f: p.date, type: p.type === 'monthly' ? 'Inf. Regencial' : 'Regencia', overdue: p.overdue, key: p.key };
    }
  }
  const done = mode.type === 'month' && uploaded && visited;

  const set = (f: (x: Project) => void, msg: string) => {
    mutate(dd => { const x = dd.projects.find(y => y.id === b.id); if (x) f(x); });
    setPop(null); toast(msg, true);
  };
  function changeStatus(e: Status) {
    set(x => { x.status = e; }, `${b.code} → ${statusName(e)}`);
    if (isFinished(e)) setTimeout(() => toast(`${b.code}: ${e === 'closing' ? 'en cierre, ya terminó' : 'terminada'} — sin entregas. Ciérrala con 📦.`), 50);
  }

  const toUpload = b.entries.filter(a => !a.uploaded).length;
  const submitted = regInfo ? regenciaSubmitted(b, regInfo.key) : false;

  return (
    <div className={`prow2 status-${b.status} ${b.archived ? 'archived' : ''} ${date?.overdue ? 'late' : ''}`} style={{ ['--ec' as any]: et?.color ?? '#888' }} data-tour={data}>
      <button className="progress-chip" data-tour={data ? 'progress' : undefined} data-help-title="Avance" data-help="Tu semáforo de trabajo: Pendiente (rojo), En proceso (amarillo) o Listo (verde). Clic para cambiarlo. Nombres y colores se editan en Ajustes." title="Avance (clic para cambiar)" onClick={ev => setPop({ el: ev.currentTarget, type: 'avance' })}><i />{et?.name ?? '—'}</button>
      <span className="c-code mono" data-help-title="Código" data-help="Número de bitácora de SETENA (D1-XXXX-AAAA). Clic para abrir el proyecto." onClick={() => openEditor(b)}>{b.code}</span>
      <span className="c-name" data-help-title="Proyecto" data-help="Nombre del proyecto. Clic para abrirlo: datos, calendario de revisiones y su bitácora con fotos y notas." onClick={() => openEditor(b)} title={b.name}>{b.name}{toUpload > 0 && <span className="c-photos" title="Anotaciones con fotos o notas que faltan subir a SETENA"
        onClick={ev => { ev.stopPropagation(); openEditor(b, undefined, 'log'); }}>⬆ {toUpload} por subir</span>}</span>
      <span className={`c-date ${date?.overdue ? 'overdue' : ''} ${date?.type === 'Regencia' ? 'reg' : ''}`} title={date ? `${date.type}: ${date.f}` : ''} data-help-title="Próxima fecha" data-help="Lo más urgente que falta: el Informe Regencial del mes o la Regencia semestral. La lista se ordena por esta fecha (lo vencido arriba). En rojo si ya pasó. Debajo: 🚗 la inspección (programada, o el último día para hacerla: 7 días antes del informe). Los iconos 🚗📤 se marcan al hacer la inspección y presentar el informe.">
        {date ? <><b>{shortDate(date.f)}{date.f.slice(0, 4) !== today.slice(0, 4) ? ` ${date.f.slice(0, 4)}` : ''}</b>
          <small>{date.type}{done ? ' · lista' : ` · ${daysText(daysUntil(date.f, today))}`}</small>
          <StepsMini b={b} itemKey={date.key} />
          {date.key && !b.deliveries?.[date.key]?.visit && (b.deliveries?.[date.key]?.planned
            ? <small className="ag-planned" title="Inspección programada">🚗 insp. {shortDate(b.deliveries[date.key].planned!)}</small>
            : <small className={`ag-planned ${today > inspectionDeadline(date.f) ? 'red-t' : ''}`} title="Último día para la inspección (7 días antes del informe)">🚗 insp. ≤ {shortDate(inspectionDeadline(date.f))}</small>)}</> : <small className="muted">{b.archived ? 'Archivada' : '—'}</small>}
      </span>
      <button className={`status-chip status-${b.status}`} data-help-title="Estado" data-help="Estado en SETENA: Nueva, Abierta, Solicitud de Cierre o Terminada. Las de Solicitud de Cierre y Terminadas ya no generan revisiones." title="Cambiar estado" onClick={ev => setPop({ el: ev.currentTarget, type: 'status' })}>{STATUSES.find(s => s.id === b.status)?.short}</button>
      {monthApplies ? <>
        <button className={`ck ${visited ? 'on' : ''}`} data-tour={data ? 'monthly' : undefined} data-help-title="I · Inspección" data-help="Márcalo cuando hiciste la inspección (visita al proyecto). Debe ser al menos 7 días antes del informe. La fecha se puede programar y corregir dentro del proyecto." title={`Inspección · ${monthNameOf(mk)}`}
          onClick={() => { markMonth(b.id, mk, 'visit', !visited); toast(visited ? `${b.code}: inspección desmarcada` : `✓ ${b.code}: inspección de ${monthNameOf(mk)}`, true); }}><Ic n="check" size={13} /></button>
        <button className={`ck ${uploaded ? 'on' : ''}`} data-help-title="Inf · Informe" data-help="Márcalo cuando presentaste el Informe Regencial del mes en SETENA. Con I e Inf marcadas el mes queda completo y se apagan los avisos." title={`Informe a SETENA · ${monthNameOf(mk)}`}
          onClick={() => { markMonth(b.id, mk, 'upload', !uploaded); toast(uploaded ? `${b.code}: informe desmarcado` : `✓ ${b.code}: Informe Regencial de ${monthNameOf(mk)} presentado`, true); }}><Ic n="check" size={13} /></button>
      </> : <><span className="ck na">—</span><span className="ck na">—</span></>}
      {regInfo ? (
        <button className={`ent st-${regInfo.status} ${submitted ? 'on' : ''}`} data-help-title="Regencia" data-help="Regencia semestral (cada 6 meses desde la apertura). Clic cuando ya la subiste; los avisos empiezan 1 mes antes de que venza." title={`Regencia del ${regInfo.due} (avisos desde ${regInfo.from})`}
          onClick={() => { markRegencia(b.id, regInfo.key, true); toast(`✓ ${b.code}: Regencia del ${shortDate(regInfo.due)} presentada`, true); }}>
          <Ic n="check" size={12} />Presentada</button>
      ) : <span className="ent na">—</span>}
      <span className="c-acc">
        {(isFinished(b.status) || b.archived) && (
          <button className="icon-btn sm" data-help-title="Archivar" data-help="Saca el proyecto terminado de la lista sin borrarlo; queda en la pestaña Archivadas con todo su historial." title={b.archived ? 'Restaurar a la lista activa' : 'Archivar (sale de la lista, no se borra)'}
            onClick={() => { archive(b.id, !b.archived); toast(b.archived ? `${b.code} restaurada` : `📦 ${b.code} archivada`, true); }}>
            <Ic n={b.archived ? 'upload' : 'download'} /></button>
        )}
        <button className="icon-btn sm del" data-help-title="Eliminar" data-help="Borra el proyecto de la lista (pide confirmación y se puede deshacer). Si solo terminó, mejor archívalo." title="Eliminar proyecto" onClick={() => deleteProject(b)}><Ic n="trash" /></button>
        <button className="icon-btn sm" data-help-title="Editar" data-help="Abre el proyecto: sus datos y ubicación, el calendario de entregas con sus pasos y la carta, y su bitácora con fotos y notas." title="Editar y ver su calendario" onClick={() => openEditor(b)}><Ic n="edit" /></button>
      </span>

      {pop && (
        <Popover anchor={pop.el} onClose={() => setPop(null)} width={220}>
          {pop.type === 'avance' ? <>
            <div className="pop-title">Avance de {b.code}</div>
            {d.labels.map(e => (
              <button key={e.id} className={`pop-opt ${b.labelId === e.id ? 'on' : ''}`} style={{ ['--ec' as any]: e.color }}
                onClick={() => set(x => { x.labelId = e.id; }, `${b.code} → ${e.name}`)}>
                <span className="dot" />{e.name}{b.labelId === e.id && <Ic n="check" size={14} />}
              </button>))}
          </> : <>
            <div className="pop-title">Estado de {b.code}</div>
            {STATUSES.map(s => (
              <button key={s.id} className={`pop-opt status-${s.id} ${b.status === s.id ? 'on' : ''}`} onClick={() => changeStatus(s.id)}>
                <span className={`status-dot status-${s.id}`} />{s.name}{b.status === s.id && <Ic n="check" size={14} />}
              </button>))}
            <small className="pop-hint">Las entregas se calculan solas desde la apertura. «Solicitud de Cierre» y «Terminada» las detienen; luego archívala con 📦.</small>
          </>}
        </Popover>
      )}
    </div>
  );
}
