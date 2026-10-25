// ===== Bitácora Tracker: pantalla principal =====
// Estructura invertida: la LISTA de proyectos es lo principal y cada proyecto lleva su propio
// mini-calendario de revisiones. Pestañas: Activas · Mes actual · Mes próximo · Próximos informes · Archivadas.
// Misma arquitectura que el calendario de Cognose: Store único → vistas que solo dibujan → ventanas comunes.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useDatos, estaListo, Undo } from './lib/store';
import type { Bitacora, Estado } from './lib/types';
import { estaActiva } from './lib/types';
import { completoEn, proximosInformes, resumen, siguienteMensual, tareasDelMes, type InfoInforme } from './lib/avisos';
import { coincide } from './lib/buscar';
import { mesKey, nombreMesKey, todayISO } from './lib/fechas';
import { AvisoCards } from './ui/AvisoCards';
import { AjustesPanel, aplicarApariencia, toggleAjustes } from './ui/Ajustes';
import { Ic, ModalHost, ToastHost, hayModal, toast } from './ui/core';
import { abrirEditor } from './ui/Editor';
import { abrirImportar, importacionPausada } from './ui/Importar';
import { Cabecera, Proyecto, type Modo } from './ui/Proyecto';
import { abrirRevision } from './ui/Revision';
import { Tutorial, abrirTutorial } from './ui/Tutorial';
import { backend } from './lib/backend';
import { aCsv } from './lib/csv';

type Vista = 'activas' | 'mes' | 'proximo' | 'informes' | 'archivo';
type Orden = 'proxima' | 'avance' | 'numero' | 'nombre' | 'apertura';
type FiltroEstado = 'todas' | Estado | 'pendientes';

const LS_VISTA = 'bt_vista';

