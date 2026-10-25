// ===== Calendario de revisiones del proyecto (dentro del editor) =====
// Mes completo con los días marcados: ● revisión mensual (mismo día de la apertura), ◆ informe regencial
// (cada 6 meses) y ⚑ apertura. Debajo, las casillas del mes elegido. Arriba, una tira de 12 meses
// con el estado de cada uno para saltar rápido.
import { useState } from 'react';
import type { Bitacora } from '../lib/types';
import { estaActiva } from '../lib/types';
import { avisoDesde, estadoMes, fechaMensual, informeEnMes, tocaEnMes } from '../lib/avisos';
import { DOW_CORTO, fechaCorta, fechaLarga, fromISO, gridMes, mesKey, nombreMes, todayISO } from '../lib/fechas';
import { Ic } from './core';

const MESES_C = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
type Cambio = Partial<Pick<Bitacora, 'registros' | 'inspecciones' | 'informes'>>;

export function CalendarioProyecto({ b, onChange }: { b: Bitacora; onChange: (c: Cambio) => void }) {
  const hoy = todayISO();
  const [mes, setMes] = useState(() => {
    const h = fromISO(hoy), a = fromISO(b.apertura);
    return a > h ? new Date(a.getFullYear(), a.getMonth(), 1, 12) : new Date(h.getFullYear(), h.getMonth(), 1, 12);
  });
  const mk = mesKey(mes);
  const shift = (n: number) => setMes(new Date(mes.getFullYear(), mes.getMonth() + n, 1, 12));
  const activa = estaActiva(b);
  const toca = tocaEnMes(b, mk);
  const fRev = toca ? fechaMensual(b, mk) : null;
  const infV = informeEnMes(b, mk);
  const st = estadoMes(b, mk, hoy);

  const tira = Array.from({ length: 12 }, (_, k) => mesKey(new Date(mes.getFullYear(), mes.getMonth() - 5 + k, 1, 12)));
  const toggle = (campo: 'registros' | 'inspecciones' | 'informes', v: string) =>
    onChange({ [campo]: b[campo].includes(v) ? b[campo].filter(x => x !== v) : [...b[campo], v] });

  return (
    <div className="calp">
      <div className="calp-tira">
        {tira.map(m => {
          const [y, n] = m.split('-').map(Number);
          return (
            <button type="button" key={m} className={`ct st-${estadoMes(b, m, hoy)} ${m === mk ? 'sel' : ''} ${informeEnMes(b, m) ? 'inf' : ''}`}
              onClick={() => setMes(new Date(y, n - 1, 1, 12))} title={fechaLarga(`${m}-01`).replace(/^\S+\s/, '')}>
              {MESES_C[n - 1]}{n === 1 ? <small>{String(y).slice(2)}</small> : null}
            </button>
          );
        })}
      </div>

      <div className="calp-mes">
        <div className="dp-head">
          <button type="button" className="dp-nav" onClick={() => shift(-1)} title="Mes anterior">‹</button>
          <span className="dp-month">{nombreMes(mes)}</span>
          <button type="button" className="dp-nav" onClick={() => shift(1)} title="Mes siguiente">›</button>
        </div>
        <div className="dp-grid">
          {DOW_CORTO.map(x => <span key={x} className="dp-dow">{x}</span>)}
          {gridMes(mes).map(iso => {
            const out = iso.slice(0, 7) !== mk;
            const esRev = !out && iso === fRev, esInf = !out && iso === infV, esAp = iso === b.apertura;
            return (
              <span key={iso} className={`cd ${out ? 'out' : ''} ${iso === hoy ? 'today' : ''} ${esRev ? `rev st-${st}` : ''} ${esInf ? 'infd' : ''} ${esAp ? 'ap' : ''}`}
                title={[esRev && 'Revisión mensual', esInf && 'Informe regencial', esAp && 'Apertura'].filter(Boolean).join(' · ') || undefined}>
                {fromISO(iso).getDate()}
              </span>
            );
          })}
        </div>
      </div>

      <div className="calp-checks">
        {!activa && <p className="muted sm">{b.estado === 'terminada' ? 'Terminada: sin revisiones.' : 'Archivada: sin revisiones.'}</p>}
        {activa && !toca && !infV && <p className="muted sm">Sin revisiones en {nombreMes(mes).toLowerCase()}.</p>}
        {fRev && <>
          <div className="calp-t"><span className={`pt st-${st}`} /> Revisión mensual · {fechaCorta(fRev)}</div>
          <button type="button" className={`pop-opt chk ${b.registros.includes(mk) ? 'on' : ''}`} onClick={() => toggle('registros', mk)}>
            <span className="cb">{b.registros.includes(mk) && <Ic n="check" size={12} />}</span>Llenado de bitácora</button>
          <button type="button" className={`pop-opt chk ${b.inspecciones.includes(mk) ? 'on' : ''}`} onClick={() => toggle('inspecciones', mk)}>
            <span className="cb">{b.inspecciones.includes(mk) && <Ic n="check" size={12} />}</span>Inspección</button>
        </>}
        {infV && <>
          <div className="calp-t inf">◆ Informe regencial · {fechaCorta(infV)} <small>avisos desde {fechaCorta(avisoDesde(infV))}</small></div>
          <button type="button" className={`pop-opt chk ${b.informes.includes(infV) ? 'on' : ''}`} onClick={() => toggle('informes', infV)}>
            <span className="cb">{b.informes.includes(infV) && <Ic n="check" size={12} />}</span>Informe entregado</button>
        </>}
      </div>
    </div>
  );
}
