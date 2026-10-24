// ===== Bitácora Tracker: pantalla principal =====
// Micro-calendario + resumen a la izquierda, lista de bitácoras a la derecha.
// Misma arquitectura que el calendario de Cognose: Store único → vistas que solo dibujan → ventanas comunes.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDatos, estaListo, Undo, registrarMes } from './lib/store';
import type { Bitacora } from './lib/types';
import { generaMensual } from './lib/types';
import { fechaMensual, marcasDelMes, pendientesDelMes, proximaSemestral, proximosAvisos, registradoEn, resumen } from './lib/avisos';
import { fechaCorta, fechaLarga, fromISO, nombreMesKey, toISO, todayISO } from './lib/fechas';
import { AvisoCards } from './ui/AvisoCards';
import { AjustesPanel, aplicarApariencia, toggleAjustes } from './ui/Ajustes';
import { Ic, ModalHost, ToastHost, hayModal, toast } from './ui/core';
import { abrirEditor } from './ui/Editor';
import { abrirImportar } from './ui/Importar';
import { Lista, type FiltroEstado } from './ui/Lista';
import { MicroCalendario } from './ui/MicroCalendario';
import { abrirRevision } from './ui/Revision';
import { backend } from './lib/backend';
import { aCsv } from './lib/csv';

type Orden = 'prioridad' | 'numero' | 'aviso' | 'nombre';