export default function App() {
  const d = useDatos();
  const [vista, setVistaS] = useState<Vista>(() => { try { const v = localStorage.getItem(LS_VISTA) as Vista; return ['activas', 'mes', 'proximo', 'informes', 'archivo'].includes(v) ? v : 'activas'; } catch { return 'activas'; } });
  const [filtro, setFiltro] = useState<FiltroEstado>('todas');
  const [etq, setEtq] = useState<string | null>(null);
  const [orden, setOrden] = useState<Orden>('proxima');
  const [q, setQ] = useState('');
  const [dropAll, setDropAll] = useState(false);
  const buscarRef = useRef<HTMLInputElement>(null);
  const setVista = (v: Vista) => { setVistaS(v); setQ(''); try { localStorage.setItem(LS_VISTA, v); } catch { /* opcional */ } };

  useEffect(() => { aplicarApariencia(d.ajustes); }, [d.ajustes]);
  useEffect(() => { if (!d.ajustes.tutorialVisto) { const t = setTimeout(abrirTutorial, 700); return () => clearTimeout(t); } }, [d.ajustes.tutorialVisto]);
  useEffect(() => {
    const f = (e: Event) => {
      const v = String((e as CustomEvent).detail);
      const mapa: Record<string, Vista> = { todas: 'activas', activas: 'activas', mes: 'mes', pendientes: 'mes', proximo: 'proximo', informes: 'informes', archivo: 'archivo' };
      setVista(mapa[v] ?? 'activas'); setFiltro('todas'); setEtq(null);
    };
    window.addEventListener('bt:vista', f);
    return () => window.removeEventListener('bt:vista', f);
  }, []);

  const TABS: { id: Vista; txt: string; tecla: string }[] = [
    { id: 'activas', txt: 'Activas', tecla: '1' }, { id: 'mes', txt: 'Mes actual', tecla: '2' }, { id: 'proximo', txt: 'Mes próximo', tecla: '3' },
    { id: 'informes', txt: 'Próximos informes', tecla: '4' }, { id: 'archivo', txt: 'Archivadas', tecla: '5' }
  ];

  useEffect(() => {
    const k = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && !(ev.target as HTMLElement).closest('input,textarea')) {
        ev.preventDefault(); if (Undo.pop()) toast('Deshecho'); return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'f') { ev.preventDefault(); buscarRef.current?.focus(); return; }
      if (ev.ctrlKey || ev.metaKey || ev.altKey || hayModal() || document.querySelector('.tour')) return;
      if ((ev.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) { if (ev.key === 'Escape') (ev.target as HTMLElement).blur(); return; }
      const t = TABS.find(x => x.tecla === ev.key);
      if (t) { ev.preventDefault(); setVista(t.id); return; }
      const act: Record<string, () => void> = { n: () => abrirEditor(), i: () => abrirImportar(), r: () => abrirRevision(), '/': () => buscarRef.current?.focus(), ',': toggleAjustes };
      const fn = act[ev.key.toLowerCase()];
      if (fn) { ev.preventDefault(); fn(); }
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, []); // eslint-disable-line

  const hoy = todayISO(), mk = hoy.slice(0, 7);
  const ahora = new Date();
  const mkProx = mesKey(new Date(ahora.getFullYear(), ahora.getMonth() + 1, 1, 12));
  const r = resumen(d);
  const pausa = importacionPausada(d);
  const buscando = q.trim().length > 0;
  const activas = useMemo(() => d.bitacoras.filter(b => !b.archivada), [d]);
  const informes = useMemo(() => proximosInformes(d), [d]);

  // Búsqueda: SIEMPRE en todas las bitácoras (activas y archivadas), sin filtros ocultos
  const resultados = useMemo(() => buscando ? d.bitacoras.filter(b => coincide(d, b, q)) : [], [d, q, buscando]);

  const listaActivas = useMemo(() => {
    const ordEt = (b: Bitacora) => { const i = d.etiquetas.findIndex(e => e.id === b.etiquetaId); return i < 0 ? 99 : i; };
    const prox = (b: Bitacora) => siguienteMensual(b)?.fecha ?? '9999';
    const l = activas.filter(b =>
      (filtro === 'todas' || (filtro === 'pendientes' ? (() => { const s = siguienteMensual(b); return !!s?.vencida; })() : b.estado === filtro)) && (!etq || b.etiquetaId === etq));
    const cmp: Record<Orden, (a: Bitacora, b: Bitacora) => number> = {
      proxima: (a, b) => (estaActiva(a) ? 0 : 1) - (estaActiva(b) ? 0 : 1) || prox(a).localeCompare(prox(b)) || a.numero.localeCompare(b.numero),
      avance: (a, b) => ordEt(a) - ordEt(b) || a.numero.localeCompare(b.numero),
      numero: (a, b) => a.numero.localeCompare(b.numero),
      nombre: (a, b) => a.nombre.localeCompare(b.nombre),
      apertura: (a, b) => a.apertura.localeCompare(b.apertura)
    };
    return [...l].sort(cmp[orden]);
  }, [d, activas, filtro, etq, orden]);

  if (!estaListo()) return <div className="cargando">Cargando…</div>;

  const chip = (id: FiltroEstado, txt: string, n: number, cls = '') => (
    <button className={`fchip ${cls} ${filtro === id ? 'on' : ''}`} onClick={() => setFiltro(f => (f === id ? 'todas' : id))}>{txt}<b>{n}</b></button>
  );
  const vacio = (txt: string) => <div className="lista-vacia"><p>{txt}</p></div>;
  let tourMarcado = false;
  const P = (b: Bitacora, modo?: Modo) => {
    const data = !tourMarcado ? 'proyecto' : undefined; tourMarcado = true;
    return <Proyecto key={b.id + (modo?.tipo ?? '')} d={d} b={b} modo={modo} data={data} />;
  };

  let cuerpo: ReactNode;
  if (buscando) {
    cuerpo = <>
      <div className="dia-bar busca"><Ic n="search" /> {resultados.length} resultado{resultados.length === 1 ? '' : 's'} para «{q.trim()}» (activas y archivadas) <button className="dp-link" onClick={() => setQ('')}>Limpiar</button></div>
      {resultados.length ? <><Cabecera />{resultados.map(b => P(b))}</> : vacio('Ninguna bitácora coincide.')}
    </>;
  } else if (vista === 'activas') {
    cuerpo = !d.bitacoras.length ? (
      <div className="lista-vacia"><div className="empty">
        <div className="empty-ic">🌿</div>
        <h2>Empieza con tu PDF de SETENA</h2>
        <p>Importa el listado; la app extrae número, proyecto y estado.<br />Las revisiones mensuales y los informes cada 6 meses se calculan solos desde la fecha de apertura.</p>
        <div className="row"><button className="btn primary" onClick={() => abrirImportar()}><Ic n="upload" /> Importar PDF</button>
          <button className="btn" onClick={() => abrirEditor()}><Ic n="plus" /> Crear a mano</button></div>
      </div></div>
    ) : <>
      <div className="filtros">
        {chip('todas', 'Todas', activas.length)}
        {chip('nueva', 'Nuevas', r.nuevas, 'est-nueva')}
        {chip('abierta', 'Abiertas', r.abiertas, 'est-abierta')}
        {chip('cierre', 'Sol. cierre', r.cierre, 'est-cierre')}
        {chip('terminada', 'Terminadas', r.terminadas, 'est-terminada')}
        {chip('pendientes', 'Pendientes', r.pendientesMes, 'warn')}
        <span className="sep" />
        <span className="color-filtro" title="Filtrar por avance">
          {d.etiquetas.map(e => (
            <button key={e.id} className={etq === e.id ? 'on' : ''} style={{ ['--ec' as any]: e.color }} onClick={() => setEtq(x => (x === e.id ? null : e.id))}>
              <i /><span>{e.nombre}</span><b>{activas.filter(b => b.etiquetaId === e.id).length}</b></button>))}
        </span>
        <select className="orden" value={orden} onChange={e => setOrden(e.target.value as Orden)} title="Ordenar">
          <option value="proxima">Próxima revisión</option><option value="avance">Avance</option>
          <option value="apertura">Fecha de apertura</option><option value="numero">Número</option><option value="nombre">Proyecto</option>
        </select>
      </div>
      {r.terminadas > 0 && filtro !== 'terminada' && <div className="dia-bar suave"><Ic n="download" /> {r.terminadas} terminada(s) siguen en la lista: archívalas con 📦 para que no estorben. <button className="dp-link" onClick={() => setFiltro('terminada')}>Ver terminadas</button></div>}
      {listaActivas.length ? <><Cabecera />{listaActivas.map(b => P(b))}</> : vacio('Ninguna bitácora coincide con el filtro.')}
    </>;
  } else if (vista === 'mes' || vista === 'proximo') {
    const m = vista === 'mes' ? mk : mkProx;
    const t = tareasDelMes(d, m);
    const hechas = t.filter(x => completoEn(x.b, m)).length;
    const conInf = t.filter(x => x.informe).length;
    cuerpo = <>
      <div className="mes-resumen">
        <div><b>{t.length}</b><span>revisiones en {nombreMesKey(m).split(' ')[0].toLowerCase()}</span></div>
        <div className={hechas === t.length && t.length ? 'ok' : ''}><b>{hechas}/{t.length}</b><span>completas</span></div>
        <div><b>{conInf}</b><span>con informe regencial</span></div>
      </div>
      {t.length > 0 && <Cabecera />}
      {t.length ? [...t].sort((a, c) => Number(completoEn(a.b, m)) - Number(completoEn(c.b, m)) || a.fecha.localeCompare(c.fecha)).map(x => P(x.b, { tipo: 'mes', mk: m }))
        : vacio('No hay revisiones este mes.')}
    </>;
  } else if (vista === 'informes') {
    const grupos: [string, InfoInforme[]][] = [['Vencidos', informes.filter(i => i.estado === 'vencido')], ['En aviso (último mes)', informes.filter(i => i.estado === 'aviso')], ['Próximos', informes.filter(i => i.estado === 'futuro')]];
    cuerpo = informes.length ? <>
      <p className="vista-nota"><Ic n="review" size={14} /> El informe regencial vence cada 6 meses desde la fecha de apertura; los avisos empiezan 1 mes antes.</p>
      {grupos.filter(([, l]) => l.length).map(([tit, l]) => <section key={tit} className="grupo"><h4 className="vista-h">{tit} <small>{l.length}</small></h4><Cabecera />{l.map(i => P(i.b, { tipo: 'informe' }))}</section>)}
    </> : vacio('No hay informes regenciales pendientes.');
  } else {
    const arch = d.bitacoras.filter(b => b.archivada).sort((a, c) => (c.archivadaEl ?? '').localeCompare(a.archivadaEl ?? ''));
    cuerpo = arch.length ? <>
      <p className="vista-nota"><Ic n="download" size={14} /> Proyectos archivados: fuera de la lista y sin recordatorios, pero con todo su historial. Restaura con el botón ↑.</p>
      <Cabecera />{arch.map(b => P(b))}
    </> : vacio('No hay proyectos archivados. Cuando un proyecto esté «Terminado», archívalo con el botón 📦.');
  }

  return (
    <div className={`app ${dropAll ? 'drop-all' : ''}`}
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropAll(true); } }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDropAll(false); }}
      onDrop={e => { setDropAll(false); const f = e.dataTransfer.files?.[0]; if (f && /pdf$/i.test(f.name)) { e.preventDefault(); abrirImportar(f); } }}>

      <header className="top">
        <div className="brand"><span className="logo">🌿</span><h1>Bitácora Tracker</h1><small>SETENA</small></div>
        <div className={`search ${buscando ? 'activo' : ''}`}><Ic n="search" />
          <input ref={buscarRef} placeholder="Buscar número, proyecto o estado  ( / )" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setQ(''); }} />
          {q && <button className="icon-btn sm" onClick={() => setQ('')} title="Limpiar"><Ic n="close" /></button>}</div>
        <div className="top-btns">
          <button className={`btn ${pausa ? 'pausa' : ''}`} data-tour="importar" onClick={() => abrirImportar()} title={pausa ? `Continuar importación (${pausa.hechas}/${pausa.total})` : 'Importar PDF (I)'}>
            <Ic n="upload" /> {pausa ? <>Continuar <b>{pausa.hechas}/{pausa.total}</b></> : 'Importar PDF'}</button>
          <button className="btn" onClick={async () => { if (await backend.guardarArchivo(`bitacoras-${hoy}.csv`, aCsv(d), 'csv', 'CSV (Excel)')) toast('CSV exportado'); }} title="Exportar a CSV"><Ic n="download" /> CSV</button>
          <button className="btn" onClick={() => abrirRevision()} title="Resumen general (R)"><Ic n="review" /> Resumen</button>
          <button className="btn primary" data-tour="nueva" onClick={() => abrirEditor()} title="Nueva bitácora (N)"><Ic n="plus" /> Nueva bitácora</button>
        </div>
      </header>

      <div className="barra">
        <div className="seg" role="tablist" data-tour="vistas">
          {TABS.map(t => (
            <button key={t.id} role="tab" aria-selected={!buscando && vista === t.id} className={!buscando && vista === t.id ? 'on' : ''} onClick={() => setVista(t.id)} title={`${t.txt} (${t.tecla})`}>
              {t.txt}
              {t.id === 'mes' && r.pendientesMes > 0 && <b className="rojo">{r.pendientesMes}</b>}
              {t.id === 'informes' && (r.informesVencidos + r.informesAviso) > 0 && <b className={r.informesVencidos ? 'rojo' : ''}>{r.informesVencidos + r.informesAviso}</b>}
              {t.id === 'archivo' && r.archivadas > 0 && <b className="gris">{r.archivadas}</b>}
            </button>))}
        </div>
        <div className="stats">
          <span title="Revisiones mensuales pendientes"><i className="rojo" />{r.pendientesMes} pendientes</span>
          <span title="Informes regenciales en aviso o vencidos"><i className="morado" />{r.informesAviso + r.informesVencidos} informes</span>
          <span title="Proyectos activos"><i />{r.activas} activos</span>
        </div>
      </div>

      {pausa && !buscando && (
        <div className="dia-bar pausa-bar"><Ic n="clock" /> Importación en pausa · {pausa.archivo} · {pausa.hechas} de {pausa.total} revisadas
          <button className="btn primary sm" onClick={() => abrirImportar()}>▶ Continuar</button></div>
      )}

      <main className="lista-proy">{cuerpo}</main>

      <footer className="foot">
        <span>B = bitácora del mes · I = inspección · Entregado = informe regencial</span>
        <span className="grow" />Clic en el nombre o ✎ para editar y ver su calendario · 1–5 cambian de pestaña
      </footer>

      {dropAll && <div className="drop-veil"><Ic n="upload" size={40} /><b>Suelta el PDF para importarlo</b></div>}
      <AvisoCards />
      <Tutorial hayBitacoras={d.bitacoras.length > 0} />
      <AjustesPanel />
      <ToastHost />
      <ModalHost />
    </div>
  );
}
