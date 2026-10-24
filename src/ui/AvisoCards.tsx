// ===== Tarjetas de aviso dentro de la app (puerto de las tarjetas de recordatorio de Cognose) =====
// Llegan a la vez que la notificación nativa del sistema. Botones: Registrar · Abrir · Posponer · Descartar.
import { useEffect, useState } from 'react';
import type { Aviso, Pospuesto } from '../lib/types';
import { backend } from '../lib/backend';
import { getDatos, mutar, registrarMes } from '../lib/store';
import { nombreMesKey } from '../lib/fechas';
import { Ic, toast } from './core';
import { abrirEditor } from './Editor';
import { abrirRevision } from './Revision';

const base = (k: string) => k.split('@')[0];
const mesDe = (a: Aviso) => base(a.key).split(':')[2];

export function filtrarPendientes() { window.dispatchEvent(new CustomEvent('bt:filtro', { detail: 'pendientes' })); }

export function AvisoCards() {
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
  const otros = cards.filter(c => c.kind !== 'mensual');
  const agrupar = mensuales.length > 2;
  const visibles = agrupar ? otros : cards;
  if (!cards.length) return null;

  return (
    <div className="avisos">
      {agrupar && (
        <div className="aviso" style={{ ['--ev' as any]: 'var(--accent)' }}>
          <div className="aviso-head"><Ic n="bell" /><span className="aviso-title">📋 {mensuales.length} bitácoras por registrar</span>
            <button className="icon-btn sm" onClick={() => setCards(otros)} title="Descartar"><Ic n="close" /></button></div>
          <div className="aviso-body">{mensuales.slice(0, 3).map(m => m.title.replace('📋 Registrar bitácora ', '')).join(' · ')}…</div>
          <div className="aviso-btns">
            <button className="btn primary sm" onClick={() => { filtrarPendientes(); setCards(otros); }}>Ver pendientes</button>
            <button className="btn ghost sm" onClick={() => setCards(otros)}>Descartar</button>
          </div>
        </div>
      )}
      {visibles.map(a => {
        const b = a.kind === 'mensual' ? getDatos().bitacoras.find(x => x.id === a.ref) : null;
        const color = b ? getDatos().etiquetas.find(e => e.id === b.etiquetaId)?.color : a.kind === 'semestral' ? '#a78bfa' : undefined;
        return (
          <div key={a.key} className="aviso" style={{ ['--ev' as any]: color || 'var(--accent)' }}>
            <div className="aviso-head"><Ic n={a.kind === 'semestral' ? 'review' : 'bell'} /><span className="aviso-title">{a.title}</span>
              <button className="icon-btn sm" onClick={() => quitar(a.key)} title="Descartar"><Ic n="close" /></button></div>
            <div className="aviso-body">{a.body}</div>
            <div className="aviso-btns">
              {a.kind === 'mensual' && b && <>
                <button className="btn primary sm" onClick={() => { registrarMes(b.id, mesDe(a)); quitar(a.key); toast(`✓ ${b.numero} registrada en ${nombreMesKey(mesDe(a))}`, true); }}>Registrar</button>
                <button className="btn sm" onClick={() => { quitar(a.key); abrirEditor(b); }}>Abrir</button>
              </>}
              {a.kind === 'semestral' && <button className="btn primary sm" onClick={() => { quitar(a.key); abrirRevision(a.ref); }}>Iniciar revisión</button>}
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
