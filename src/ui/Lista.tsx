// ===== Lista de bitácoras (al lado del micro-calendario) =====
// Fila: color · número · proyecto · estado · día de aviso · registro del mes · acciones.
// El punto de color y la etiqueta de estado abren un selector rápido (reasignar sin abrir el editor).
import { useState } from 'react';
import type { Bitacora, Datos, Estado } from '../lib/types';
import { ESTADOS, estadoNombre, generaMensual } from '../lib/types';
import { registradoEn, siguienteMensual, tocaEnMes } from '../lib/avisos';
import { fechaCorta, todayISO, nombreMesKey } from '../lib/fechas';
import { mutar, registrarMes } from '../lib/store';
import { Ic, Popover, toast } from './core';
import { abrirEditor } from './Editor';

export type FiltroEstado = 'todas' | Estado | 'pendientes';

export function Lista({ d, lista, vacio }: { d: Datos; lista: Bitacora[]; vacio: React.ReactNode }) {
  const [pop, setPop] = useState<{ el: HTMLElement; b: Bitacora; tipo: 'color' | 'estado' } | null>(null);
  const mk = todayISO().slice(0, 7), hoy = todayISO();
  const et = (id: string) => d.etiquetas.find(e => e.id === id);

  if (!lista.length) return <div className="lista-vacia">{vacio}</div>;

  return (
    <>
      <div className="lista" role="list">
        {lista.map(b => {
          const e = et(b.etiquetaId);
          const reg = registradoEn(b, mk);
          const sig = siguienteMensual(b, hoy);
          const atrasada = !!sig?.vencida;
          return (
            <div key={b.id} role="listitem" className={`fila est-${b.estado} ${atrasada ? 'atrasada' : ''}`} style={{ ['--ec' as any]: e?.color ?? '#888' }}
              draggable onDragStart={ev => { ev.dataTransfer.setData('text/bitacora', b.id); ev.dataTransfer.effectAllowed = 'move'; (ev.currentTarget as HTMLElement).classList.add('dragging'); }}
              onDragEnd={ev => (ev.currentTarget as HTMLElement).classList.remove('dragging')}
              onDoubleClick={() => abrirEditor(b)}>
              <button className="color-dot" title={`Prioridad: ${e?.nombre ?? '—'} (clic para cambiar)`}
                onClick={ev => setPop({ el: ev.currentTarget, b, tipo: 'color' })} />
              <div className="fila-main" onClick={() => abrirEditor(b)} title="Editar">
                <div className="fila-top">
                  <span className="num mono">{b.numero}</span>
                  <span className="arrow">→</span>
                  <span className="nom">{b.nombre}</span>
                </div>
                <div className="fila-sub">
                  {generaMensual(b.estado)
                    ? <span className={atrasada ? 'warn' : ''}><Ic n="bell" size={12} /> día {b.diaAviso}{sig ? (atrasada ? ` · vencido ${fechaCorta(sig.fecha)}` : ` · próximo ${fechaCorta(sig.fecha)}`) : ''}</span>
                    : <span><Ic n="flag" size={12} /> sin aviso mensual</span>}
                  {b.ultimaActualizacion && <span>Actualizada {fechaCorta(b.ultimaActualizacion)}</span>}
                  {b.notas && <span className="nota" title={b.notas}><Ic n="notes" size={12} /> {b.notas}</span>}
                </div>
              </div>
              <button className={`est-chip est-${b.estado}`} title="Cambiar estado" onClick={ev => setPop({ el: ev.currentTarget, b, tipo: 'estado' })}>
                {ESTADOS.find(s => s.id === b.estado)?.corto}
              </button>
              {generaMensual(b.estado) && (tocaEnMes(b, mk) || reg)
                ? <button className={`reg-btn ${reg ? 'on' : ''}`} title={reg ? `Registrada en ${nombreMesKey(mk)} (clic para desmarcar)` : `Marcar registrada en ${nombreMesKey(mk)}`}
                  onClick={() => { registrarMes(b.id, mk, !reg); toast(reg ? `${b.numero}: registro de ${nombreMesKey(mk)} desmarcado` : `✓ ${b.numero} registrada en ${nombreMesKey(mk)}`, true); }}>
                  <Ic n="check" size={14} /><span>{reg ? 'Registrada' : 'Registrar'}</span>
                </button>
                : <span className="reg-btn na" title={generaMensual(b.estado) ? 'El seguimiento empieza después de este mes' : 'Solicitud de cierre: no requiere registro mensual'}>—</span>}
              <button className="icon-btn sm" title="Editar" onClick={() => abrirEditor(b)}><Ic n="edit" /></button>
            </div>
          );
        })}
      </div>

      {pop && (
        <Popover anchor={pop.el} onClose={() => setPop(null)} width={220}>
          {pop.tipo === 'color' ? (
            <>
              <div className="pop-title">Prioridad de {pop.b.numero}</div>
              {d.etiquetas.map(e => (
                <button key={e.id} className={`pop-opt ${pop.b.etiquetaId === e.id ? 'on' : ''}`} style={{ ['--ec' as any]: e.color }}
                  onClick={() => { mutar(dd => { const x = dd.bitacoras.find(y => y.id === pop.b.id); if (x) x.etiquetaId = e.id; }); setPop(null); toast(`${pop.b.numero} → ${e.nombre}`, true); }}>
                  <span className="dot" />{e.nombre}{pop.b.etiquetaId === e.id && <Ic n="check" size={14} />}
                </button>
              ))}
            </>
          ) : (
            <>
              <div className="pop-title">Estado de {pop.b.numero}</div>
              {ESTADOS.map(s => (
                <button key={s.id} className={`pop-opt est-${s.id} ${pop.b.estado === s.id ? 'on' : ''}`}
                  onClick={() => { mutar(dd => { const x = dd.bitacoras.find(y => y.id === pop.b.id); if (x) x.estado = s.id; }); setPop(null); toast(`${pop.b.numero} → ${estadoNombre(s.id)}`, true); }}>
                  <span className={`est-dot est-${s.id}`} />{s.nombre}{pop.b.estado === s.id && <Ic n="check" size={14} />}
                </button>
              ))}
              <small className="pop-hint">{generaMensual(pop.b.estado) ? 'Solicitud de Cierre quita el aviso mensual.' : 'Abierta o Nueva reactivan el aviso mensual.'}</small>
            </>
          )}
        </Popover>
      )}
    </>
  );
}
