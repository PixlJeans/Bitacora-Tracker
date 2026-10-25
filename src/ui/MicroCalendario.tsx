// ===== Micro-calendario (el mini calendario de la barra lateral de Cognose, con marcas) =====
// Por día: puntos con el color de las bitácoras con tarea mensual, una barrita de color por cada
// BLOQUE de tiempo, ◆ cuando vence un informe regencial y ◇ cuando empiezan sus avisos (mes 5).
// Clic en un día = filtra la lista. Soltar una bitácora en un día = la asigna al bloque de ese día
// (o, si no hay bloque, cambia su día de aviso).
import { useState, type DragEvent } from 'react';
import type { Datos } from '../lib/types';
import { completoEn, marcasDelMes, rangoBloque } from '../lib/avisos';
import { DOW_CORTO, fromISO, gridMes, mesKey, nombreMes, todayISO } from '../lib/fechas';
import { mutar } from '../lib/store';
import { Ic, toast } from './core';

export function MicroCalendario({ d, mes, setMes, dia, setDia }:
  { d: Datos; mes: Date; setMes: (m: Date) => void; dia: string | null; setDia: (s: string | null) => void }) {
  const [over, setOver] = useState<string | null>(null);
  const marcas = marcasDelMes(d, mes);
  const m = mes.getMonth(), hoy = todayISO(), mk = mesKey(mes);
  const color = (id: string) => d.etiquetas.find(e => e.id === id)?.color ?? '#888';
  const shift = (n: number) => { setMes(new Date(mes.getFullYear(), mes.getMonth() + n, 1, 12)); setDia(null); };

  function soltar(iso: string, ev: DragEvent) {
    ev.preventDefault(); setOver(null);
    const id = ev.dataTransfer.getData('text/bitacora');
    const b = d.bitacoras.find(x => x.id === id);
    if (!b) return;
    const bl = marcas.get(iso)?.bloques[0];
    if (bl) {
      mutar(dd => { const x = dd.bitacoras.find(y => y.id === id); if (x) x.bloqueId = bl.id; });
      toast(`${b.numero} → bloque «${bl.nombre}» (día ${bl.dia}, ${rangoBloque(bl)})`, true);
      return;
    }
    const n = Math.min(28, fromISO(iso).getDate());
    mutar(dd => { const x = dd.bitacoras.find(y => y.id === id); if (x) { x.diaAviso = n; x.bloqueId = null; } });
    toast(`${b.numero}: tarea mensual el día ${n}${fromISO(iso).getDate() > 28 ? ' (máximo 28, para que exista todos los meses)' : ''}`, true);
  }

  return (
    <div className="micro" data-tour="calendario">
      <div className="mini-head">
        <span>{nombreMes(mes)}</span>
        <button className="icon-btn sm" onClick={() => shift(-1)} title="Mes anterior (K)"><Ic n="left" /></button>
        <button className="icon-btn sm" onClick={() => { setMes(new Date()); setDia(null); }} title="Hoy (T)"><Ic n="calendar" /></button>
        <button className="icon-btn sm" onClick={() => shift(1)} title="Mes siguiente (J)"><Ic n="right" /></button>
      </div>
      <div className="micro-grid">
        {DOW_CORTO.map(x => <span key={x} className="mini-dow">{x}</span>)}
        {gridMes(mes).map(iso => {
          const out = fromISO(iso).getMonth() !== m;
          const k = out ? undefined : marcas.get(iso);
          const items = k?.mensual ?? [];
          const pend = items.filter(b => !completoEn(b, mk));
          const tip = [
            ...(k?.bloques ?? []).map(bl => `▬ ${bl.nombre} ${rangoBloque(bl)}`),
            ...(k?.informes ?? []).map(b => `◆ Vence informe regencial ${b.numero}`),
            ...(k?.avisoInforme ?? []).map(b => `◇ Empiezan avisos del informe ${b.numero}`),
            ...items.map(b => `${completoEn(b, mk) ? '✓' : '•'} ${b.numero} ${b.nombre}`)
          ].join('\n');
          return (
            <button key={iso} title={tip || undefined}
              className={`mday ${out ? 'out' : ''} ${iso === hoy ? 'today' : ''} ${iso === dia ? 'sel' : ''} ${k?.informes.length ? 'inf' : ''} ${k?.avisoInforme.length ? 'avinf' : ''} ${over === iso ? 'drop' : ''} ${items.length ? 'has' : ''} ${items.length && !pend.length ? 'done' : ''}`}
              onClick={() => setDia(iso === dia ? null : iso)}
              onDragOver={e => { if (!out) { e.preventDefault(); setOver(iso); } }}
              onDragLeave={() => setOver(o => (o === iso ? null : o))}
              onDrop={e => !out && soltar(iso, e)}>
              <span className="n">{fromISO(iso).getDate()}</span>
              {items.length > 0 && (
                <span className="dots">
                  {items.slice(0, 3).map(b => <i key={b.id} className={completoEn(b, mk) ? 'ok' : ''} style={{ background: color(b.etiquetaId) }} />)}
                  {items.length > 3 && <b>+{items.length - 3}</b>}
                </span>
              )}
              {!!k?.bloques.length && <span className="bars">{k.bloques.map(bl => <i key={bl.id} style={{ background: bl.color }} />)}</span>}
            </button>
          );
        })}
      </div>
      <div className="micro-legend">
        <span><i className="lg-dot" /> bitácora + inspección</span>
        <span><i className="lg-bar" /> bloque</span>
        <span><i className="lg-inf">◆</i> informe</span>
      </div>
    </div>
  );
}
