// ===== Fila de proyecto (pestañas) =====
// Una sola línea por proyecto, en columnas:
//   Avance · Código · Nombre · Próxima fecha · Estado · B · I · Entregado · Editar
// El calendario de revisiones vive DENTRO del editor (ver CalendarioProyecto.tsx).
import { useState } from 'react';
import type { Bitacora, Datos, Estado } from '../lib/types';
import { ESTADOS, estadoNombre, estaActiva } from '../lib/types';
import { fechaMensual, informeEntregado, inspeccionadoEn, proximoInforme, registradoEn, siguienteMensual, tocaEnMes } from '../lib/avisos';
import { fechaCorta, nombreMesKey, todayISO } from '../lib/fechas';
import { archivar, marcarInforme, marcarMes, mutar } from '../lib/store';
import { Ic, Popover, toast } from './core';
import { abrirEditor } from './Editor';

export type Modo = { tipo: 'normal' } | { tipo: 'mes'; mk: string } | { tipo: 'informe' };

export function Cabecera() {
  return (
    <div className="fila-h" aria-hidden>
      <span>Avance</span><span>Código</span><span>Proyecto</span><span>Próxima fecha</span><span>Estado</span>
      <span title="Bitácora del mes">B</span><span title="Inspección del mes">I</span><span>Informe</span><span />
    </div>
  );
}

