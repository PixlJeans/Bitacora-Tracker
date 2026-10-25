// ===== Importar desde el PDF de SETENA — paso a paso y con PAUSA =====
//  1. Cargar: soltar / elegir el PDF, o pegar el texto.
//  2. Resumen: cuántas se encontraron y la fecha de apertura por defecto.
//  3. Una por una: una tarjeta limpia por bitácora. «Guardar y siguiente» la guarda EN EL MOMENTO.
//     «Pausar» cierra y recuerda dónde ibas (queda en tus datos: sobrevive a cerrar la app).
//  4. Fin: resumen de lo importado.
import { useEffect, useRef, useState } from 'react';
import type { Bitacora, Datos, Estado, FilaImportacion, SesionImportacion } from '../lib/types';
import { ESTADOS, estadoNombre } from '../lib/types';
import { extraerBitacoras, normalizarNumero, numeroValido } from '../lib/parser';
import { etiquetaPorEstado, getDatos, mutar, useDatos } from '../lib/store';
import { avisoDesde } from '../lib/avisos';
import { fechaCorta, fechaLarga, fromISO, sumarMeses, todayISO, uid } from '../lib/fechas';
import { Ic, abrirModal, alerta, cerrarModal, confirmar, HbHead, toast } from './core';

export function abrirImportar(file?: File) { abrirModal(<Importar inicial={file} />, 'create-modal importar'); }

type Paso = 'cargar' | 'resumen' | 'uno' | 'fin';

/** Aplica una fila a los datos (crea o actualiza la bitácora). Devuelve 'nueva' | 'actualizada'. */
function aplicarFila(d: Datos, f: FilaImportacion): 'nueva' | 'actualizada' {
  const numero = normalizarNumero(f.numero), nombre = f.nombre.trim().replace(/\s+/g, ' ');
  const b = d.bitacoras.find(x => x.numero === numero);
  if (b) {
    Object.assign(b, { nombre, estado: f.estado, apertura: f.apertura, etiquetaId: f.etiquetaId });
    return 'actualizada';
  }
  const nueva: Bitacora = {
    id: uid(), numero, nombre, estado: f.estado, etiquetaId: f.etiquetaId, apertura: f.apertura,
    notas: '', registros: [], inspecciones: [], informes: [], archivada: false, archivadaEl: null,
    ultimaActualizacion: null, creada: todayISO()
  };
  d.bitacoras.push(nueva);
  return 'nueva';
}

const valida = (f: FilaImportacion) => numeroValido(normalizarNumero(f.numero)) && !!f.nombre.trim() && !!f.apertura;

