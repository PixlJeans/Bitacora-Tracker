// ===== Vistas «Próximos informes», «Mes actual» y «Mes próximo» =====
import type { Datos } from '../lib/types';
import { estadoNombre } from '../lib/types';
import { completoEn, proximosInformes, rangoBloque, tareasDelMes, type InfoInforme } from '../lib/avisos';
import { fechaCorta, fechaLarga, nombreMesKey, todayISO } from '../lib/fechas';
import { marcarInforme } from '../lib/store';
import { Ic, toast } from './core';
import { abrirEditor } from './Editor';
import { ChecksMes } from './Lista';

export type Vista = 'todas' | 'informes' | 'mes' | 'proximo';

const colorDe = (d: Datos, id: string) => d.etiquetas.find(e => e.id === id)?.color ?? '#888';

function BotonEntregado({ id, numero, vence, entregado }: { id: string; numero: string; vence: string; entregado: boolean }) {
  return (
    <button className={`reg-btn ${entregado ? 'on' : ''}`} title={entregado ? 'Entregado (clic para desmarcar)' : 'Marcar informe como entregado'}
      onClick={() => { marcarInforme(id, vence, !entregado); toast(entregado ? `${numero}: informe del ${fechaCorta(vence)} desmarcado` : `✓ ${numero}: informe del ${fechaCorta(vence)} entregado`, true); }}>
      <Ic n="check" size={13} /><span>{entregado ? 'Entregado' : 'Entregar'}</span>
    </button>
  );
}

const ESTADO_INF = { vencido: 'Vencido', aviso: 'En aviso', futuro: 'Próximo' } as const;

