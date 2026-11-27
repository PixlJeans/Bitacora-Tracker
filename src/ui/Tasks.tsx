// ===== Tareas: the home screen =====
// One simple list of checkboxes: everything late, this week, and the rest of the next 30 days.
// Tick the box = done (on its own date). The 📂 button opens the folder for its photos / Regencia.
import { useState } from 'react';
import type { AppData } from '../lib/types';
import { reportTasks, REPORT_LABEL, type ReportTask } from '../lib/schedule';
import { addDays, shortDate, fromISO, monthNameOf, todayISO } from '../lib/dates';
import { getData, markStep } from '../lib/store';
import { Ic, toast } from './core';
import { openEditor } from './ProjectEditor';
import { daysText, daysUntil, FolderButton } from './Delivery';
import { SetenaFeed } from './SetenaFeed';
import { ClosureTasks, FileAlerts } from './Closure';

const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const SHOW_LATE = 12;

const what = (t: ReportTask) => REPORT_LABEL[t.kind] + (t.kind === 'inspection' || t.kind === 'bitacora' ? ` · ${monthNameOf(t.month).split(' ')[0].toLowerCase()}` : '');

/** Same project and same day as the task before / after it: drawn as one block (project and date shown once). */
const sameSlot = (a?: ReportTask, c?: ReportTask) => !!a && !!c && a.b.id === c.b.id && a.date === c.date;

function TaskRow({ t, today, cont = false, more = false }: { t: ReportTask; today: string; cont?: boolean; more?: boolean }) {
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
    <div className={`tk-row ${done ? 'done' : ''} ${days < 0 ? 'late' : ''} k-${t.kind} ${cont ? 'cont' : ''} ${more ? 'more' : ''}`}>
      <label className="cl-check tk-check" title="Marcar hecha">
        <input type="checkbox" checked={done} onChange={tick} />
        <span className="cl-box">{done && <Ic n="check" size={14} />}</span>
        <span className="tk-what">{what(t)}</span>
      </label>
      <button type="button" className="tk-proj" title="Abrir el proyecto" tabIndex={cont ? -1 : undefined} aria-hidden={cont || undefined} onClick={() => openEditor(getData().projects.find(b => b.id === t.b.id) ?? t.b)}>
        <b className="mono">{t.b.code}</b> <span>{t.b.name}</span>
      </button>
      <span className="tk-date"><b>{WEEKDAYS[fromISO(t.date).getDay()]} {shortDate(t.date)}{t.date.slice(0, 4) !== today.slice(0, 4) ? ` ${t.date.slice(2, 4)}` : ''}</b><small>{daysText(days)}</small></span>
      <span className="tk-folder">{t.kind !== 'bitacora' && <FolderButton b={t.b} itemKey={t.key} />}</span>
    </div>
  );
}

const REG_STEPS: { kind: ReportTask['kind']; label: string }[] = [
  { kind: 'regElab', label: '✍️ Elaboración' }, { kind: 'regSign', label: '🖊️ Firma del cliente' }, { kind: 'regUpload', label: '📤 Subir a SETENA' }];

/** One Regencia in one row: its missing steps as buttons, in order (a later step marks the earlier ones too). */
function RegRow({ steps, today }: { steps: ReportTask[]; today: string }) {
  const t = steps[0];
  const [done, setDone] = useState<string[]>([]);
  const tick = (s: ReportTask) => {
    // a later step implies the earlier ones (the store does the same)
    const idx = REG_STEPS.findIndex(x => x.kind === s.kind);
    setDone(REG_STEPS.slice(0, idx + 1).map(x => x.kind));
    setTimeout(() => {
      markStep(t.b.id, t.key, s.step, t.date <= today ? t.date : today);
      toast(`✓ ${t.b.code}: ${REPORT_LABEL[s.kind].replace(/^\S+\s/, '')}`, true);
    }, 250);
  };
  const days = daysUntil(t.date, today);
  const missing = new Set(steps.map(x => x.kind));
  const all = missing.size > 0 && REG_STEPS.every(x => !missing.has(x.kind) || done.includes(x.kind));
  return (
    <div className={`tk-row tk-reg ${all ? 'done' : ''} ${days < 0 ? 'late' : ''}`}>
      <div className="tk-steps">
        <span className="tk-what">🗂️ Regencia</span>
        {REG_STEPS.map(x => {
          const s = steps.find(y => y.kind === x.kind);
          const on = !s || done.includes(x.kind);
          return (
            <button key={x.kind} type="button" className={`tk-step ${on ? 'on' : ''}`} disabled={on} title={on ? 'Hecho' : `Marcar «${x.label.replace(/^\S+\s/, '')}» hecho`} onClick={() => s && tick(s)}>
              <span className="tk-step-box">{on && <Ic n="check" size={11} />}</span>{x.label}
            </button>
          );
        })}
      </div>
      <button type="button" className="tk-proj" title="Abrir el proyecto" onClick={() => openEditor(getData().projects.find(b => b.id === t.b.id) ?? t.b)}>
        <b className="mono">{t.b.code}</b> <span>{t.b.name}</span>
      </button>
      <span className="tk-date"><b>{WEEKDAYS[fromISO(t.date).getDay()]} {shortDate(t.date)}{t.date.slice(0, 4) !== today.slice(0, 4) ? ` ${t.date.slice(2, 4)}` : ''}</b><small>{daysText(days)}</small></span>
      <span className="tk-folder"><FolderButton b={t.b} itemKey={t.key} /></span>
    </div>
  );
}

