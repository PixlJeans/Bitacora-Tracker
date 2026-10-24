// ===== Mini calendario para formularios (puerto de Cognose tools/13-pickers.js) =====
// Clic en un día = elegirlo · clic otra vez en el mismo día = quitarlo (si `permiteVacio`).
import { useState } from 'react';
import { DOW_CORTO, fechaLarga, fromISO, gridMes, nombreMes, todayISO } from '../lib/fechas';

export function DatePick({ value, onChange, permiteVacio = false }:
  { value: string; onChange: (iso: string) => void; permiteVacio?: boolean }) {
  const [mes, setMes] = useState(() => (value ? fromISO(value) : new Date()));
  const m = mes.getMonth(), hoy = todayISO();
  const shift = (n: number) => setMes(new Date(mes.getFullYear(), mes.getMonth() + n, 1, 12));
  const pick = (iso: string, keep = false) => {
    const v = !keep && permiteVacio && iso === value ? '' : iso;
    if (v) setMes(fromISO(v));
    onChange(v);
  };
  return (
    <div className="date-pick">
      <div className="dp-head">
        <button type="button" className="dp-nav" onClick={() => shift(-1)} title="Mes anterior">‹</button>
        <span className="dp-month">{nombreMes(mes)}</span>
        <button type="button" className="dp-nav" onClick={() => shift(1)} title="Mes siguiente">›</button>
      </div>
      <div className="dp-grid">
        {DOW_CORTO.map(d => <span key={d} className="dp-dow">{d}</span>)}
        {gridMes(mes).map(iso => (
          <button type="button" key={iso} onClick={() => pick(iso)}
            className={`dp-day ${fromISO(iso).getMonth() !== m ? 'out' : ''} ${iso === hoy ? 'today' : ''} ${iso === value ? 'sel' : ''}`}>
            {fromISO(iso).getDate()}
          </button>
        ))}
      </div>
      <div className="dp-foot">
        <span className={`dp-value ${value ? '' : 'empty'}`}>{value ? fechaLarga(value) : 'Sin fecha'}</span>
        <button type="button" className="dp-link" onClick={() => pick(hoy, true)}>Hoy</button>
        {value && permiteVacio && <button type="button" className="dp-link" onClick={() => onChange('')}>Quitar</button>}
      </div>
    </div>
  );
}
