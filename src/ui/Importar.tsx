// ===== Importar desde el PDF de SETENA (o texto pegado) =====
// Paso 1: subir / soltar el PDF o pegar el texto. Paso 2: vista previa editable con lo que cambia.
import { useEffect, useRef, useState } from 'react';
import type { Estado } from '../lib/types';
import { ESTADOS, estadoNombre } from '../lib/types';
import { extraerBitacoras, normalizarNumero, numeroValido, type Extraida } from '../lib/parser';
import { etiquetaPorEstado, getDatos, mutar } from '../lib/store';
import { todayISO, uid } from '../lib/fechas';
import { Ic, abrirModal, alerta, cerrarModal, HbHead } from './core';

export function abrirImportar(file?: File) { abrirModal(<Importar inicial={file} />, 'create-modal importar'); }

interface Fila extends Extraida { sel: boolean }

function Importar({ inicial }: { inicial?: File }) {
  const [texto, setTexto] = useState('');
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [cargando, setCargando] = useState('');
  const [arch, setArch] = useState('');
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const yaInicial = useRef(false);
  const d = getDatos();

  async function leerPdf(f: File) {
    setArch(f.name); setCargando('Leyendo PDF…');
    try {
      const { textoDePdf } = await import('../lib/pdf');
      const txt = await textoDePdf(await f.arrayBuffer());
      setTexto(txt);
      analizar(txt);
      if (!txt.trim()) alerta('PDF sin texto', 'Este PDF parece escaneado (solo imagen). Copia el texto desde el visor de PDF y pégalo en el cuadro.', '🖼️', '#f59e0b');
    } catch (e: any) {
      alerta('No se pudo leer el PDF', e?.message || String(e), '⚠️', '#f59e0b');
    } finally { setCargando(''); }
  }
  useEffect(() => { if (inicial && !yaInicial.current) { yaInicial.current = true; leerPdf(inicial); } }, []); // eslint-disable-line

  function analizar(txt = texto) {
    const r = extraerBitacoras(txt).map(e => ({ ...e, sel: true }));
    setFilas(r);
  }

  const situacion = (f: Fila) => {
    const n = normalizarNumero(f.numero);
    const b = d.bitacoras.find(x => x.numero === n);
    if (!b) return { t: 'Nueva', c: 'nueva' };
    const cambios: string[] = [];
    if (b.estado !== f.estado) cambios.push(`${estadoNombre(b.estado)} → ${estadoNombre(f.estado)}`);
    if (f.nombre && b.nombre !== f.nombre.trim()) cambios.push('nombre');
    return cambios.length ? { t: 'Actualiza: ' + cambios.join(', '), c: 'cambia' } : { t: 'Sin cambios', c: 'igual' };
  };
  const upd = (i: number, p: Partial<Fila>) => setFilas(fs => fs!.map((f, k) => (k === i ? { ...f, ...p } : f)));

  const validas = (filas || []).filter(f => f.sel && numeroValido(normalizarNumero(f.numero)) && f.nombre.trim());
  const ausentes = filas ? d.bitacoras.filter(b => !filas.some(f => normalizarNumero(f.numero) === b.numero)) : [];

  function importar() {
    let nuevas = 0, act = 0, igual = 0;
    mutar(dd => {
      for (const f of validas) {
        const numero = normalizarNumero(f.numero), nombre = f.nombre.trim().replace(/\s+/g, ' ');
        const b = dd.bitacoras.find(x => x.numero === numero);
        if (b) {
          if (b.estado !== f.estado || b.nombre !== nombre) { b.estado = f.estado; b.nombre = nombre; act++; } else igual++;
        } else {
          dd.bitacoras.push({
            id: uid(), numero, nombre, estado: f.estado, etiquetaId: etiquetaPorEstado(f.estado),
            diaAviso: dd.ajustes.diaAvisoDefecto, fechaInicio: todayISO(), notas: '', registros: [],
            ultimaActualizacion: null, creada: todayISO()
          });
          nuevas++;
        }
      }
    });
    cerrarModal();
    alerta('¡Importación lista!', (
      <div className="hb-stats">
        <div><b>{nuevas}</b><span>nuevas</span></div>
        <div><b>{act}</b><span>actualizadas</span></div>
        <div><b>{igual}</b><span>sin cambios</span></div>
      </div>
    ), '📥');
  }

  return (
    <>
      <HbHead icon="📄" titulo="Importar desde PDF" sub="Se extrae número + proyecto + estado. Revisa antes de importar." color="#60a5fa" />
      {!filas && (
        <>
          <div className={`drop ${drag ? 'over' : ''}`} onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) leerPdf(f); }}>
            <Ic n="upload" size={28} />
            <b>{cargando || (arch ? arch : 'Suelta aquí el PDF de SETENA')}</b>
            <small>o haz clic para elegir el archivo</small>
          </div>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden onChange={e => { const f = e.target.files?.[0]; if (f) leerPdf(f); e.target.value = ''; }} />
          <label className="modal-label" htmlFor="imp_txt">…o pega el texto copiado del PDF</label>
          <textarea id="imp_txt" className="modal-input mono sm" rows={7} value={texto} onChange={e => setTexto(e.target.value)}
            placeholder={'D1-0170-2020   CONDOMINIO VISTA DEL BOSQUE   Abierta\nD1-0245-2019   PLANTA LAS BRISAS   Solicitud de Cierre'} />
          <div className="modal-btns">
            <button className="modal-btn cancel" onClick={cerrarModal}>Cancelar</button>
            <button className="modal-btn ok" disabled={!texto.trim()} onClick={() => analizar()}>Analizar texto</button>
          </div>
        </>
      )}

      {filas && (
        <>
          <div className="imp-bar">
            <span><b>{filas.length}</b> bitácoras encontradas{arch && <> en <i>{arch}</i></>}</span>
            <button className="dp-link" onClick={() => setFilas(fs => fs!.map(f => ({ ...f, sel: !fs!.every(x => x.sel) })))}>Marcar / desmarcar todas</button>
          </div>
          {!filas.length && <p className="modal-text">No se encontró ningún número con formato D1-XXXX-AAAA. Revisa el texto o pégalo manualmente.</p>}
          <div className="imp-tabla">
            {filas.map((f, i) => {
              const s = situacion(f);
              const okNum = numeroValido(normalizarNumero(f.numero));
              return (
                <div key={i} className={`imp-fila ${f.sel ? '' : 'off'}`}>
                  <input type="checkbox" checked={f.sel} onChange={e => upd(i, { sel: e.target.checked })} />
                  <input className={`modal-input mono sm ${okNum ? '' : 'bad'}`} value={f.numero} onChange={e => upd(i, { numero: e.target.value.toUpperCase() })} />
                  <input className={`modal-input sm ${f.nombre.trim() ? '' : 'bad'}`} value={f.nombre} placeholder="Nombre del proyecto" onChange={e => upd(i, { nombre: e.target.value })} />
                  <select className={`modal-input sm est-sel est-${f.estado}`} value={f.estado} onChange={e => upd(i, { estado: e.target.value as Estado, estadoDetectado: true })}>
                    {ESTADOS.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                  </select>
                  <span className={`sit ${s.c}`} title={s.t}>{s.t}</span>
                  {f.dudas.length > 0 ? <span className="duda" title={f.dudas.join('\n')}><Ic n="warn" size={15} /></span> : <span />}
                </div>
              );
            })}
          </div>
          {ausentes.length > 0 && <small className="ed-hint">ℹ️ {ausentes.length} bitácora(s) de la app no aparecen en este PDF; no se tocan.</small>}
          <div className="modal-btns">
            <button className="modal-btn cancel" onClick={() => setFilas(null)}>← Volver</button>
            <span className="grow" />
            <button className="modal-btn cancel" onClick={cerrarModal}>Cancelar</button>
            <button className="modal-btn ok" disabled={!validas.length} onClick={importar}>Importar {validas.length}</button>
          </div>
        </>
      )}
    </>
  );
}