type Item = { t: ReportTask } | { reg: ReportTask[] };
/** The tasks as rows: a Regencia's steps (same project, same key) become one row. */
function itemsOf(list: ReportTask[]): Item[] {
  const out: Item[] = [];
  const regAt = new Map<string, ReportTask[]>();
  for (const t of list) {
    if (t.key.startsWith('r:') && REG_STEPS.some(x => x.kind === t.kind)) {
      const id = `${t.b.id}|${t.key}`;
      const g = regAt.get(id);
      if (g) { g.push(t); continue; }
      const ng = [t]; regAt.set(id, ng); out.push({ reg: ng });
    } else out.push({ t });
  }
  return out;
}

export function TasksView({ d }: { d: AppData }) {
  const today = todayISO();
  const [allLate, setAllLate] = useState(false);
  const { overdue, upcoming, noDate } = reportTasks(d, today, addDays(today, 30));
  const week = upcoming.filter(t => t.date <= addDays(today, 6));
  const later = upcoming.filter(t => t.date > addDays(today, 6));

  const section = (title: string, cls: string, list: ReportTask[], empty: string, limit?: number) => (
    <section className={`tk-sec ${cls}`}>
      <h3>{title} <span className="tk-n">{list.length}</span></h3>
      {!list.length && <p className="muted tk-empty">{empty}</p>}
      {(() => {
        const items = itemsOf(list), shown = limit ? items.slice(0, limit) : items;
        const tOf = (x?: Item) => (x && 't' in x ? x.t : undefined);
        return <>
          {shown.map((x, i) => 'reg' in x
            ? <RegRow key={`${x.reg[0].b.id}:${x.reg[0].key}`} steps={x.reg} today={today} />
            : <TaskRow key={`${x.t.b.id}:${x.t.key}:${x.t.kind}`} t={x.t} today={today} cont={sameSlot(tOf(shown[i - 1]), x.t)} more={sameSlot(x.t, tOf(shown[i + 1]))} />)}
          {limit && items.length > limit && <button type="button" className="dp-link tk-more" onClick={() => setAllLate(true)}>Ver {items.length - limit} más</button>}
        </>;
      })()}
    </section>
  );

  return (
    <div className="tasks">
      <SetenaFeed d={d} />
      {/* v56: no «mark everything as done» here: the app follows SETENA, and a bulk check made history SETENA doesn't have */}
      {noDate.length > 0 && (
        <div className={`tk-catchup ${noDate.some(b => (b.setena?.entries ?? 0) > 0) ? 'warn' : ''}`}>📅 {noDate.length} sin fecha de apertura:{' '}
          {noDate.map(b => <button key={b.id} className="dp-link" onClick={() => openEditor(b)} title={b.setena?.approvedOn ? `Aprobada en SETENA el ${b.setena.approvedOn}` : undefined}>{b.code}</button>)}
          <span className="muted">
            {noDate.every(b => b.setena && !b.setena.entries)
              ? ' · todavía sin anotaciones en SETENA: la fecha se pone sola con la primera anotación («📥 Descargar todo de SETENA»).'
              : ' · ponla en ✏️ Editar datos, o se toma de la primera anotación en SETENA.'}
          </span></div>
      )}
      <FileAlerts d={d} />
      {section('⚠️ Atrasadas', 'late', overdue, 'Nada atrasado. ✓', allLate ? undefined : SHOW_LATE)}
      <ClosureTasks d={d} />
      {section('📅 Esta semana', 'week', week, 'Nada para esta semana.')}
      {section('🗓️ Próximos 30 días', 'later', later, 'Nada más en los próximos 30 días.')}
    </div>
  );
}