export function Proyecto({ d, b, modo = { tipo: 'normal' }, data }: { d: Datos; b: Bitacora; modo?: Modo; data?: string }) {
  const hoy = todayISO();
  const [pop, setPop] = useState<{ el: HTMLElement; tipo: 'avance' | 'estado' } | null>(null);
  const et = d.etiquetas.find(e => e.id === b.etiquetaId);
  const activa = estaActiva(b);
  const inf = proximoInforme(b, hoy);
  const sig = siguienteMensual(b, hoy);

  // Mes al que se refieren B e I: el de la pestaña, o el de la próxima revisión pendiente (o el actual)
  const mk = modo.tipo === 'mes' ? modo.mk : (sig && sig.mes <= hoy.slice(0, 7) ? sig.mes : hoy.slice(0, 7));
  const tocaMes = activa && tocaEnMes(b, mk);
  const reg = registradoEn(b, mk), ins = inspeccionadoEn(b, mk);

  // Próxima fecha: la más cercana entre revisión mensual e informe (o la de la pestaña)
  let fecha: { f: string; tipo: 'Revisión' | 'Informe'; vencida: boolean } | null = null;
  if (activa) {
    if (modo.tipo === 'mes') fecha = { f: fechaMensual(b, modo.mk), tipo: 'Revisión', vencida: fechaMensual(b, modo.mk) <= hoy && !(reg && ins) };
    else if (modo.tipo === 'informe' && inf) fecha = { f: inf.vence, tipo: 'Informe', vencida: inf.estado === 'vencido' };
    else {
      const cands = [
        sig && { f: sig.fecha, tipo: 'Revisión' as const, vencida: sig.vencida },
        inf && { f: inf.vence, tipo: 'Informe' as const, vencida: inf.estado === 'vencido' }
      ].filter(Boolean) as { f: string; tipo: 'Revisión' | 'Informe'; vencida: boolean }[];
      fecha = cands.sort((a, c) => a.f.localeCompare(c.f))[0] ?? null;
    }
  }

  const set = (f: (x: Bitacora) => void, msg: string) => {
    mutar(dd => { const x = dd.bitacoras.find(y => y.id === b.id); if (x) f(x); });
    setPop(null); toast(msg, true);
  };
  function cambiarEstado(e: Estado) {
    set(x => { x.estado = e; }, `${b.numero} → ${estadoNombre(e)}`);
    if (e === 'terminada') setTimeout(() => toast(`${b.numero} terminada: ya no genera revisiones. Archívala con 📦.`), 50);
  }

  const entregado = inf ? informeEntregado(b, inf.vence) : false;

  return (
    <div className={`fila2 est-${b.estado} ${b.archivada ? 'archivada' : ''} ${fecha?.vencida ? 'atrasada' : ''}`} style={{ ['--ec' as any]: et?.color ?? '#888' }} data-tour={data}>
      <button className="avance-chip" data-tour={data ? 'avance' : undefined} title="Avance (clic para cambiar)" onClick={ev => setPop({ el: ev.currentTarget, tipo: 'avance' })}><i />{et?.nombre ?? '—'}</button>
      <span className="c-num mono" onClick={() => abrirEditor(b)}>{b.numero}</span>
      <span className="c-nom" onClick={() => abrirEditor(b)} title={b.nombre}>{b.nombre}</span>
      <span className={`c-fecha ${fecha?.vencida ? 'venc' : ''} ${fecha?.tipo === 'Informe' ? 'inf' : ''}`} title={fecha ? `${fecha.tipo}: ${fecha.f}` : ''}>
        {fecha ? <><b>{fechaCorta(fecha.f)}{fecha.f.slice(0, 4) !== hoy.slice(0, 4) ? ` ${fecha.f.slice(0, 4)}` : ''}</b><small>{fecha.tipo}{fecha.vencida ? ' · vencida' : ''}</small></> : <small className="muted">{b.archivada ? 'Archivada' : '—'}</small>}
      </span>
      <button className={`est-chip est-${b.estado}`} title="Cambiar estado" onClick={ev => setPop({ el: ev.currentTarget, tipo: 'estado' })}>{ESTADOS.find(s => s.id === b.estado)?.corto}</button>
      {tocaMes ? <>
        <button className={`ck ${reg ? 'on' : ''}`} data-tour={data ? 'mensual' : undefined} title={`Bitácora · ${nombreMesKey(mk)}`}
          onClick={() => { marcarMes(b.id, mk, 'bitacora', !reg); toast(reg ? `${b.numero}: bitácora desmarcada` : `✓ ${b.numero}: bitácora de ${nombreMesKey(mk)}`, true); }}><Ic n="check" size={13} /></button>
        <button className={`ck ${ins ? 'on' : ''}`} title={`Inspección · ${nombreMesKey(mk)}`}
          onClick={() => { marcarMes(b.id, mk, 'inspeccion', !ins); toast(ins ? `${b.numero}: inspección desmarcada` : `✓ ${b.numero}: inspección de ${nombreMesKey(mk)}`, true); }}><Ic n="check" size={13} /></button>
      </> : <><span className="ck na">—</span><span className="ck na">—</span></>}
      {inf ? (
        <button className={`ent st-${inf.estado} ${entregado ? 'on' : ''}`} title={`Informe regencial del ${inf.vence} (avisos desde ${inf.desde})`}
          onClick={() => { marcarInforme(b.id, inf.vence, true); toast(`✓ ${b.numero}: informe del ${fechaCorta(inf.vence)} entregado`, true); }}>
          <Ic n="check" size={12} />Entregado</button>
      ) : <span className="ent na">—</span>}
      <span className="c-acc">
        {(b.estado === 'terminada' || b.archivada) && (
          <button className="icon-btn sm" title={b.archivada ? 'Restaurar a la lista activa' : 'Archivar (sale de la lista, no se borra)'}
            onClick={() => { archivar(b.id, !b.archivada); toast(b.archivada ? `${b.numero} restaurada` : `📦 ${b.numero} archivada`, true); }}>
            <Ic n={b.archivada ? 'upload' : 'download'} /></button>
        )}
        <button className="icon-btn sm" title="Editar y ver su calendario" onClick={() => abrirEditor(b)}><Ic n="edit" /></button>
      </span>

      {pop && (
        <Popover anchor={pop.el} onClose={() => setPop(null)} width={220}>
          {pop.tipo === 'avance' ? <>
            <div className="pop-title">Avance de {b.numero}</div>
            {d.etiquetas.map(e => (
              <button key={e.id} className={`pop-opt ${b.etiquetaId === e.id ? 'on' : ''}`} style={{ ['--ec' as any]: e.color }}
                onClick={() => set(x => { x.etiquetaId = e.id; }, `${b.numero} → ${e.nombre}`)}>
                <span className="dot" />{e.nombre}{b.etiquetaId === e.id && <Ic n="check" size={14} />}
              </button>))}
          </> : <>
            <div className="pop-title">Estado de {b.numero}</div>
            {ESTADOS.map(s => (
              <button key={s.id} className={`pop-opt est-${s.id} ${b.estado === s.id ? 'on' : ''}`} onClick={() => cambiarEstado(s.id)}>
                <span className={`est-dot est-${s.id}`} />{s.nombre}{b.estado === s.id && <Ic n="check" size={14} />}
              </button>))}
            <small className="pop-hint">Las revisiones se calculan solas desde la apertura. «Terminada» las detiene.</small>
          </>}
        </Popover>
      )}
    </div>
  );
}
