// ===== Micro-calendario (el mini calendario de la barra lateral de Cognose, con marcas) =====
// Cada día muestra puntos con el color de las bitácoras que tienen aviso ese día y una estrella
// si toca revisión semestral. Clic en un día = filtra la lista; soltar una bitácora = cambia su día de aviso.
import { useState } from 'react';
import type { Datos } from '../lib/types';
import { marcasDelMes, registradoEn } from '../lib/avisos';
import { DOW_CORTO, fromISO, gridMes, mesKey, nombreMes, todayISO } from '../lib/fechas';
import { mutar } from '../lib/store';
import { Ic, toast } from './core';

export function MicroCalendario({ d, mes, setMes, dia, setDia }:
  { d: Datos; mes: Date; setMes: (m: Date) => void; dia: string | null; setDia: (s: string | null) => void }) {
  const [over, setOver] = useState<string | null>(null);
  const marcas = marcasDelMes(d, mes);
  const m = mes.getMonth(), hoy = todayISO(), mk = mesKey(mes);
  const color = (id: string) => d.etiquetas.find(e => e.id === id)?.color ?? '#888';
  const shift = (n: number) => setMes(new Date(mes.getFullYear(), mes.getMonth() + n, 1, 12));

  function soltar(iso: string, ev: React.DragEvent) {
    ev.preventDefault(); setOver(null);
    const id = ev.dataTransfer.getData('text/bitacora');
    const b = d.bitacoras.find(x => x.id === id);
    if (!b) return;
    const dia = Math.min(28, fromISO(iso).getDate());
    mutar(dd => { const x = dd.bitacoras.find(y => y.id === id); if (x) x.diaAviso = dia; });
    toast(`${b.numero}: aviso mensual el día ${dia}${fromISO(iso).getDate() > 28 ? ' (máximo 28, para que exista todos los meses)' : ''}`, true);
  }

  return (
    <div className="micro">
      <div className="mini-head">
        <span>{nombreMes(mes)}</span>
        <button className="icon-btn sm" onClick={() => shift(-1)} title="Mes anterior (K)"><Ic n="left" /></button>
        <button className="icon-btn sm" onClick={() => { setMes(new Date()); setDia(null); }} title="Hoy (T)"><Ic n="calendar" /></button>
        <button className="icon-btn sm" onClick={() => shift(1)} title="Mes siguiente (J)"><Ic n="right" /></button>
      </div>
      <div className="micro-grid">
        {DOW_CORTO.map(x => <span key={x} className="mini-dow">{x}</span>)}
        {gridMes(mes).map(iso => {
          const k = marcas.get(iso);
          const out = fromISO(iso).getMonth() !== m;
          const items = out ? [] : k?.mensual ?? [];
          const pend = items.filter(b => !registradoEn(b, mk));
          const tip = [
            k?.semestral && !out ? '★ Revisión semestral' : '',
            ...items.map(b => `${registradoEn(b, mk) ? '✓' : '•'} ${b.numero} ${b.nombre}`)
          ].filter(Boolean).join('\n');
          return (
            <button key={iso} title={tip || undefined}
              className={`mday ${out ? 'out' : ''} ${iso === hoy ? 'today' : ''} ${iso === dia ? 'sel' : ''} ${k?.semestral && !out ? 'sem' : ''} ${over === iso ? 'drop' : ''} ${items.length ? 'has' : ''} ${items.length && !pend.length ? 'done' : ''}`}
              onClick={() => setDia(iso === dia ? null : iso)}
              onDragOver={e => { if (!out) { e.preventDefault(); setOver(iso); } }}
              onDragLeave={() => setOver(o => (o === iso ? null : o))}
              onDrop={e => !out && soltar(iso, e)}>
              <span className="n">{fromISO(iso).getDate()}</span>
              {items.length > 0 && (
                <span className="dots">
                  {items.slice(0, 3).map(b => <i key={b.id} className={registradoEn(b, mk) ? 'ok' : ''} style={{ background: color(b.etiquetaId) }} />)}
                  {items.length > 3 && <b>+{items.length - 3}</b>}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="micro-legend">
        <span><i className="lg-dot" /> aviso mensual</span>
        <span><i className="lg-star">★</i> revisión semestral</span>
      </div>
    </div>
  );
}