export default function App() {
  const d = useDatos();
  const [mes, setMes] = useState(() => new Date());
  const [dia, setDia] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroEstado>('todas');
  const [etq, setEtq] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [orden, setOrden] = useState<Orden>('prioridad');
  const [dropAll, setDropAll] = useState(false);
  const buscar = useRef<HTMLInputElement>(null);

  useEffect(() => { aplicarApariencia(d.ajustes); }, [d.ajustes]);
  useEffect(() => {
    const f = (e: Event) => { setFiltro((e as CustomEvent).detail); setDia(null); setEtq(null); };
    window.addEventListener('bt:filtro', f);
    return () => window.removeEventListener('bt:filtro', f);
  }, []);

  // Atajos de teclado (como el calendario de Cognose)
  useEffect(() => {
    const k = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && !(ev.target as HTMLElement).closest('input,textarea')) {
        ev.preventDefault(); if (Undo.pop()) toast('Deshecho');
        return;
      }
      if (ev.ctrlKey || ev.metaKey || ev.altKey || hayModal()) return;
      if ((ev.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) {
        if (ev.key === 'Escape') (ev.target as HTMLElement).blur();
        return;
      }
      const act: Record<string, () => void> = {
        n: () => abrirEditor(), i: () => abrirImportar(), r: () => abrirRevision(),
        '/': () => buscar.current?.focus(), t: () => { setMes(new Date()); setDia(null); },
        j: () => setMes(m => new Date(m.getFullYear(), m.getMonth() + 1, 1, 12)),
        k: () => setMes(m => new Date(m.getFullYear(), m.getMonth() - 1, 1, 12)),
        ',': toggleAjustes
      };
      const fn = act[ev.key.toLowerCase()];
      if (fn) { ev.preventDefault(); fn(); }
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, []);

  const hoy = todayISO(), mk = hoy.slice(0, 7);
  const r = resumen(d);
  const pendientes = pendientesDelMes(d);
  const sem = proximaSemestral(d);
  const proximos = proximosAvisos(d, 4);
  const marcas = useMemo(() => marcasDelMes(d, mes), [d, mes]);

  const lista = useMemo(() => {
    const ordEt = (b: Bitacora) => { const i = d.etiquetas.findIndex(e => e.id === b.etiquetaId); return i < 0 ? 99 : i; };
    const ql = q.trim().toLowerCase();
    let l = d.bitacoras.filter(b =>
      (filtro === 'todas' || (filtro === 'pendientes' ? pendientes.some(p => p.id === b.id) : b.estado === filtro)) &&
      (!etq || b.etiquetaId === etq) &&
      (!ql || b.numero.toLowerCase().includes(ql) || b.nombre.toLowerCase().includes(ql) || b.notas.toLowerCase().includes(ql)));
    if (dia) {
      const ids = new Set((marcas.get(dia)?.mensual ?? []).map(b => b.id));
      l = l.filter(b => ids.has(b.id));
    }
    const cmp: Record<Orden, (a: Bitacora, b: Bitacora) => number> = {
      prioridad: (a, b) => ordEt(a) - ordEt(b) || a.numero.localeCompare(b.numero),
      numero: (a, b) => a.numero.localeCompare(b.numero),
      nombre: (a, b) => a.nombre.localeCompare(b.nombre),
      aviso: (a, b) => (generaMensual(b.estado) ? 0 : 1) - (generaMensual(a.estado) ? 0 : 1) || fechaMensual(a, mk).localeCompare(fechaMensual(b, mk))
    };
    return [...l].sort(cmp[orden]);
  }, [d, filtro, etq, q, dia, marcas, orden, pendientes, mk]);

  if (!estaListo()) return <div className="cargando">Cargando…</div>;

  const chip = (id: FiltroEstado, txt: string, n: number, cls = '') => (
    <button className={`fchip ${cls} ${filtro === id ? 'on' : ''}`} onClick={() => setFiltro(f => (f === id ? 'todas' : id))}>{txt}<b>{n}</b></button>
  );
  const semMarca = dia && marcas.get(dia)?.semestral;

  return (
    <div className={`app ${dropAll ? 'drop-all' : ''}`}
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropAll(true); } }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDropAll(false); }}
      onDrop={e => { setDropAll(false); const f = e.dataTransfer.files?.[0]; if (f && /pdf$/i.test(f.name)) { e.preventDefault(); abrirImportar(f); } }}>

      <header className="top">
        <div className="brand"><span className="logo">🌿</span><h1>Bitácora Tracker</h1><small>SETENA</small></div>
        <div className="search"><Ic n="search" /><input ref={buscar} placeholder="Buscar número o proyecto  ( / )" value={q} onChange={e => setQ(e.target.value)} />
          {q && <button className="icon-btn sm" onClick={() => setQ('')}><Ic n="close" /></button>}</div>
        <div className="top-btns">
          <button className="btn" onClick={() => abrirImportar()} title="Importar PDF (I)"><Ic n="upload" /> Importar PDF</button>
          <button className="btn" onClick={async () => { if (await backend.guardarArchivo(`bitacoras-${hoy}.csv`, aCsv(d), 'csv', 'CSV (Excel)')) toast('CSV exportado'); }} title="Exportar a CSV"><Ic n="download" /> CSV</button>
          <button className="btn" onClick={() => abrirRevision()} title="Revisión semestral (R)"><Ic n="review" /> Revisión</button>
          <button className="btn primary" onClick={() => abrirEditor()} title="Nueva bitácora (N)"><Ic n="plus" /> Nueva bitácora</button>
        </div>
      </header>

      <div className="wrap">
        <aside className="side">
          <MicroCalendario d={d} mes={mes} setMes={setMes} dia={dia} setDia={setDia} />

          <div className={`card sem ${sem?.vencida ? 'due' : ''}`}>
            <div className="card-h"><Ic n="review" /> Revisión semestral</div>
            {sem ? <>
              <b>{fechaLarga(sem.fecha)}</b>
              <small>{sem.vencida ? 'Pendiente: ya toca hacerla' : `En ${Math.ceil((fromISO(sem.fecha).getTime() - fromISO(hoy).getTime()) / 864e5)} días`}</small>
              <button className="btn sm" onClick={() => abrirRevision(sem.fecha)}>{sem.vencida ? 'Hacer revisión' : 'Ver resumen'}</button>
            </> : <small>Configura la fecha en Ajustes.</small>}
          </div>

          <div className="card">
            <div className="card-h"><Ic n="bell" /> Por registrar en {nombreMesKey(mk).split(' ')[0]} <b className="badge">{pendientes.length}</b></div>
            {!pendientes.length && <small className="muted">{r.abiertas + r.nuevas ? '¡Todo al día este mes! 🎉' : 'Sin bitácoras activas.'}</small>}
            {pendientes.slice(0, 5).map(b => (
              <div className="mini-row" key={b.id} style={{ ['--ec' as any]: d.etiquetas.find(e => e.id === b.etiquetaId)?.color }}>
                <span className="dot" /><span className="mono" title={b.nombre}>{b.numero}</span>
                <button className="icon-btn sm ok" title="Marcar registrada" onClick={() => { registrarMes(b.id, mk); toast(`✓ ${b.numero} registrada`, true); }}><Ic n="check" /></button>
              </div>
            ))}
            {pendientes.length > 5 && <button className="dp-link" onClick={() => setFiltro('pendientes')}>Ver las {pendientes.length}</button>}
          </div>

          {proximos.length > 0 && (
            <div className="card">
              <div className="card-h"><Ic n="clock" /> Próximos avisos</div>
              {proximos.map(a => (
                <div className="mini-row" key={a.key}><span className="when">{fechaCorta(toISO(new Date(a.at)))}</span>
                  <span className="txt" title={a.body}>{a.kind === 'semestral' ? '★ Revisión semestral' : a.title.replace('📋 Registrar bitácora ', '')}</span></div>
              ))}
            </div>
          )}
        </aside>

        <main className="main">
          <div className="filtros">
            {chip('todas', 'Todas', r.total)}
            {chip('abierta', 'Abiertas', r.abiertas, 'est-abierta')}
            {chip('nueva', 'Nuevas', r.nuevas, 'est-nueva')}
            {chip('cierre', 'Sol. cierre', r.cierre, 'est-cierre')}
            {chip('pendientes', 'Pendientes', pendientes.length, 'warn')}
            <span className="sep" />
            <span className="color-filtro" title="Filtrar por color / prioridad">
              {d.etiquetas.map(e => (
                <button key={e.id} className={etq === e.id ? 'on' : ''} style={{ ['--ec' as any]: e.color }} title={e.nombre}
                  onClick={() => setEtq(x => (x === e.id ? null : e.id))}><i />{etq === e.id && <span>{e.nombre}</span>}</button>
              ))}
            </span>
            <select className="orden" value={orden} onChange={e => setOrden(e.target.value as Orden)} title="Ordenar">
              <option value="prioridad">Prioridad</option><option value="aviso">Próximo aviso</option>
              <option value="numero">Número</option><option value="nombre">Proyecto</option>
            </select>
          </div>
          {dia && (
            <div className="dia-bar">
              <Ic n="calendar" /> {fechaLarga(dia)} — {(marcas.get(dia)?.mensual.length ?? 0)} aviso(s){semMarca ? ' · ★ revisión semestral' : ''}
              {semMarca && <button className="dp-link" onClick={() => abrirRevision(dia)}>Abrir revisión</button>}
              <button className="dp-link" onClick={() => setDia(null)}>Quitar filtro</button>
            </div>
          )}
          <Lista d={d} lista={lista} vacio={
            d.bitacoras.length ? <p>Ninguna bitácora coincide con el filtro.</p> : (
              <div className="empty">
                <div className="empty-ic">🌿</div>
                <h2>Empieza con tu PDF de SETENA</h2>
                <p>Importa el listado y la app extrae número, proyecto y estado.<br />Los recordatorios mensuales y la revisión semestral se programan solos.</p>
                <div className="row"><button className="btn primary" onClick={() => abrirImportar()}><Ic n="upload" /> Importar PDF</button>
                  <button className="btn" onClick={() => abrirEditor()}><Ic n="plus" /> Crear a mano</button></div>
                <small>También puedes arrastrar el PDF a cualquier parte de la ventana.</small>
              </div>
            )} />
          <footer className="foot">
            {lista.length} de {d.bitacoras.length} · {d.bitacoras.filter(b => generaMensual(b.estado) && registradoEn(b, mk)).length}/{r.abiertas + r.nuevas} registradas este mes
            <span className="grow" />Doble clic o clic en una fila para editar · arrastra una fila a un día para cambiar su aviso
          </footer>
        </main>
      </div>

      {dropAll && <div className="drop-veil"><Ic n="upload" size={40} /><b>Suelta el PDF para importarlo</b></div>}
      <AvisoCards />
      <AjustesPanel />
      <ToastHost />
      <ModalHost />
    </div>
  );
}

