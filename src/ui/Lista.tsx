// ===== Lista de bitácoras (vista «Todas», al lado del micro-calendario) =====
// Fila: color · número → proyecto · bloque / próximo aviso / informe · estado · bitácora ✓ · inspección ✓ · editar.
// El punto de color y la etiqueta de estado abren un selector rápido (reasignar sin abrir el editor).
import { useState, type ReactNode } from 'react';
import type { Bitacora, Datos, Estado } from '../lib/types';
import { ESTADOS, estadoNombre, generaMensual } from '../lib/types';
import { bloqueDe, inspeccionadoEn, proximoInforme, rangoBloque, registradoEn, siguienteMensual, tocaEnMes } from '../lib/avisos';
import { fechaCorta, todayISO, nombreMesKey } from '../lib/fechas';
import { marcarMes, mutar, type TareaMes } from '../lib/store';
import { Ic, Popover, toast } from './core';
import { DatePick } from './DatePick';
import { abrirEditor } from './Editor';

export type FiltroEstado = 'todas' | Estado | 'pendientes';

/** Los dos botones del mes: llenado de bitácora + inspección. Se reutiliza en las vistas de mes. */
export function ChecksMes({ b, mk, compacto }: { b: Bitacora; mk: string; compacto?: boolean }) {
  const t = (tarea: TareaMes, on: boolean, txt: string) => {
    marcarMes(b.id, mk, tarea, !on);
    toast(on ? `${b.numero}: ${txt} de ${nombreMesKey(mk)} desmarcada` : `✓ ${b.numero}: ${txt} de ${nombreMesKey(mk)}`, true);
  };
  const reg = registradoEn(b, mk), ins = inspeccionadoEn(b, mk);
  return (
    <span className={`checks ${compacto ? 'compacto' : ''}`}>
      <button className={`reg-btn ${reg ? 'on' : ''}`} title={`Llenado de bitácora · ${nombreMesKey(mk)}`} onClick={() => t('bitacora', reg, 'bitácora llenada')}>
        <Ic n="check" size={13} /><span className="lg">Bitácora</span><span className="sh">B</span>
      </button>
      <button className={`reg-btn ${ins ? 'on' : ''}`} title={`Inspección · ${nombreMesKey(mk)}`} onClick={() => t('inspeccion', ins, 'inspección hecha')}>
        <Ic n="check" size={13} /><span className="lg">Inspección</span><span className="sh">I</span>
      </button>
    </span>
  );
}

export function InformeChip({ b, hoy, soloUrgente }: { b: Bitacora; hoy: string; soloUrgente?: boolean }) {
  const inf = proximoInforme(b, hoy);
  if (!inf || (soloUrgente && inf.estado === 'futuro')) return null;
  const txt = inf.estado === 'vencido' ? `Informe vencido ${fechaCorta(inf.vence)}`
    : inf.estado === 'aviso' ? `Informe en ${inf.dias} d · ${fechaCorta(inf.vence)}` : `Informe ${fechaCorta(inf.vence)}`;
  return <span className={`inf-chip st-${inf.estado}`} title={`Informe regencial #${inf.numero}: vence ${inf.vence} · avisos desde ${inf.desde}`}><Ic n="review" size={12} /> {txt}</span>;
}

