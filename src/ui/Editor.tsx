// ===== Modal de creación / edición de bitácora (coherente con el editor de Cognose) =====
// El usuario solo decide número + proyecto, fecha de apertura, estado y avance.
// Las fechas de revisión NO se configuran: se calculan solas desde la apertura.
import { useState } from 'react';
import type { Bitacora, Estado } from '../lib/types';
import { ESTADOS, estaActiva } from '../lib/types';
import { existeNumero, getDatos, mutar, etiquetaPorEstado, archivar } from '../lib/store';
import { normalizarNumero, numeroValido } from '../lib/parser';
import { inicioSeguimiento, vencimientosInforme } from '../lib/avisos';
import { fechaCorta, fechaLarga, fromISO, sumarMeses, todayISO, uid } from '../lib/fechas';
import { CalendarioProyecto } from './CalendarioProyecto';
import { Ic, abrirModal, cerrarModal, confirmar, toast, HbHead } from './core';
import { abrirAjustes } from './Ajustes';

export function abrirEditor(b?: Bitacora, inicial?: Partial<Bitacora>) {
  abrirModal(<Editor b={b} inicial={inicial} />, 'create-modal editor');
}

function Editor({ b, inicial }: { b?: Bitacora; inicial?: Partial<Bitacora> }) {
  const d = getDatos();
  const hoy = todayISO();
  const [f, setF] = useState<Bitacora>(() => b ? structuredClone(b) : {
    id: uid(), numero: '', nombre: '', estado: 'nueva', etiquetaId: etiquetaPorEstado('nueva'), apertura: hoy, notas: '',
    registros: [], inspecciones: [], informes: [], archivada: false, archivadaEl: null, ultimaActualizacion: null, creada: hoy, ...inicial
  });
  const [err, setErr] = useState('');
  const set = <K extends keyof Bitacora>(k: K, v: Bitacora[K]) => setF(x => ({ ...x, [k]: v }));

  const dia = fromISO(f.apertura).getDate();
  const primerMensual = sumarMeses(f.apertura, 1);
  const informes = vencimientosInforme(f, inicioSeguimiento(f), sumarMeses(hoy, 13)).slice(0, 3);

  function guardar() {
    const numero = normalizarNumero(f.numero);
    const nombre = f.nombre.trim().replace(/\s+/g, ' ');
    if (!numero) return setErr('Falta el número de bitácora.');
    if (!numeroValido(numero)) return setErr('El número debe tener el formato D1-XXXX-AAAA (ej. D1-0170-2020).');
    if (!nombre) return setErr('Falta el nombre del proyecto: el número siempre va ligado a un proyecto.');
    if (!f.apertura) return setErr('Falta la fecha de apertura.');
    if (existeNumero(numero, f.id)) return setErr(`Ya existe una bitácora con el número ${numero}.`);
    const final = { ...f, numero, nombre };
    mutar(dd => {
      const i = dd.bitacoras.findIndex(x => x.id === f.id);
      if (i >= 0) dd.bitacoras[i] = final; else dd.bitacoras.push(final);
    });
    cerrarModal();
    toast(b ? `Bitácora ${numero} actualizada` : `Bitácora ${numero} creada`, true);
  }

  async function eliminar() {
    if (!b) return;
    const ok = await confirmar({ titulo: '¿Eliminar bitácora?', texto: `${b.numero} → ${b.nombre}. Se borra con todo su historial. Si solo terminó, mejor archívala.`, ok: 'Eliminar', peligro: true });
    if (!ok) { abrirEditor(b); return; }
    mutar(dd => {
      dd.bitacoras = dd.bitacoras.filter(x => x.id !== b.id);
      dd.pospuestos = dd.pospuestos.filter(p => p.ref !== b.id);
    });
    toast(`Bitácora ${b.numero} eliminada`, true);
  }

  return (
    <form onSubmit={e => { e.preventDefault(); guardar(); }}>
      <HbHead icon={b ? '📝' : '🌿'} titulo={b ? 'Editar bitácora' : 'Nueva bitácora'} sub="Las revisiones se calculan solas desde la fecha de apertura" />

      <div className="ed-pair">
        <div>
          <label className="modal-label" htmlFor="ed_num">Número</label>
          <input id="ed_num" className="modal-input mono" placeholder="D1-0170-2020" value={f.numero} autoFocus={!b}
            onChange={e => { set('numero', e.target.value.toUpperCase()); setErr(''); }}
            onBlur={e => { const n = normalizarNumero(e.target.value); if (n) set('numero', n); }} />
        </div>
        <span className="ed-arrow">→</span>
        <div className="grow">
          <label className="modal-label" htmlFor="ed_nom">Nombre del proyecto</label>
          <input id="ed_nom" className="modal-input" placeholder="CONDOMINIO VISTA DEL BOSQUE" value={f.nombre}
            onChange={e => { set('nombre', e.target.value); setErr(''); }} />
        </div>
      </div>

      <div className="ed-cols">
        <div>
          <label className="modal-label" htmlFor="ed_ap">Fecha de apertura</label>
          <input id="ed_ap" type="date" className="modal-input" value={f.apertura} onChange={e => e.target.value && set('apertura', e.target.value)} />

          <label className="modal-label">Estado</label>
          <div className="chip-pick">
            {ESTADOS.map(s => (
              <button type="button" key={s.id} className={`echip est-${s.id} ${f.estado === s.id ? 'on' : ''}`}
                onClick={() => set('estado', s.id as Estado)}>{s.nombre}</button>
            ))}
          </div>

          <label className="modal-label">Avance
            <button type="button" className="dp-link inline" onClick={() => { cerrarModal(); abrirAjustes('colores'); }}>editar</button>
          </label>
          <div className="chip-pick">
            {d.etiquetas.map(e => (
              <button type="button" key={e.id} className={`echip ${f.etiquetaId === e.id ? 'on' : ''}`} style={{ ['--ec' as any]: e.color }}
                onClick={() => set('etiquetaId', e.id)}><span className="dot" />{e.nombre}</button>
            ))}
          </div>

          <div className="ed-auto">
            <div className="ed-auto-h"><Ic n="calendar" size={14} /> Automático</div>
            {estaActiva(f) ? <>
              <p><b>Revisión mensual</b>: día <b>{dia}</b> de cada mes{dia > 28 ? ' (o el último en meses cortos)' : ''}, desde el {fechaCorta(primerMensual)} {primerMensual.slice(0, 4)}.</p>
              <p><b>Informe regencial</b> cada 6 meses{informes.length ? `; el próximo: ${fechaLarga(informes.find(v => !f.informes.includes(v)) ?? informes[0])}.` : '.'}</p>
            </> : <p className="muted">{f.estado === 'terminada' ? 'Terminada: ya no genera revisiones. Archívala para sacarla de la lista.' : 'Archivada: sin revisiones.'}</p>}
          </div>
        </div>

        <div>
          <label className="modal-label">Calendario de revisiones</label>
          <CalendarioProyecto b={f} onChange={c => setF(x => ({ ...x, ...c }))} />
        </div>
      </div>

      <label className="modal-label" htmlFor="ed_notas">Notas</label>
      <textarea id="ed_notas" className="modal-input" rows={2} value={f.notas} placeholder="Regente, consultor, observaciones…"
        onChange={e => set('notas', e.target.value)} />

      <p className="ed-error" role="alert">{err}</p>
      <div className="modal-btns">
        {b && <button type="button" className="modal-btn cancel danger-text" onClick={eliminar}><Ic n="trash" size={14} /> Eliminar</button>}
        {b && (b.estado === 'terminada' || b.archivada) && <button type="button" className="modal-btn cancel" onClick={() => { cerrarModal(); archivar(b.id, !b.archivada); toast(b.archivada ? `${b.numero} restaurada` : `📦 ${b.numero} archivada`, true); }}>
          {b.archivada ? '↑ Restaurar' : '📦 Archivar'}</button>}
        <span className="grow" />
        <button type="button" className="modal-btn cancel" onClick={cerrarModal}>Cancelar</button>
        <button type="submit" className="modal-btn ok">{b ? 'Guardar' : 'Crear bitácora'}</button>
      </div>
    </form>
  );
}