export function VistaInformes({ d }: { d: Datos }) {
  const hoy = todayISO();
  const lista = proximosInformes(d, hoy);
  if (!lista.length) return <div className="lista-vacia"><p>No hay informes regenciales pendientes.</p></div>;
  const grupos: [string, InfoInforme[]][] = [
    ['Vencidos', lista.filter(i => i.estado === 'vencido')],
    ['En periodo de aviso (último mes)', lista.filter(i => i.estado === 'aviso')],
    ['Próximos', lista.filter(i => i.estado === 'futuro')]
  ];
  return (
    <div className="lista vista">
      <p className="vista-nota"><Ic n="review" size={14} /> Cada informe regencial vence cada 6 meses desde la fecha de apertura; los avisos empiezan 1 mes antes.</p>
      {grupos.filter(([, l]) => l.length).map(([titulo, l]) => (
        <section key={titulo}>
          <h4 className="vista-h">{titulo} <small>{l.length}</small></h4>
          {l.map(i => (
            <div key={i.b.id} className={`fila inf st-${i.estado}`} style={{ ['--ec' as any]: colorDe(d, i.b.etiquetaId) }}>
              <div className={`inf-fecha st-${i.estado}`}><b>{fechaCorta(i.vence)}</b><small>{i.vence.slice(0, 4)}</small></div>
              <div className="fila-main" onClick={() => abrirEditor(i.b)}>
                <div className="fila-top"><span className="num mono">{i.b.numero}</span><span className="arrow">→</span><span className="nom">{i.b.nombre}</span></div>
                <div className="fila-sub">
                  <span className={i.estado === 'vencido' ? 'warn' : ''}>{i.estado === 'vencido' ? `venció hace ${-i.dias} días` : i.dias === 0 ? 'vence hoy' : `faltan ${i.dias} días`}</span>
                  <span>Informe #{i.numero} · apertura {fechaCorta(i.b.apertura)} {i.b.apertura.slice(0, 4)}</span>
                  <span>avisos desde {fechaCorta(i.desde)}</span>
                  <span>{estadoNombre(i.b.estado)}</span>
                </div>
              </div>
              <span className={`inf-chip st-${i.estado}`}>{ESTADO_INF[i.estado]}</span>
              <BotonEntregado id={i.b.id} numero={i.b.numero} vence={i.vence} entregado={false} />
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

export function VistaMes({ d, mk }: { d: Datos; mk: string }) {
  const t = tareasDelMes(d, mk);
  const hoy = todayISO();
  const hechos = t.mensuales.filter(x => completoEn(x.b, mk)).length;
  // agrupa las tareas mensuales por bloque de tiempo (los «bloques» del calendario)
  const grupos = new Map<string, typeof t.mensuales>();
  t.mensuales.forEach(x => {
    const k = x.bloque ? x.bloque.id : `dia-${x.fecha}`;
    grupos.set(k, [...(grupos.get(k) ?? []), x]);
  });
  return (
    <div className="lista vista">
      <div className="mes-resumen">
        <div><b>{t.mensuales.length}</b><span>bitácora + inspección</span></div>
        <div className={hechos === t.mensuales.length ? 'ok' : ''}><b>{hechos}/{t.mensuales.length}</b><span>completas</span></div>
        <div><b>{t.informes.filter(i => !i.entregado).length}</b><span>informes vencen</span></div>
        <div><b>{t.avisosInforme.length}</b><span>informes entran en aviso</span></div>
      </div>

      {(t.informes.length > 0 || t.avisosInforme.length > 0) && (
        <section>
          <h4 className="vista-h">Informes regenciales · {nombreMesKey(mk)}</h4>
          {t.informes.map(x => (
            <div key={x.b.id + x.vence} className={`fila inf ${x.entregado ? '' : x.vence < hoy ? 'st-vencido' : 'st-aviso'}`} style={{ ['--ec' as any]: colorDe(d, x.b.etiquetaId) }}>
              <div className="inf-fecha"><b>{fechaCorta(x.vence)}</b><small>vence</small></div>
              <div className="fila-main" onClick={() => abrirEditor(x.b)}>
                <div className="fila-top"><span className="num mono">{x.b.numero}</span><span className="arrow">→</span><span className="nom">{x.b.nombre}</span></div>
                <div className="fila-sub"><span>Informe regencial · apertura {fechaCorta(x.b.apertura)} {x.b.apertura.slice(0, 4)}</span></div>
              </div>
              <BotonEntregado id={x.b.id} numero={x.b.numero} vence={x.vence} entregado={x.entregado} />
            </div>
          ))}
          {t.avisosInforme.map(x => (
            <div key={'a' + x.b.id + x.vence} className="fila inf st-futuro" style={{ ['--ec' as any]: colorDe(d, x.b.etiquetaId) }}>
              <div className="inf-fecha"><b>{fechaCorta(x.desde)}</b><small>aviso</small></div>
              <div className="fila-main" onClick={() => abrirEditor(x.b)}>
                <div className="fila-top"><span className="num mono">{x.b.numero}</span><span className="arrow">→</span><span className="nom">{x.b.nombre}</span></div>
                <div className="fila-sub"><span>Empiezan los avisos del informe que vence el {fechaLarga(x.vence)}</span></div>
              </div>
            </div>
          ))}
        </section>
      )}

      <section>
        <h4 className="vista-h">Llenado de bitácora e inspección · {nombreMesKey(mk)}</h4>
        {!t.mensuales.length && <p className="muted vista-nota">Ninguna bitácora activa tiene tarea este mes.</p>}
        {[...grupos.entries()].map(([k, items]) => {
          const bl = items[0].bloque;
          return (
            <div key={k} className="bloque-grupo" style={{ ['--bc' as any]: bl?.color ?? 'var(--border)' }}>
              <div className="bloque-h">
                <i />{bl ? <><b>{bl.nombre}</b> · {fechaLarga(items[0].fecha)} · {rangoBloque(bl)}</> : <><b>Sin bloque</b> · {fechaLarga(items[0].fecha)} · {items[0].hora}</>}
                <small>{items.filter(x => completoEn(x.b, mk)).length}/{items.length}</small>
              </div>
              {items.map(({ b, fecha }) => (
                <div key={b.id} className={`fila ${!completoEn(b, mk) && fecha <= hoy ? 'atrasada' : ''}`} style={{ ['--ec' as any]: colorDe(d, b.etiquetaId) }}>
                  <span className="avance-chip static"><i />{d.etiquetas.find(e => e.id === b.etiquetaId)?.nombre ?? '—'}</span>
                  <div className="fila-main" onClick={() => abrirEditor(b)}>
                    <div className="fila-top"><span className="num mono">{b.numero}</span><span className="arrow">→</span><span className="nom">{b.nombre}</span></div>
                  </div>
                  <ChecksMes b={b} mk={mk} />
                </div>
              ))}
            </div>
          );
        })}
      </section>
    </div>
  );
}
