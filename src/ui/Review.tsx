// ===== Overall summary: a big review of every project =====
// Includes ALL of them (also Closing request), with the state of their Regencia. Can be saved as a record.
import { useState } from 'react';
import type { Project, Status } from '../lib/types';
import { STATUSES } from '../lib/types';
import { completeIn, summary } from '../lib/schedule';
import { nextRegencia } from '../lib/schedule';
import { shortDate, longDate, monthKeyOf, todayISO, uid } from '../lib/dates';
import { getData, mutate } from '../lib/store';
import { openModal, alertBox, closeModal, HbHead, Ic } from './core';
import { openEditor } from './ProjectEditor';

export function openReview(period?: string) {
  const p = period || todayISO();
  openModal(<Review period={p} />, 'create-modal revision');
}

const months6 = () => { const d = new Date(); return Array.from({ length: 6 }, (_, i) => monthKeyOf(new Date(d.getFullYear(), d.getMonth() - i, 1, 12))); };

function Review({ period: period }: { period: string }) {
  const d = getData();
  const previous = d.reviews.find(r => r.period === period);
  const [reviewed, setReviewed] = useState<string[]>(previous?.reviewed ?? []);
  const [notes, setNotes] = useState(previous?.notes ?? '');
  const r = summary(d);
  const last6 = months6();
  const et = (b: Project) => d.labels.find(e => e.id === b.labelId);
  const groups: { e: Status; items: Project[] }[] = (['new', 'open', 'closing', 'resigned', 'finished'] as Status[])
    .map(e => ({ e, items: d.projects.filter(b => !b.archived && b.status === e).sort((a, b) => a.code.localeCompare(b.code)) }));
  const toggle = (id: string) => setReviewed(x => (x.includes(id) ? x.filter(y => y !== id) : [...x, id]));

  function save() {
    mutate(dd => {
      const isNew = { id: previous?.id ?? uid(), period: period, date: todayISO(), reviewed: reviewed, notes: notes, summary: { open: r.open, new: r.new, closing: r.closing, notUploaded: r.notUploaded } };
      dd.reviews = [...dd.reviews.filter(x => x.period !== period), isNew];
    });
    closeModal();
    alertBox('¡Resumen guardado!', `${reviewed.length} de ${d.projects.length} bitácoras revisadas.`, '🏆', '#a78bfa');
  }

  return (
    <>
      <HbHead icon="🗂️" title="Resumen general" sub={`${longDate(period)}${previous ? ` · guardada el ${shortDate(previous.date)}` : ''}`} color="#a78bfa" />
      <div className="stat-tiles">
        <div className="tile status-open"><b>{r.open}</b><span>Abiertas</span></div>
        <div className="tile status-new"><b>{r.new}</b><span>Nuevas</span></div>
        <div className="tile status-closing"><b>{r.closing}</b><span>Sol. de cierre</span></div>
        <div className={`tile ${r.notUploaded + r.notVisited ? 'warn' : 'ok'}`}><b>{r.notUploaded}/{r.notVisited}</b><span>Sin subir / sin visita</span></div>
        <div className={`tile ${r.regenciasOverdue ? 'warn' : r.regenciasDueSoon ? 'mid' : 'ok'}`}><b>{r.regenciasOverdue}/{r.regenciasDueSoon}</b><span>Regencias vencidas / en aviso</span></div>
      </div>

      <div className="rev-list">
        {groups.filter(g => g.items.length).map(g => (
          <section key={g.e}>
            <h4><span className={`status-dot status-${g.e}`} />{STATUSES.find(s => s.id === g.e)?.name} <small>{g.items.length}</small></h4>
            {g.items.map(b => {
              const n = last6.filter(m => completeIn(b, m)).length;
              return (
                <label key={b.id} className={`rev-row ${reviewed.includes(b.id) ? 'on' : ''}`} style={{ ['--ec' as any]: et(b)?.color }}>
                  <input type="checkbox" checked={reviewed.includes(b.id)} onChange={() => toggle(b.id)} />
                  <span className="dot" />
                  <span className="mono">{b.code}</span>
                  <span className="name">{b.name}</span>
                  {g.e !== 'finished'
                    ? <span className={`meter ${n >= 5 ? 'ok' : n >= 3 ? 'mid' : 'low'}`} title="Informes Regenciales completos: visita + subido (últimos 6 meses)"><i style={{ width: `${(n / 6) * 100}%` }} />{n}/6</span>
                    : <span className="meter na">terminada</span>}
                  {(() => { const i = nextRegencia(b, todayISO()); return i ? <span className={`reg-chip st-${i.status}`}>Regencia {i.due}</span> : null; })()}
                  <button type="button" className="icon-btn sm" title="Editar" onClick={e => { e.preventDefault(); openEditor(b); }}><Ic n="edit" /></button>
                </label>
              );
            })}
          </section>
        ))}
        {!d.projects.length && <p className="modal-text center">Aún no hay bitácoras. Importa el PDF o crea la primera.</p>}
      </div>

      <label className="modal-label" htmlFor="rev_notas">Notas de la revisión</label>
      <textarea id="rev_notas" className="modal-input" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Acuerdos, pendientes con SETENA, cierres por solicitar…" />
      <div className="modal-btns">
        <button className="modal-btn cancel" onClick={() => setReviewed(reviewed.length === d.projects.length ? [] : d.projects.map(b => b.id))}>
          {reviewed.length === d.projects.length ? 'Desmarcar todas' : 'Marcar todas'}
        </button>
        <span className="grow" />
        <button className="modal-btn cancel" onClick={closeModal}>Cerrar</button>
        <button className="modal-btn ok" onClick={save}>Guardar acta</button>
      </div>
    </>
  );
}
