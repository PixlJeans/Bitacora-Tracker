// ===== Tarjetas de aviso dentro de la app (puerto de las tarjetas de recordatorio de Cognose) =====
// Llegan a la vez que la notificación nativa del sistema. Botones: Registrar · Abrir · Posponer · Descartar.
import { useEffect, useState } from 'react';
import type { Aviso, Pospuesto } from '../lib/types';
import { backend } from '../lib/backend';
import { marcarInforme, marcarMes, mutar, useDatos } from '../lib/store';
import { fechaCorta, nombreMesKey } from '../lib/fechas';
import { Ic, toast } from './core';
import { abrirEditor } from './Editor';

const base = (k: string) => k.split('@')[0];
const mesDe = (a: Aviso) => base(a.key).split(':')[2];
const venceDe = (a: Aviso) => base(a.key).split(':')[2];

export function irAVista(v: string) { window.dispatchEvent(new CustomEvent('bt:vista', { detail: v })); }

export function AvisoCards() {
  const d = useDatos();   // se redibuja al marcar bitácora / inspección
  const [cards, setCards] = useState<Aviso[]>([]);
  useEffect(() => {
    backend.onAviso(nuevos => setCards(cs => {
      const keys = new Set(cs.map(c => base(c.key)));
      return [...nuevos.filter(n => !keys.has(base(n.key))), ...cs].slice(0, 30);
    }));
  }, []);
  const quitar = (k: string) => setCards(cs => cs.filter(c => c.key !== k));

  function posponer(a: Aviso, ms: number, txt: string) {
    const p: Pospuesto = { key: base(a.key), at: Date.now() + ms, title: a.title, body: a.body, kind: a.kind, ref: a.ref };
    mutar(d => { d.pospuestos = [...d.pospuestos.filter(x => x.key !== p.key), p]; }, { undo: false });
    quitar(a.key);
    toast(`Aviso pospuesto ${txt}`);
  }

  const mensuales = cards.filter(c => c.kind === 'mensual');
  const informes = cards.filter(c => c.kind === 'informe');
  const agrupar = mensuales.length > 2, agruparInf = informes.length > 2;
  const otros = cards.filter(c => !(agrupar && c.kind === 'mensual') && !(agruparInf && c.kind === 'informe'));
  const visibles = otros;
  const sinKind = (k: string) => setCards(cs => cs.filter(c => c.kind !== k));
  if (!cards.length) return null;

  return (
    <div className="avisos">
      {agrupar && (
        <div className="aviso" style={{ ['--ev' as any]: 'var(--accent)' }}>
          <div className="aviso-head"><Ic n="bell" /><span className="aviso-title">📋 {mensuales.length} bitácoras: llenado + inspección</span>
            <button className="icon-btn sm" onClick={() => sinKind('mensual')} title="Descartar"><Ic n="close" /></button></div>
          <div className="aviso-body">{mensuales.slice(0, 3).map(m => m.title.split(' · ')[1]).join(' · ')}…</div>
          <div className="aviso-btns">
            <button className="btn primary sm" onClick={() => { irAVista('mes'); sinKind('mensual'); }}>Ver mes actual</button>
            <button className="btn ghost sm" onClick={() => sinKind('mensual')}>Descartar</button>
          </div>
        </div>
      )}
      {agruparInf && (
        <div className="aviso" style={{ ['--ev' as any]: '#a78bfa' }}>
          <div className="aviso-head"><Ic n="review" /><span className="aviso-title">🗂️ {informes.length} informes regenciales por entregar</span>
            <button className="icon-btn sm" onClick={() => sinKind('informe')} title="Descartar"><Ic n="close" /></button></div>
          <div className="aviso-body">{informes.slice(0, 3).map(m => m.title.split(' · ')[1]).join(' · ')}…</div>
          <div className="aviso-btns">
            <button className="btn primary sm" onClick={() => { irAVista('informes'); sinKind('informe'); }}>Ver próximos informes</button>
            <button className="btn ghost sm" onClick={() => sinKind('informe')}>Descartar</button>
          </div>
        </div>
      )}
      {visibles.map(a => {
        const b = d.bitacoras.find(x => x.id === a.ref) ?? null;
        const color = b ? d.etiquetas.find(e => e.id === b.etiquetaId)?.color : undefined;
        return (
          <div key={a.key} className="aviso" style={{ ['--ev' as any]: color || 'var(--accent)' }}>
            <div className="aviso-head"><Ic n={a.kind === 'informe' ? 'review' : 'bell'} /><span className="aviso-title">{a.title}</span>
              <button className="icon-btn sm" onClick={() => quitar(a.key)} title="Descartar"><Ic n="close" /></button></div>
            <div className="aviso-body">{a.body}</div>
            <div className="aviso-btns">
              {a.kind === 'mensual' && b && <>
                {!b.registros.includes(mesDe(a)) && <button className="btn primary sm" onClick={() => { marcarMes(b.id, mesDe(a), 'bitacora'); toast(`✓ ${b.numero}: bitácora de ${nombreMesKey(mesDe(a))}`, true); if (b.inspecciones.includes(mesDe(a))) quitar(a.key); }}>Bitácora ✓</button>}
                {!b.inspecciones.includes(mesDe(a)) && <button className="btn primary sm" onClick={() => { marcarMes(b.id, mesDe(a), 'inspeccion'); toast(`✓ ${b.numero}: inspección de ${nombreMesKey(mesDe(a))}`, true); if (b.registros.includes(mesDe(a))) quitar(a.key); }}>Inspección ✓</button>}
                <button className="btn sm" onClick={() => { quitar(a.key); abrirEditor(b); }}>Abrir</button>
              </>}
              {a.kind === 'informe' && b && <>
                <button className="btn primary sm" onClick={() => { marcarInforme(b.id, venceDe(a)); quitar(a.key); toast(`✓ ${b.numero}: informe del ${fechaCorta(venceDe(a))} entregado`, true); }}>Entregado</button>
                <button className="btn sm" onClick={() => { quitar(a.key); irAVista('informes'); }}>Ver informes</button>
              </>}
              {a.kind !== 'prueba' && <>
                <button className="btn sm" onClick={() => posponer(a, 3600e3, '1 hora')}>+1 h</button>
                <button className="btn sm" onClick={() => posponer(a, 864e5, 'hasta mañana')}>Mañana</button>
              </>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
