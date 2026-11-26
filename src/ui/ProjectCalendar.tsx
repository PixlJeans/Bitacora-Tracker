// ===== Project delivery calendar (inside the editor) =====
// Whole month with the days marked: ● monthly Informe Regencial (same day as the opening, or the adjusted date),
// ◆ Regencia (every 6 months) and ⚑ opening. Below, the chosen month's delivery with its steps,
// dates and the letter. On top, a 12-month strip with each month's state to jump quickly.
import { useState } from 'react';
import type { Project } from '../lib/types';
import { isActiveProject } from '../lib/types';
import { reminderFrom, monthState, monthlyDue, regenciaDue, regenciaInMonth, dueInMonth } from '../lib/schedule';
import { DOW_SHORT, shortDate, longDate, fromISO, monthGrid, monthKeyOf, monthName, todayISO } from '../lib/dates';
import { Ic } from './core';
import { DeliveryCard } from './Delivery';

const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
type Change = Partial<Pick<Project, 'uploads' | 'visits' | 'regencias'>>;

/** `live`: the project already exists → full deliveries are shown (steps, dates, letter), saved immediately. */
export function ProjectCalendar({ b, onChange, live: live = false }: { b: Project; onChange: (c: Change) => void; live?: boolean }) {
  const today = todayISO();
  const [month, setMonth] = useState(() => {
    const h = fromISO(today), a = fromISO(b.openedOn);
    return a > h ? new Date(a.getFullYear(), a.getMonth(), 1, 12) : new Date(h.getFullYear(), h.getMonth(), 1, 12);
  });
  const mk = monthKeyOf(month);
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1, 12));
  const active = isActiveProject(b);
  const hasMonthly = dueInMonth(b, mk);
  const monthlyDate = hasMonthly ? monthlyDue(b, mk) : null;
  const regKey = regenciaInMonth(b, mk);
  const regDate = regKey ? regenciaDue(b, regKey) : null;
  const st = monthState(b, mk, today);

  const strip = Array.from({ length: 12 }, (_, k) => monthKeyOf(new Date(month.getFullYear(), month.getMonth() - 5 + k, 1, 12)));
  const toggle = (field: 'uploads' | 'visits' | 'regencias', v: string) =>
    onChange({ [field]: b[field].includes(v) ? b[field].filter(x => x !== v) : [...b[field], v] });

  return (
    <div className="pcal">
      <div className="pcal-strip">
        {strip.map(m => {
          const [y, n] = m.split('-').map(Number);
          return (
            <button type="button" key={m} className={`ct st-${monthState(b, m, today)} ${m === mk ? 'sel' : ''} ${regenciaInMonth(b, m) ? 'reg' : ''}`}
              onClick={() => setMonth(new Date(y, n - 1, 1, 12))} title={longDate(`${m}-01`).replace(/^\S+\s/, '')}>
              {MONTHS_SHORT[n - 1]}{n === 1 ? <small>{String(y).slice(2)}</small> : null}
            </button>
          );
        })}
      </div>

      <div className="pcal-month">
        <div className="dp-head">
          <button type="button" className="dp-nav" onClick={() => shift(-1)} title="Mes anterior">‹</button>
          <span className="dp-month">{monthName(month)}</span>
          <button type="button" className="dp-nav" onClick={() => shift(1)} title="Mes siguiente">›</button>
        </div>
        <div className="dp-grid">
          {DOW_SHORT.map(x => <span key={x} className="dp-dow">{x}</span>)}
          {monthGrid(month).map(iso => {
            const out = iso.slice(0, 7) !== mk;
            const isMonthlyDay = !out && iso === monthlyDate, isRegencia = !out && iso === regDate, isOpening = iso === b.openedOn;
            return (
              <span key={iso} className={`cd ${out ? 'out' : ''} ${iso === today ? 'today' : ''} ${isMonthlyDay ? `rev st-${st}` : ''} ${isRegencia ? 'regd' : ''} ${isOpening ? 'opening' : ''}`}
                title={[isMonthlyDay && 'Informe Regencial (mensual)', isRegencia && 'Regencia (semestral)', isOpening && 'Apertura'].filter(Boolean).join(' · ') || undefined}>
                {fromISO(iso).getDate()}
              </span>
            );
          })}
        </div>
      </div>

      <div className="pcal-checks">
        {!active && <p className="muted sm">{b.archived ? 'Archivada: sin entregas.' : b.status === 'closing' ? 'Solicitud de Cierre: ya terminó, sin entregas.' : 'Terminada: sin entrisiones.'}</p>}
        {active && !hasMonthly && !regKey && <p className="muted sm">Sin entregas en {monthName(month).toLowerCase()}.</p>}
        {live && active && monthlyDate && <DeliveryCard key={`m:${mk}`} b={b} itemKey={`m:${mk}`} />}
        {live && active && regKey && <DeliveryCard key={`r:${regKey}`} b={b} itemKey={`r:${regKey}`} />}
        {!live && monthlyDate && <>
          <div className="pcal-t"><span className={`pt st-${st}`} /> Informe Regencial · {shortDate(monthlyDate)}</div>
          <button type="button" className={`pop-opt chk ${b.visits.includes(mk) ? 'on' : ''}`} onClick={() => toggle('visits', mk)}>
            <span className="cb">{b.visits.includes(mk) && <Ic n="check" size={12} />}</span>Visita</button>
          <button type="button" className={`pop-opt chk ${b.uploads.includes(mk) ? 'on' : ''}`} onClick={() => toggle('uploads', mk)}>
            <span className="cb">{b.uploads.includes(mk) && <Ic n="check" size={12} />}</span>Subido a SETENA</button>
        </>}
        {!live && regKey && regDate && <>
          <div className="pcal-t reg">◆ Regencia (semestral) · {shortDate(regDate)} <small>avisos desde {shortDate(reminderFrom(regDate))}</small></div>
          <button type="button" className={`pop-opt chk ${b.regencias.includes(regKey) ? 'on' : ''}`} onClick={() => toggle('regencias', regKey)}>
            <span className="cb">{b.regencias.includes(regKey) && <Ic n="check" size={12} />}</span>Subida a SETENA</button>
        </>}
      </div>
    </div>
  );
}
