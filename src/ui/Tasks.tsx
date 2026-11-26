// ===== Tareas: the home screen =====
// One simple list of checkboxes: everything late, this week, and the rest of the next 30 days.
// Tick the box = done (on its own date). The 📂 button opens the folder for its photos / Regencia.
import { useState } from 'react';
import type { AppData } from '../lib/types';
import { reportTasks, REPORT_LABEL, type ReportTask } from '../lib/schedule';
import { addDays, shortDate, fromISO, monthNameOf, todayISO } from '../lib/dates';
import { getData, markAllBefore, markStep } from '../lib/store';
import { Ic, toast } from './core';
import { openEditor } from './ProjectEditor';
import { daysText, daysUntil, FolderButton } from './Delivery';

const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const SHOW_LATE = 12;

const what = (t: ReportTask) => REPORT_LABEL[t.kind] + (t.kind === 'inspection' || t.kind === 'bitacora' ? ` · ${monthNameOf(t.month).split(' ')[0].toLowerCase()}` : '');

function TaskRow({ t, today }: { t: ReportTask; today: string }) {
  const [done, setDone] = useState(false);
  const tick = () => {
    setDone(true);
    setTimeout(() => {
      markStep(t.b.id, t.key, t.step, t.date <= today ? t.date : today);
      toast(`✓ ${t.b.code}: ${REPORT_LABEL[t.kind].replace(/^\S+\s/, '')}`, true);
    }, 250);
  };
  const days = daysUntil(t.date, today);
  return (
    <div className={`tk-row ${done ? 'done' : ''} ${days < 0 ? 'late' : ''} k-${t.kind}`}>
      <label className="cl-check tk-check" title="Marcar hecha">
        <input type="checkbox" checked={done} onChange={tick} />
        <span className="cl-box">{done && <Ic n="check" size={14} />}</span>
        <span className="tk-what">{what(t)}</span>
      </label>
      <button type="button" className="tk-proj" title="Abrir el proyecto" onClick={() => openEditor(getData().projects.find(b => b.id === t.b.id) ?? t.b)}>
        <b className="mono">{t.b.code}</b> <span>{t.b.name}</span>
      </button>
      <span className="tk-date"><b>{WEEKDAYS[fromISO(t.date).getDay()]} {shortDate(t.date)}{t.date.slice(0, 4) !== today.slice(0, 4) ? ` ${t.date.slice(2, 4)}` : ''}</b><small>{daysText(days)}</small></span>
      <span className="tk-folder">{t.kind !== 'bitacora' && <FolderButton b={t.b} itemKey={t.key} />}</span>
    </div>
  );
}

export function TasksView({ d }: { d: AppData }) {
  const today = todayISO();
  const [allLate, setAllLate] = useState(false);
  const [ask, setAsk] = useState(false);
  const { overdue, upcoming, noDate } = reportTasks(d, today, addDays(today, 30));
  const week = upcoming.filter(t => t.date <= addDays(today, 6));
  const later = upcoming.filter(t => t.date > addDays(today, 6));
  const monthStart = `${today.slice(0, 7)}-01`;
  const oldOnes = overdue.filter(t => t.date < monthStart).length;
  const monthWord = monthNameOf(today.slice(0, 7)).split(' ')[0].toLowerCase();

  const section = (title: string, cls: string, list: ReportTask[], empty: string, limit?: number) => (
    <section className={`tk-sec ${cls}`}>
      <h3>{title} <span className="tk-n">{list.length}</span></h3>
      {!list.length && <p className="muted tk-empty">{empty}</p>}
      {(limit ? list.slice(0, limit) : list).map(t => <TaskRow key={`${t.key}:${t.kind}`} t={t} today={today} />)}
      {limit && list.length > limit && <button type="button" className="dp-link tk-more" onClick={() => setAllLate(true)}>Ver las {list.length - limit} restantes</button>}
    </section>
  );

  return (
    <div className="tasks">
      {oldOnes > 0 && (
        <div className="tk-catchup">
          {ask ? <>¿Ya estaba hecho todo lo anterior a {monthWord}? Se marcan {oldOnes} tareas, cada una con su fecha (se puede deshacer).
            <button className="btn sm primary" onClick={() => { const n = markAllBefore(d.projects.map(b => b.id), monthStart); setAsk(false); toast(`✓ ${n} tareas marcadas como hechas`, true); }}>Sí, marcar</button>
            <button className="dp-link" onClick={() => setAsk(false)}>no</button></>
            : <>Tienes {oldOnes} tareas de meses anteriores sin marcar. <button className="dp-link" onClick={() => setAsk(true)}>✓ Ya estaban hechas: marcarlas todas</button></>}
        </div>
      )}
      {noDate.length > 0 && (
        <div className="tk-catchup warn">📅 {noDate.length} proyecto(s) sin fecha de apertura:{' '}
          {noDate.map(b => <button key={b.id} className="dp-link" onClick={() => openEditor(b)}>{b.code}</button>)}</div>
      )}
      {section('⚠️ Atrasadas', 'late', overdue, 'Nada atrasado. ✓', allLate ? undefined : SHOW_LATE)}
      {section('📅 Esta semana', 'week', week, 'Nada para esta semana.')}
      {section('🗓️ Próximos 30 días', 'later', later, 'Nada más en los próximos 30 días.')}
    </div>
  );
}
