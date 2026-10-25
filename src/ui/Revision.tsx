// ===== Resumen general: revisión grande de todas las bitácoras =====
// Incluye TODAS (también Solicitud de Cierre), con el estado de su informe regencial. Se puede guardar como acta.
import { useState } from 'react';
import type { Bitacora, Estado } from '../lib/types';
import { ESTADOS } from '../lib/types';
import { completoEn, resumen } from '../lib/avisos';
import { proximoInforme } from '../lib/avisos';
import { fechaCorta, fechaLarga, mesKey, todayISO, uid } from '../lib/fechas';
import { getDatos, mutar } from '../lib/store';
import { abrirModal, alerta, cerrarModal, HbHead, Ic } from './core';
import { abrirEditor } from './Editor';

export function abrirRevision(periodo?: string) {
  const p = periodo || todayISO();
  abrirModal(<Revision periodo={p} />, 'create-modal revision');
}

const meses6 = () => { const d = new Date(); return Array.from({ length: 6 }, (_, i) => mesKey(new Date(d.getFullYear(), d.getMonth() - i, 1, 12))); };

function Revision({ periodo }: { periodo: string }) {
  const d = getDatos();
  const previa = d.revisiones.find(r => r.periodo === periodo);
  const [rev, setRev] = useState<string[]>(previa?.revisados ?? []);
  const [notas, setNotas] = useState(previa?.notas ?? '');
  const r = resumen(d);
  const ult6 = meses6();
  const et = (b: Bitacora) => d.etiquetas.find(e => e.id === b.etiquetaId);
  const grupos: { e: Estado; items: Bitacora[] }[] = (['nueva', 'abierta', 'cierre', 'terminada'] as Estado[])
    .map(e => ({ e, items: d.bitacoras.filter(b => !b.archivada && b.estado === e).sort((a, b) => a.numero.localeCompare(b.numero)) }));
  const toggle = (id: string) => setRev(x => (x.includes(id) ? x.filter(y => y !== id) : [...x, id]));

  function guardar() {
    mutar(dd => {
      const nueva = { id: previa?.id ?? uid(), periodo, fecha: todayISO(), revisados: rev, notas, resumen: { abiertas: r.abiertas, nuevas: r.nuevas, cierre: r.cierre, sinRegistro: r.sinRegistro } };
      dd.revisiones = [...dd.revisiones.filter(x => x.periodo !== periodo), nueva];
    });
    cerrarModal();
    alerta('¡Resumen guardado!', `${rev.length} de ${d.bitacoras.length} bitácoras revisadas.`, '🏆', '#a78bfa');
  }

  return (
    <>
      <HbHead icon="🗂️" titulo="Resumen general" sub={`${fechaLarga(periodo)}${previa ? ` · guardada el ${fechaCorta(previa.fecha)}` : ''}`} color="#a78bfa" />
      <div className="stat-tiles">
        <div className="tile est-abierta"><b>{r.abiertas}</b><span>Abiertas</span></div>
        <div className="tile est-nueva"><b>{r.nuevas}</b><span>Nuevas</span></div>
        <div className="tile est-cierre"><b>{r.cierre}</b><span>Sol. de cierre</span></div>
        <div className={`tile ${r.sinRegistro + r.sinInspeccion ? 'warn' : 'ok'}`}><b>{r.sinRegistro}/{r.sinInspeccion}</b><span>Sin bitácora / inspección</span></div>
        <div className={`tile ${r.informesVencidos ? 'warn' : r.informesAviso ? 'mid' : 'ok'}`}><b>{r.informesVencidos}/{r.informesAviso}</b><span>Informes vencidos / en aviso</span></div>
      </div>

      <div className="rev-list">
        {grupos.filter(g => g.items.length).map(g => (
          <section key={g.e}>
            <h4><span className={`est-dot est-${g.e}`} />{ESTADOS.find(s => s.id === g.e)?.nombre} <small>{g.items.length}</small></h4>
            {g.items.map(b => {
              const n = ult6.filter(m => completoEn(b, m)).length;
              return (
                <label key={b.id} className={`rev-row ${rev.includes(b.id) ? 'on' : ''}`} style={{ ['--ec' as any]: et(b)?.color }}>
                  <input type="checkbox" checked={rev.includes(b.id)} onChange={() => toggle(b.id)} />
                  <span className="dot" />
                  <span className="mono">{b.numero}</span>
                  <span className="nom">{b.nombre}</span>
                  {g.e !== 'terminada'
                    ? <span className={`meter ${n >= 5 ? 'ok' : n >= 3 ? 'mid' : 'low'}`} title="Meses con bitácora + inspección (últimos 6)"><i style={{ width: `${(n / 6) * 100}%` }} />{n}/6</span>
                    : <span className="meter na">terminada</span>}
                  {(() => { const i = proximoInforme(b, todayISO()); return i ? <span className={`inf-chip st-${i.estado}`}>Informe {i.vence}</span> : null; })()}
                  <button type="button" className="icon-btn sm" title="Editar" onClick={e => { e.preventDefault(); abrirEditor(b); }}><Ic n="edit" /></button>
                </label>
              );
            })}
          </section>
        ))}
        {!d.bitacoras.length && <p className="modal-text center">Aún no hay bitácoras. Importa el PDF o crea la primera.</p>}
      </div>

      <label className="modal-label" htmlFor="rev_notas">Notas de la revisión</label>
      <textarea id="rev_notas" className="modal-input" rows={2} value={notas} onChange={e => setNotas(e.target.value)} placeholder="Acuerdos, pendientes con SETENA, cierres por solicitar…" />
      <div className="modal-btns">
        <button className="modal-btn cancel" onClick={() => setRev(rev.length === d.bitacoras.length ? [] : d.bitacoras.map(b => b.id))}>
          {rev.length === d.bitacoras.length ? 'Desmarcar todas' : 'Marcar todas'}
        </button>
        <span className="grow" />
        <button className="modal-btn cancel" onClick={cerrarModal}>Cerrar</button>
        <button className="modal-btn ok" onClick={guardar}>Guardar acta</button>
      </div>
    </>
  );
}
