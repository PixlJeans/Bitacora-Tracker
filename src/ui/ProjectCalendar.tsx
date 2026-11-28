// ===== The project's dates (inside the editor) =====
// v69: no more month calendar. Regencias are done on their own dates (not on the schedule's), so the project shows
// a LIST OF DATES: every regencia with its real elaboración / firma / subida / recibido dates (and its period), and
// the monthly inspección + bitácora with the day each was done. Pending items show their due date. Clicking a row
// opens it below to check steps or change its date.
import { useEffect, useMemo, useState } from 'react';
import type { Project } from '../lib/types';
import { isActiveProject } from '../lib/types';
import { hasSchedule } from '../lib/schedule';
import { regenciaRows, monthRows, nextDates, type RegRow, type MonthRow, type RowState } from '../lib/projectDates';
import { fromISO, longDate, todayISO } from '../lib/dates';
import { DeliveryCard, StartLetter } from './Delivery';
import { markStep } from '../lib/store';
import { toast } from './core';
import type { Step } from '../lib/types';

type Change = Partial<Pick<Project, 'uploads' | 'visits' | 'regencias'>>;
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** «14 may 26» — always with the year: these lists span years. */
const d3 = (iso: string | null | undefined) => { if (!iso) return ''; const d = fromISO(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`; };
const monthLabel = (mk: string) => `${MONTHS[+mk.slice(5, 7) - 1]} ${mk.slice(0, 4)}`;
const STATE: Record<RowState, string> = { done: 'hecha', late: 'atrasada', soon: 'pronto', future: 'pendiente', history: 'sin registro' };

/** A date cell. Not done yet + `mark` → a small «✓ marcar» button right there (no need to open the row). */
function Cell({ date, due, state, mark, label }: { date: string | null; due?: string | null; state: RowState; mark?: () => void; label?: string }) {
  if (date) return <td className="pd-d"><b>{d3(date)}</b></td>;
  const btn = mark && <button type="button" className="pd-mark" title={`Marcar ${label ?? ''} como hecho${state === 'late' && due ? ` (con su fecha, ${d3(due)})` : ' (hoy)'}`}
    onClick={e => { e.stopPropagation(); mark(); }}>✓ marcar</button>;
  if (due && state !== 'done') return <td className={`pd-d pd-due ${state}`} title="Fecha en que toca">{state === 'late' || state === 'history' ? 'debía ' : 'toca '}{d3(due)}{btn}</td>;
  return <td className="pd-d muted">{btn ?? '—'}</td>;
}

/** `live`: the project already exists → rows open its deliveries (steps, dates, letter), saved immediately. */
export function ProjectCalendar({ b, live = false }: { b: Project; onChange?: (c: Change) => void; live?: boolean }) {
  const today = todayISO();
  const regs = useMemo(() => regenciaRows(b, today), [b, today]);
  const [months, setMonths] = useState(6);
  const mrows = useMemo(() => monthRows(b, today, months), [b, today, months]);
  const next = useMemo(() => nextDates(b, today), [b, today]);
  const [allRegs, setAllRegs] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  // A delivery moved to another month: open it there
  useEffect(() => {
    const go = (ev: Event) => setSel(`m:${(ev as CustomEvent<string>).detail}`);
    window.addEventListener('bt-goto-month', go);
    return () => window.removeEventListener('bt-goto-month', go);
  }, []);
  const active = hasSchedule(b);
  const shownRegs = allRegs ? regs : regs.slice(0, 6);
  const pick = (k: string) => setSel(s => (s === k ? null : k));
  // quick check from the list: a late one keeps its own due date (like in Tareas), a coming one is done today
  const markFn = (key: string, step: Step, due: string | null | undefined, what: string, state: RowState) =>
    live && (state === 'late' || state === 'soon' || state === 'future') ? () => {
      const date = due && due <= today ? due : today;
      markStep(b.id, key, step, date);
      toast(`✓ ${b.code}: ${what} (${d3(date)})`, true);
    } : undefined;

  const regRow = (r: RegRow, i: number) => {
    const k = r.key ? `r:${r.key}` : null;
    return (
      <tr key={r.key ?? `x${i}`} className={`pd-row st-${r.state} ${k && sel === k ? 'sel' : ''} ${k && live ? 'click' : ''}`}
        onClick={() => k && live && pick(k)} title={k && live ? 'Abrir: marcar pasos o cambiar la fecha' : r.note}>
        <td className="pd-what">
          <b>{r.ira ?? (r.key ? 'Regencia' : 'Informe')}</b>
          <small>{r.period ? `Periodo ${r.period}` : r.key ? `semestre del ${d3(r.key)}` : r.note}</small>
          {r.key && r.note && <small className="pd-warn">{r.note}</small>}
        </td>
        <Cell date={r.letter} state={r.state} label="la elaboración" mark={k ? markFn(k, 'letter', null, 'elaboración', r.state) : undefined} />
        <Cell date={r.signed} state={r.state} label="la firma del cliente" mark={k ? markFn(k, 'signed', null, 'firma del cliente', r.state) : undefined} />
        <Cell date={r.uploaded} due={r.due} state={r.state} label="la subida" mark={k ? markFn(k, 'uploaded', r.state === 'late' ? today : null, 'regencia subida', r.state) : undefined} />
        <Cell date={r.received} state={r.state} label="la nota de recibido" mark={k && r.uploaded ? markFn(k, 'received', null, 'nota de recibido', 'soon') : undefined} />
        <td><span className={`pd-st ${r.key ? r.state : 'done'}`} title={r.key ? undefined : r.note}>{r.key ? STATE[r.state] : r.final ? 'final' : 'extra'}</span></td>
      </tr>
    );
  };
  const monthRow = (m: MonthRow) => {
    const k = `m:${m.mk}`;
    return (
      <tr key={m.mk} className={`pd-row st-${m.state} ${sel === k ? 'sel' : ''} ${live ? 'click' : ''}`} onClick={() => live && pick(k)} title={live ? 'Abrir: marcar o cambiar la fecha' : undefined}>
        <td className="pd-what"><b>{monthLabel(m.mk)}</b></td>
        {m.visited ? <td className="pd-d"><b>{m.visit ? d3(m.visit) : '✓'}</b></td> : <Cell date={null} due={m.inspDue} state={m.state} label="la inspección" mark={markFn(k, 'visit', m.inspDue, 'inspección', m.state)} />}
        {m.up ? <td className="pd-d"><b>{m.uploaded ? d3(m.uploaded) : '✓'}</b></td> : <Cell date={null} due={m.bitDue} state={m.state} label="la bitácora" mark={markFn(k, 'uploaded', m.bitDue, 'bitácora', m.state)} />}
        <td><span className={`pd-st ${m.state}`}>{STATE[m.state]}</span></td>
      </tr>
    );
  };

  return (
    <div className="pcal pd">
      {!isActiveProject(b) && <p className="muted sm">{b.archived ? 'Archivada: sin entregas.' : b.status === 'resigned' ? 'Renuncia: sin entregas (abajo, lo que se hizo).' : b.status === 'closing' ? 'Solicitud de Cierre: sin entregas mensuales (sus pasos de cierre están arriba).' : 'Ya terminó: sin entregas (abajo, lo que se hizo).'}</p>}
      {active && (
        <div className="pd-next">
          <span>🚗 {next.insp && next.insp < today ? 'Inspección atrasada, debía' : 'Próxima inspección'}: <b className={next.insp && next.insp < today ? 'pd-late' : ''}>{next.insp ? longDate(next.insp) : '—'}</b></span>
          <span>🗂️ {next.reg?.state === 'late' ? 'Regencia atrasada, debía' : 'Próxima regencia'}: <b className={next.reg?.state === 'late' ? 'pd-late' : ''}>{next.reg ? longDate(next.reg.due!) : '—'}</b>{next.reg && <small className="muted"> (semestre del {d3(next.reg.key)})</small>}</span>
        </div>
      )}
      {live && isActiveProject(b) && b.openedOn.slice(0, 7) >= today.slice(0, 7) && <StartLetter b={b} />}

      {regs.length > 0 && (
        <section className="pd-sec">
          <h4>🗂️ Regencias <small className="muted">— las fechas reales de cada una (de los PDF y de SETENA, o marcadas a mano)</small></h4>
          <div className="pd-scroll"><table className="pd-table">
            <thead><tr><th>Regencia</th><th>Elaboración</th><th>Firma cliente</th><th>Subida a SETENA</th><th>Nota de recibido</th><th></th></tr></thead>
            <tbody>{shownRegs.map(regRow)}</tbody>
          </table></div>
          {regs.length > 6 && <button type="button" className="dp-link" onClick={() => setAllRegs(v => !v)}>{allRegs ? 'Ver menos' : `Ver las ${regs.length}`}</button>}
          {sel?.startsWith('r:') && live && <DeliveryCard key={sel} b={b} itemKey={sel} />}
        </section>
      )}

      {mrows.length > 0 && (
        <section className="pd-sec">
          <h4>🚗 Inspección y 📋 bitácora <small className="muted">— el día en que se hizo cada mes</small></h4>
          <div className="pd-scroll"><table className="pd-table">
            <thead><tr><th>Mes</th><th>Inspección</th><th>Bitácora</th><th></th></tr></thead>
            <tbody>{mrows.map(monthRow)}</tbody>
          </table></div>
          <button type="button" className="dp-link" onClick={() => setMonths(n => n + 12)}>Ver meses anteriores</button>
          {sel?.startsWith('m:') && live && <DeliveryCard key={sel} b={b} itemKey={sel} />}
        </section>
      )}
      {!regs.length && !mrows.length && <p className="muted sm">{b.noOpeningDate ? 'Sin fecha de apertura: las fechas aparecen con la primera anotación en SETENA.' : 'Todavía sin fechas.'}</p>}
    </div>
  );
}
