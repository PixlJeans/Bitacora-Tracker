// ===== Project delivery calendar (inside the editor) =====
// Whole month with the days marked: ● monthly Informe Regencial (same day as the opening, or the adjusted date),
// ◆ Regencia (every 6 months) and ⚑ opening. Below, the chosen month's delivery with its steps,
// dates and the letter. On top, a 12-month strip with each month's state to jump quickly.
import { useEffect, useState } from 'react';
import type { Project } from '../lib/types';
import { isActiveProject } from '../lib/types';
import { monthlyDue, regenciaDue, regenciaInMonth, dueInMonth, hasSchedule, monthlyKeysDueIn, completeIn, regenciaSubmitted, regenciaDueDates, inspectionDate } from '../lib/schedule';
import { shortDate, longDate, fromISO, monthKeyOf, monthName, todayISO } from '../lib/dates';
import { DeliveryCard, StartLetter } from './Delivery';

const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
type Change = Partial<Pick<Project, 'uploads' | 'visits' | 'regencias'>>;

/** `live`: the project already exists → full deliveries are shown (steps, dates, letter), saved immediately. */
export function ProjectCalendar({ b, live: live = false }: { b: Project; onChange?: (c: Change) => void; live?: boolean }) {
  const today = todayISO(), thisMonth = today.slice(0, 7);
  const [month, setMonth] = useState(() => {
    const h = fromISO(today), a = fromISO(b.openedOn);
    return a > h ? new Date(a.getFullYear(), a.getMonth(), 1, 12) : new Date(h.getFullYear(), h.getMonth(), 1, 12);
  });
  const mk = monthKeyOf(month);
  // A delivery moved to another month: follow it there
  useEffect(() => {
    const go = (ev: Event) => { const m = (ev as CustomEvent<string>).detail; const [y, n] = m.split('-').map(Number); setMonth(new Date(y, n - 1, 1, 12)); };
    window.addEventListener('bt-goto-month', go);
    return () => window.removeEventListener('bt-goto-month', go);
  }, []);
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1, 12));
  const active = hasSchedule(b);

  /** What is due in month m: informes (possibly moved there from another month) and a Regencia. */
  const dueIn = (m: string) => {
    const keys = monthlyKeysDueIn(b, m, true), reg = regenciaInMonth(b, m);
    const dates = [...new Set([...keys.flatMap(k => [monthlyDue(b, k), inspectionDate(b, k)]), ...(reg ? [regenciaDue(b, reg)] : [])]
      .filter(d => d.slice(0, 7) === m))].sort();
    const pending = keys.filter(k => !completeIn(b, k)).length + (reg && !regenciaSubmitted(b, reg) ? 1 : 0);
    const state = !dates.length ? 'outside' : !pending ? 'done' : m < thisMonth || (m === thisMonth && dates[0] <= today) ? 'overdue' : m === thisMonth ? 'today' : 'future';
    return { keys, reg, dates, state };
  };
  const cur = dueIn(mk);
  // This month's own informe, if it was moved to another month
  const ownMoved = active && dueInMonth(b, mk) && !cur.keys.includes(mk) ? monthlyDue(b, mk) : null;
  // This month's automatic Regencia, if it was moved to another month
  const regMoved = active ? regenciaDueDates(b, `${mk}-01`, `${mk}-31`).map(k => regenciaDue(b, k)).find(d => d.slice(0, 7) !== mk) ?? null : null;
  const goTo = (d: string) => { const [y, n] = d.split('-').map(Number); setMonth(new Date(y, n - 1, 1, 12)); };

  const strip = Array.from({ length: 12 }, (_, k) => monthKeyOf(new Date(month.getFullYear(), month.getMonth() - 5 + k, 1, 12)));

  return (
    <div className="pcal">
      <div className="pcal-strip">
        <button type="button" className="dp-nav" onClick={() => shift(-1)} title="Mes anterior">‹</button>
        {strip.map(m => {
          const [y, n] = m.split('-').map(Number);
          const x = dueIn(m);
          return (
            <button type="button" key={m} className={`ct st-${x.state} ${m === mk ? 'sel' : ''} ${x.reg ? 'reg' : ''}`}
              onClick={() => setMonth(new Date(y, n - 1, 1, 12))}
              title={`${longDate(`${m}-01`).replace(/^\S+\s/, '')}${x.dates.length ? ' · entrega: ' + x.dates.map(shortDate).join(', ') : ' · sin entregas'}`}>
              <span>{MONTHS_SHORT[n - 1]}{n === 1 ? <small>{String(y).slice(2)}</small> : null}</span>
              {m === b.openedOn.slice(0, 7) && <small className="ct-day" title="Mes de inicio: carta de Inicio de obras">🏗️ {fromISO(b.openedOn).getDate()}</small>}
              {x.dates.length > 0 && <small className="ct-day">{x.dates.map(d => fromISO(d).getDate()).join('·')}</small>}
            </button>
          );
        })}
        <button type="button" className="dp-nav" onClick={() => shift(1)} title="Mes siguiente">›</button>
      </div>

      <div className="pcal-checks">
        {!isActiveProject(b) && <p className="muted sm">{b.archived ? 'Archivada: sin entregas.' : 'Ya terminó: sin entregas.'}</p>}
        {active && ownMoved && <p className="muted sm pcal-moved">↪ La inspección y la bitácora de {monthName(month).toLowerCase()} se movieron al {longDate(ownMoved)}.{' '}
          <button type="button" className="dp-link" onClick={() => goTo(ownMoved)}>Ir a ese mes →</button></p>}
        {active && regMoved && <p className="muted sm pcal-moved">↪ La regencia de {monthName(month).toLowerCase()} se movió al {longDate(regMoved)}.{' '}
          <button type="button" className="dp-link" onClick={() => goTo(regMoved)}>Ir a ese mes →</button></p>}
        {live && isActiveProject(b) && mk === b.openedOn.slice(0, 7) && <StartLetter b={b} />}
        {active && !cur.keys.length && !cur.reg && !ownMoved && !regMoved && mk !== b.openedOn.slice(0, 7) && <p className="muted sm">Sin entregas en {monthName(month).toLowerCase()}.</p>}
        {live && active && cur.keys.map(k => <DeliveryCard key={`m:${k}`} b={b} itemKey={`m:${k}`} />)}
        {live && active && cur.reg && <DeliveryCard key={`r:${cur.reg}`} b={b} itemKey={`r:${cur.reg}`} />}
        {!live && active && cur.dates.length > 0 && <p className="muted sm">Entrega: {cur.dates.map(longDate).join(' · ')}. Los pasos se marcan después de crearla.</p>}
      </div>
    </div>
  );
}