function Importar({ inicial }: { inicial?: File }) {
  const d = useDatos();
  const sesion = d.importacion;
  const [paso, setPaso] = useState<Paso>(sesion ? 'uno' : 'cargar');
  const [texto, setTexto] = useState('');
  const [filas, setFilas] = useState<FilaImportacion[]>(sesion?.filas ?? []);
  const [i, setI] = useState(sesion ? Math.min(sesion.i, sesion.filas.length - 1) : 0);
  const [arch, setArch] = useState(sesion?.archivo ?? '');
  const [cargando, setCargando] = useState('');
  const [drag, setDrag] = useState(false);
  const [aperturaDef, setAperturaDef] = useState(todayISO());
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const yaInicial = useRef(false);

  async function leerPdf(f: File) {
    setArch(f.name); setCargando('Leyendo PDF…');
    try {
      const { textoDePdf } = await import('../lib/pdf');
      const txt = await textoDePdf(await f.arrayBuffer());
      setTexto(txt);
      if (!txt.trim()) alerta('PDF sin texto', 'Este PDF parece escaneado (solo imagen). Copia el texto desde el visor de PDF y pégalo en el cuadro.', '🖼️', '#f59e0b');
      else analizar(txt);
    } catch (e: any) {
      alerta('No se pudo leer el PDF', e?.message || String(e), '⚠️', '#f59e0b');
    } finally { setCargando(''); }
  }
  useEffect(() => {
    if (inicial && !yaInicial.current) {
      yaInicial.current = true;
      if (sesion) { toast('Hay una importación en pausa: termínala o descártala antes de cargar otro PDF'); return; }
      leerPdf(inicial);
    }
  }, []); // eslint-disable-line

  function analizar(txt = texto) {
    const dd = getDatos();
    setFilas(extraerBitacoras(txt).map(e => {
      const numero = normalizarNumero(e.numero);
      const ex = dd.bitacoras.find(b => b.numero === numero);
      return {
        numero, nombre: e.nombre, estado: e.estado, apertura: e.apertura ?? ex?.apertura ?? '',
        etiquetaId: ex?.etiquetaId ?? etiquetaPorEstado(e.estado),
        dudas: e.dudas, existenteId: ex?.id ?? null, resultado: 'pendiente' as const
      };
    }));
    setPaso('resumen');
  }

  // --- guardar la sesión (para pausar) ---
  const guardarSesion = (fs: FilaImportacion[], idx: number) =>
    mutar(dd => { dd.importacion = { archivo: arch, inicio: dd.importacion?.inicio ?? todayISO(), i: idx, filas: fs } as SesionImportacion; }, { undo: false });
  const terminarSesion = () => mutar(dd => { dd.importacion = null; }, { undo: false });

  function comenzarUnaPorUna() {
    const fs = filas.map(f => ({ ...f, apertura: f.apertura || aperturaDef }));
    setFilas(fs); setI(0); setPaso('uno');
    guardarSesion(fs, 0);
  }

  function importarTodas(desde = 0) {
    const fs = filas.map((f, k) => (k < desde || f.resultado !== 'pendiente') ? f
      : { ...f, apertura: f.apertura || aperturaDef });
    const listas = fs.map((f, k) => ({ f, k })).filter(({ f, k }) => k >= desde && f.resultado === 'pendiente' && valida(f));
    mutar(dd => {
      listas.forEach(({ f }) => aplicarFila(dd, f));
      dd.importacion = null;
    });
    const fin = fs.map((f, k) => listas.some(x => x.k === k) ? { ...f, resultado: 'importada' as const } : f.resultado === 'pendiente' && k >= desde ? { ...f, resultado: 'omitida' as const } : f);
    setFilas(fin); setPaso('fin');
  }

  // --- tarjeta actual ---
  const f = filas[i];
  const upd = (p: Partial<FilaImportacion>) => { setErr(''); setFilas(fs => fs.map((x, k) => (k === i ? { ...x, ...p } : x))); };
  const pendientes = filas.filter(x => x.resultado === 'pendiente').length;

  function siguientePendiente(fs: FilaImportacion[], desde: number) {
    for (let k = desde + 1; k < fs.length; k++) if (fs[k].resultado === 'pendiente') return k;
    for (let k = 0; k <= desde; k++) if (fs[k].resultado === 'pendiente') return k;
    return -1;
  }
  function avanzar(fs: FilaImportacion[]) {
    const n = siguientePendiente(fs, i);
    setFilas(fs);
    if (n < 0) { terminarSesion(); setPaso('fin'); return; }
    setI(n); guardarSesion(fs, n);
  }
  function guardarActual() {
    const numero = normalizarNumero(f.numero);
    if (!numeroValido(numero)) return setErr('El número debe tener el formato D1-XXXX-AAAA.');
    if (!f.nombre.trim()) return setErr('Falta el nombre del proyecto.');
    if (!f.apertura) return setErr('Falta la fecha de apertura.');
    const otra = getDatos().bitacoras.find(b => b.numero === numero);
    if (otra && otra.id !== f.existenteId && f.existenteId) return setErr(`Ya existe otra bitácora con el número ${numero}.`);
    const fila = { ...f, numero, resultado: 'importada' as const };
    mutar(dd => { aplicarFila(dd, fila); });
    avanzar(filas.map((x, k) => (k === i ? fila : x)));
  }
  function omitirActual() { avanzar(filas.map((x, k) => (k === i ? { ...x, resultado: 'omitida' as const } : x))); }
  function pausar() {
    guardarSesion(filas, i);
    cerrarModal();
    toast(`Importación en pausa: ${pendientes} por revisar. Sigue cuando quieras desde «Importar PDF».`);
  }
  async function descartar() {
    const ok = await confirmar({ titulo: '¿Descartar la importación?', texto: `Las ${filas.filter(x => x.resultado === 'importada').length} bitácoras ya guardadas se quedan; las ${pendientes} pendientes no se importan.`, ok: 'Descartar', peligro: true });
    terminarSesion();
    if (ok) toast('Importación descartada'); else abrirImportar();
  }

  // ===================== Pantallas =====================
  if (paso === 'cargar') return (
    <>
      <HbHead icon="📄" titulo="Importar desde PDF" sub="Paso 1 de 3 · elige el archivo" color="#60a5fa" />
      <div className={`drop grande ${drag ? 'over' : ''}`} onClick={() => fileRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); const x = e.dataTransfer.files[0]; if (x) leerPdf(x); }}>
        <Ic n="upload" size={34} />
        <b>{cargando || 'Suelta aquí el PDF de SETENA'}</b>
        <small>o haz clic para elegirlo</small>
      </div>
      <input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden onChange={e => { const x = e.target.files?.[0]; if (x) leerPdf(x); e.target.value = ''; }} />
      <details className="pegar">
        <summary>¿No tienes el PDF? Pega el texto</summary>
        <textarea className="modal-input mono sm" rows={6} value={texto} onChange={e => setTexto(e.target.value)}
          placeholder={'D1-0170-2020   CONDOMINIO VISTA DEL BOSQUE   Abierta'} />
        <button className="btn primary sm" disabled={!texto.trim()} onClick={() => { setArch('Texto pegado'); analizar(); }}>Analizar texto</button>
      </details>
      <div className="modal-btns"><button className="modal-btn cancel" onClick={cerrarModal}>Cancelar</button></div>
    </>
  );

  if (paso === 'resumen') {
    const nuevas = filas.filter(x => !x.existenteId).length;
    const existentes = filas.length - nuevas;
    const dudas = filas.filter(x => x.dudas.length || !x.nombre.trim()).length;
    const sinFecha = filas.filter(x => !x.apertura).length;
    return (
      <>
        <HbHead icon="🔎" titulo={`${filas.length} bitácoras encontradas`} sub={`Paso 2 de 3 · ${arch}`} color="#60a5fa" />
        {!filas.length ? <p className="modal-text center">No se encontró ningún número con formato D1-XXXX-AAAA. Prueba pegando el texto.</p> : <>
          <div className="hb-stats">
            <div><b>{nuevas}</b><span>nuevas</span></div>
            <div><b>{existentes}</b><span>ya existen</span></div>
            <div className={dudas ? 'warn' : ''}><b>{dudas}</b><span>por revisar</span></div>
          </div>
          <div className="imp-defs">
            <p className="imp-defs-t">Las revisiones se calculan solas desde la fecha de apertura. Para las que no la traigan en el PDF:</p>
            <label><span>Fecha de apertura {sinFecha ? <small>({sinFecha} sin fecha en el PDF)</small> : null}</span>
              <input type="date" className="modal-input" value={aperturaDef} onChange={e => e.target.value && setAperturaDef(e.target.value)} /></label>
          </div>
        </>}
        <div className="modal-btns">
          <button className="modal-btn cancel" onClick={() => setPaso('cargar')}>← Volver</button>
          <span className="grow" />
          {filas.length > 0 && <button className="modal-btn cancel" onClick={() => importarTodas(0)} title="Sin revisar una por una">Importar todas ya</button>}
          {filas.length > 0 && <button className="modal-btn ok" autoFocus onClick={comenzarUnaPorUna}>Revisar una por una →</button>}
        </div>
      </>
    );
  }

  if (paso === 'fin' || !f) {
    const imp = filas.filter(x => x.resultado === 'importada');
    return (
      <>
        <HbHead icon="🎉" titulo="¡Importación terminada!" sub={arch} />
        <div className="hb-stats">
          <div><b>{imp.filter(x => !x.existenteId).length}</b><span>nuevas</span></div>
          <div><b>{imp.filter(x => x.existenteId).length}</b><span>actualizadas</span></div>
          <div><b>{filas.filter(x => x.resultado === 'omitida').length}</b><span>omitidas</span></div>
        </div>
        <div className="modal-btns center"><button className="modal-btn ok" autoFocus onClick={() => { terminarSesion(); cerrarModal(); }}>¡Listo!</button></div>
      </>
    );
  }

  // ---- una por una ----
  const hechas = filas.filter(x => x.resultado !== 'pendiente').length;
  const ex = f.existenteId ? d.bitacoras.find(b => b.id === f.existenteId) : null;
  const cambios = ex ? [ex.estado !== f.estado && `estado: ${estadoNombre(ex.estado)} → ${estadoNombre(f.estado)}`, ex.nombre !== f.nombre.trim() && 'nombre', ex.apertura !== f.apertura && 'fecha de apertura'].filter(Boolean) : [];
  const vence = f.apertura ? sumarMeses(f.apertura, 6) : '';
  return (
    <div className="uno" onKeyDown={e => { if (e.key === 'Enter' && !(e.target as HTMLElement).closest('select,textarea')) { e.preventDefault(); guardarActual(); } }}>
      <div className="uno-top">
        <span className="uno-n">Bitácora <b>{i + 1}</b> de {filas.length}</span>
        <div className="uno-bar"><i style={{ width: `${(hechas / filas.length) * 100}%` }} /></div>
        <button className="btn sm" onClick={pausar} title="Guarda tu avance y cierra; sigue cuando quieras"><Ic n="clock" size={14} /> Pausar</button>
      </div>
      {sesion && hechas > 0 && i === sesion.i && <p className="uno-retomar">▶ Continuando la importación de <b>{arch}</b> ({hechas} listas).</p>}

      <div className="uno-card">
        <div className="uno-tags">
          {ex ? <span className="tag cambia">Ya existe{cambios.length ? ` · cambia ${cambios.join(', ')}` : ' · sin cambios'}</span> : <span className="tag nueva">Nueva</span>}
          {f.dudas.length > 0 && <span className="tag duda" title={f.dudas.join('\n')}><Ic n="warn" size={12} /> {f.dudas[0]}</span>}
        </div>

        <label className="uno-l">Número</label>
        <input className="modal-input mono uno-num" value={f.numero} onChange={e => upd({ numero: e.target.value.toUpperCase() })} />
        <label className="uno-l">Nombre del proyecto</label>
        <input className="modal-input uno-nom" value={f.nombre} autoFocus={!f.nombre} placeholder="Escribe el nombre del proyecto" onChange={e => upd({ nombre: e.target.value })} />

        <div className="uno-grid">
          <div>
            <label className="uno-l">Estado</label>
            <div className="chip-pick">{ESTADOS.map(s => (
              <button key={s.id} className={`echip est-${s.id} ${f.estado === s.id ? 'on' : ''}`} onClick={() => upd({ estado: s.id as Estado })}>{s.nombre}</button>))}</div>
          </div>
          <div>
            <label className="uno-l">Fecha de apertura</label>
            <input type="date" className="modal-input" value={f.apertura} onChange={e => upd({ apertura: e.target.value })} />
            {vence && <small className="uno-hint">Revisión mensual el día {fromISO(f.apertura).getDate()} · 1.er informe {fechaLarga(vence)} (avisos desde {fechaCorta(avisoDesde(vence))})</small>}
          </div>
          <div>
            <label className="uno-l">Avance</label>
            <div className="chip-pick">{d.etiquetas.map(e => (
              <button key={e.id} className={`echip ${f.etiquetaId === e.id ? 'on' : ''}`} style={{ ['--ec' as any]: e.color }} onClick={() => upd({ etiquetaId: e.id })}><span className="dot" />{e.nombre}</button>))}</div>
          </div>
        </div>
      </div>

      <p className="ed-error" role="alert">{err}</p>
      <div className="modal-btns uno-btns">
        <button className="modal-btn cancel" disabled={i === 0} onClick={() => setI(Math.max(0, i - 1))}>←</button>
        <button className="modal-btn cancel" onClick={omitirActual}>Omitir</button>
        <span className="grow" />
        <button className="dp-link" onClick={() => importarTodas(i)} title="Importa las que faltan con los valores actuales">Importar las {pendientes} restantes</button>
        <button className="dp-link danger" onClick={descartar}>Descartar</button>
        <button className="modal-btn ok" onClick={guardarActual}>{f.resultado === 'importada' ? 'Guardar de nuevo →' : 'Guardar y siguiente →'}</button>
      </div>
    </div>
  );
}

/** Para el resto de la app: ¿hay una importación pausada? */
export function importacionPausada(d: Datos) {
  const s = d.importacion;
  if (!s) return null;
  return { archivo: s.archivo, hechas: s.filas.filter(f => f.resultado !== 'pendiente').length, total: s.filas.length };
}
