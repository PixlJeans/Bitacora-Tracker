// ===== Mini calendar for forms (port of Cognose tools/13-pickers.js) =====
// Click a day = pick it · click the same day again = clear it (if `allowEmpty`).
import { useState } from 'react';
import { DOW_SHORT, longDate, fromISO, monthGrid, monthName, todayISO } from '../lib/dates';

export function DatePicker({ value, onChange, allowEmpty: allowEmpty = false }:
  { value: string; onChange: (iso: string) => void; allowEmpty?: boolean }) {
  const [month, setMonth] = useState(() => (value ? fromISO(value) : new Date()));
  const m = month.getMonth(), today = todayISO();
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1, 12));
  const pick = (iso: string, keep = false) => {
    const v = !keep && allowEmpty && iso === value ? '' : iso;
    if (v) setMonth(fromISO(v));
    onChange(v);
  };
  return (
    <div className="date-pick">
      <div className="dp-head">
        <button type="button" className="dp-nav" onClick={() => shift(-1)} title="Mes anterior">‹</button>
        <span className="dp-month">{monthName(month)}</span>
        <button type="button" className="dp-nav" onClick={() => shift(1)} title="Mes siguiente">›</button>
      </div>
      <div className="dp-grid">
        {DOW_SHORT.map(d => <span key={d} className="dp-dow">{d}</span>)}
        {monthGrid(month).map(iso => (
          <button type="button" key={iso} onClick={() => pick(iso)}
            className={`dp-day ${fromISO(iso).getMonth() !== m ? 'out' : ''} ${iso === today ? 'today' : ''} ${iso === value ? 'sel' : ''}`}>
            {fromISO(iso).getDate()}
          </button>
        ))}
      </div>
      <div className="dp-foot">
        <span className={`dp-value ${value ? '' : 'empty'}`}>{value ? longDate(value) : 'Sin fecha'}</span>
        <button type="button" className="dp-link" onClick={() => pick(today, true)}>Hoy</button>
        {value && allowEmpty && <button type="button" className="dp-link" onClick={() => onChange('')}>Quitar</button>}
      </div>
    </div>
  );
}