export function Lista({ d, lista, vacio }: { d: Datos; lista: Bitacora[]; vacio: ReactNode }) {
  const [pop, setPop] = useState<{ el: HTMLElement; b: Bitacora; tipo: 'color' | 'estado' | 'bloque' | 'fecha' } | null>(null);
  const hoy = todayISO(), mk = hoy.slice(0, 7);
  const et = (id: string) => d.etiquetas.find(e => e.id === id);

  if (!lista.length) return <div className="lista-vacia">{vacio}</div>;

  const set = (id: string, f: (b: Bitacora) => void, msg: string) => {
    mutar(dd => { const x = dd.bitacoras.find(y => y.id === id); if (x) f(x); });
    setPop(null); toast(msg, true);
  };

  return (
    <>
      <div className="lista" role="list">
        {lista.map((b, n) => {
          const e = et(b.etiquetaId);
          const sig = siguienteMensual(d, b, hoy);
          const atrasada = !!sig?.vencida;
          const bl = bloqueDe(d, b);
          return (
            <div key={b.id} role="listitem" className={`fila est-${b.estado} ${atrasada ? 'atrasada' : ''}`} style={{ ['--ec' as any]: e?.color ?? '#888' }}
              draggable onDragStart={ev => { ev.dataTransfer.setData('text/bitacora', b.id); ev.dataTransfer.effectAllowed = 'move'; (ev.currentTarget as HTMLElement).classList.add('dragging'); }}
              onDragEnd={ev => (ev.currentTarget as HTMLElement).classList.remove('dragging')}>
              <button className="avance-chip" data-tour={n === 0 ? 'avance' : undefined} title={`Avance: ${e?.nombre ?? '—'} (clic para cambiar)`}
                onClick={ev => setPop({ el: ev.currentTarget, b, tipo: 'color' })}><i />{e?.nombre ?? '—'}</button>
              <div className="fila-main" onClick={() => abrirEditor(b)} title="Editar">
                <div className="fila-top">
                  <span className="num mono">{b.numero}</span>
                  <span className="arrow">→</span>
                  <span className="nom">{b.nombre}</span>
                </div>
                <div className="fila-sub">
                  <button className="fecha-btn" title="Fecha de apertura (clic para cambiar)"
                    onClick={ev => { ev.stopPropagation(); setPop({ el: ev.currentTarget, b, tipo: 'fecha' }); }}>
                    <Ic n="flag" size={12} /> Apertura {fechaCorta(b.apertura)} {b.apertura.slice(0, 4)}</button>
                  {generaMensual(b.estado) && (
                    <span className={atrasada ? 'warn' : ''}><Ic n="bell" size={12} />
                      {sig ? (atrasada ? ` pendiente desde ${fechaCorta(sig.fecha)}` : ` ${fechaCorta(sig.fecha)}`) : ' al día'}
                    </span>
                  )}
                  <InformeChip b={b} hoy={hoy} soloUrgente />
                </div>
              </div>
              <button className="bloque-chip" style={{ ['--bc' as any]: bl?.color ?? 'var(--border)' }} title={bl ? `${bl.nombre} · día ${bl.dia} · ${rangoBloque(bl)}` : 'Sin bloque: clic para asignar'}
                onClick={ev => setPop({ el: ev.currentTarget, b, tipo: 'bloque' })}>
                {bl ? <><i />{bl.nombre}</> : <>día {b.diaAviso}</>}
              </button>
              <button className={`est-chip est-${b.estado}`} title="Cambiar estado" onClick={ev => setPop({ el: ev.currentTarget, b, tipo: 'estado' })}>
                {ESTADOS.find(s => s.id === b.estado)?.corto}
              </button>
              {tocaEnMes(d, b, mk) || registradoEn(b, mk) || inspeccionadoEn(b, mk)
                ? <span data-tour={n === lista.findIndex(x => tocaEnMes(d, x, mk)) ? 'mensual' : undefined}><ChecksMes b={b} mk={mk} compacto /></span>
                : <span className="checks na" title={generaMensual(b.estado) ? 'Su seguimiento mensual empieza después de este mes' : 'Solicitud de cierre: sin tarea mensual'}>—</span>}
              <button className="icon-btn sm" title="Editar" onClick={() => abrirEditor(b)}><Ic n="edit" /></button>
            </div>
          );
        })}
      </div>

      {pop && (
        <Popover anchor={pop.el} onClose={() => setPop(null)} width={pop.tipo === 'fecha' ? 270 : 240}>
          {pop.tipo === 'color' && <>
            <div className="pop-title">Avance de {pop.b.numero}</div>
            {d.etiquetas.map(e => (
              <button key={e.id} className={`pop-opt ${pop.b.etiquetaId === e.id ? 'on' : ''}`} style={{ ['--ec' as any]: e.color }}
                onClick={() => set(pop.b.id, x => { x.etiquetaId = e.id; }, `${pop.b.numero} → ${e.nombre}`)}>
                <span className="dot" />{e.nombre}{pop.b.etiquetaId === e.id && <Ic n="check" size={14} />}
              </button>
            ))}
          </>}
          {pop.tipo === 'fecha' && <>
            <div className="pop-title">Fecha de apertura de {pop.b.numero}</div>
            <DatePick value={pop.b.apertura} onChange={v => v && set(pop.b.id, x => { x.apertura = v; }, `${pop.b.numero}: apertura ${fechaCorta(v)} ${v.slice(0, 4)} (informes recalculados)`)} />
            <small className="pop-hint">El informe regencial se recalcula: vence cada 6 meses desde esta fecha.</small>
          </>}
          {pop.tipo === 'estado' && <>
            <div className="pop-title">Estado de {pop.b.numero}</div>
            {ESTADOS.map(s => (
              <button key={s.id} className={`pop-opt est-${s.id} ${pop.b.estado === s.id ? 'on' : ''}`}
                onClick={() => set(pop.b.id, x => { x.estado = s.id; }, `${pop.b.numero} → ${estadoNombre(s.id)}`)}>
                <span className={`est-dot est-${s.id}`} />{s.nombre}{pop.b.estado === s.id && <Ic n="check" size={14} />}
              </button>
            ))}
            <small className="pop-hint">{generaMensual(pop.b.estado) ? 'Solicitud de Cierre quita la tarea mensual (el informe regencial sigue).' : 'Abierta o Nueva reactivan bitácora + inspección mensual.'}</small>
          </>}
          {pop.tipo === 'bloque' && <>
            <div className="pop-title">Bloque de tiempo de {pop.b.numero}</div>
            {d.bloques.map(bl => (
              <button key={bl.id} className={`pop-opt ${pop.b.bloqueId === bl.id ? 'on' : ''}`} style={{ ['--ec' as any]: bl.color }}
                onClick={() => set(pop.b.id, x => { x.bloqueId = bl.id; }, `${pop.b.numero} → ${bl.nombre} (día ${bl.dia}, ${rangoBloque(bl)})`)}>
                <span className="dot" />{bl.nombre}<small className="muted">día {bl.dia} · {rangoBloque(bl)}</small>{pop.b.bloqueId === bl.id && <Ic n="check" size={14} />}
              </button>
            ))}
            <button className={`pop-opt ${!pop.b.bloqueId ? 'on' : ''}`} onClick={() => set(pop.b.id, x => { x.bloqueId = null; }, `${pop.b.numero}: sin bloque (día ${pop.b.diaAviso})`)}>
              <span className="dot" style={{ background: 'var(--border)', boxShadow: 'none' }} />Sin bloque (día {pop.b.diaAviso}){!pop.b.bloqueId && <Ic n="check" size={14} />}
            </button>
            <small className="pop-hint">Los bloques se editan en Ajustes → Bloques de tiempo.</small>
          </>}
        </Popover>
      )}
    </>
  );
}
