// ===== Modal de creación / edición de bitácora (coherente con el editor completo de Cognose) =====
// Número y nombre van siempre juntos: no se puede guardar uno sin el otro.
import { useState } from 'react';
import type { Bitacora, Estado } from '../lib/types';
import { ESTADOS, generaMensual } from '../lib/types';
import { existeNumero, getDatos, mutar, etiquetaPorEstado } from '../lib/store';
import { normalizarNumero, numeroValido } from '../lib/parser';
import { siguienteMensual } from '../lib/avisos';
import { fechaLarga, mesKey, nombreMesKey, todayISO, uid } from '../lib/fechas';
import { DatePick } from './DatePick';
import { Ic, abrirModal, cerrarModal, confirmar, toast, HbHead } from './core';
import { abrirAjustes } from './Ajustes';

export function abrirEditor(b?: Bitacora, inicial?: Partial<Bitacora>) {
  abrirModal(<Editor b={b} inicial={inicial} />, 'create-modal editor');
}

function ultimosMeses(n: number): string[] {
  const d = new Date();
  return Array.from({ length: n }, (_, i) => mesKey(new Date(d.getFullYear(), d.getMonth() - (n - 1 - i), 1, 12)));
}

function Editor({ b, inicial }: { b?: Bitacora; inicial?: Partial<Bitacora> }) {
  const d = getDatos();
  const [f, setF] = useState<Bitacora>(() => b ? structuredClone(b) : {
    id: uid(), numero: '', nombre: '', estado: 'abierta', etiquetaId: etiquetaPorEstado('abierta'),
    diaAviso: d.ajustes.diaAvisoDefecto, fechaInicio: todayISO(), notas: '', registros: [],
    ultimaActualizacion: null, creada: todayISO(), ...inicial
  });
  const [err, setErr] = useState('');
  const set = <K extends keyof Bitacora>(k: K, v: Bitacora[K]) => setF(x => ({ ...x, [k]: v }));
  const sig = siguienteMensual(f);

  function guardar() {
    const numero = normalizarNumero(f.numero);
    const nombre = f.nombre.trim().replace(/\s+/g, ' ');
    if (!numero) return setErr('Falta el número de bitácora.');
    if (!numeroValido(numero)) return setErr('El número debe tener el formato D1-XXXX-AAAA (ej. D1-0170-2020).');
    if (!nombre) return setErr('Falta el nombre del proyecto: el número siempre va ligado a un proyecto.');
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
    const ok = await confirmar({ titulo: '¿Eliminar bitácora?', texto: `${b.numero} → ${b.nombre}. Se borran también sus recordatorios.`, ok: 'Eliminar', peligro: true });
    if (!ok) { abrirEditor(b); return; }
    mutar(dd => {
      dd.bitacoras = dd.bitacoras.filter(x => x.id !== b.id);
      dd.pospuestos = dd.pospuestos.filter(p => p.ref !== b.id);
    });
    toast(`Bitácora ${b.numero} eliminada`, true);
  }

  return (
    <form onSubmit={e => { e.preventDefault(); guardar(); }} onKeyDown={e => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'TEXTAREA' && !e.ctrlKey) e.stopPropagation(); }}>
      <HbHead icon={b ? '📝' : '🌿'} titulo={b ? 'Editar bitácora' : 'Nueva bitácora'} sub="Número y proyecto siempre van juntos" />

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

      <label className="modal-label">Estado</label>
      <div className="chip-pick">
        {ESTADOS.map(s => (
          <button type="button" key={s.id} className={`echip est-${s.id} ${f.estado === s.id ? 'on' : ''}`}
            onClick={() => set('estado', s.id as Estado)}>{s.nombre}</button>
        ))}
      </div>
      <small className="ed-hint">{generaMensual(f.estado)
        ? 'Genera recordatorio mensual y aparece en la revisión semestral.'
        : 'Sin recordatorio mensual; sí aparece en la revisión semestral.'}</small>

      <label className="modal-label">Color / prioridad
        <button type="button" className="dp-link inline" onClick={() => { cerrarModal(); abrirAjustes('colores'); }}>editar colores</button>
      </label>
      <div className="chip-pick">
        {d.etiquetas.map(e => (
          <button type="button" key={e.id} className={`echip ${f.etiquetaId === e.id ? 'on' : ''}`} style={{ ['--ec' as any]: e.color }}
            onClick={() => set('etiquetaId', e.id)}><span className="dot" />{e.nombre}</button>
        ))}
      </div>

      <div className="ed-cols">
        <div>
          <label className="modal-label" htmlFor="ed_dia">Día del aviso mensual</label>
          <div className="ed-row">
            <select id="ed_dia" className="modal-input" value={f.diaAviso} disabled={!generaMensual(f.estado)}
              onChange={e => set('diaAviso', Number(e.target.value))}>
              {Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>Día {i + 1}</option>)}
            </select>
          </div>
          {sig && <small className={`ed-hint ${sig.vencida ? 'warn' : ''}`}><Ic n="bell" size={13} /> {sig.vencida ? 'Pendiente desde' : 'Próximo'}: {fechaLarga(sig.fecha)} · {d.ajustes.horaAviso}</small>}

          <label className="modal-label">Meses registrados</label>
          <div className="mes-pick">
            {ultimosMeses(6).map(m => (
              <button type="button" key={m} className={`mes ${f.registros.includes(m) ? 'on' : ''}`} title={nombreMesKey(m)}
                onClick={() => set('registros', f.registros.includes(m) ? f.registros.filter(r => r !== m) : [...f.registros, m])}>
                {f.registros.includes(m) && <Ic n="check" size={12} />}{nombreMesKey(m).slice(0, 3)}
              </button>
            ))}
          </div>
          <label className="modal-label" htmlFor="ed_notas">Notas</label>
          <textarea id="ed_notas" className="modal-input" rows={3} value={f.notas} placeholder="Regente, consultor, observaciones…"
            onChange={e => set('notas', e.target.value)} />
        </div>
        <div>
          <label className="modal-label">Fecha de inicio del seguimiento</label>
          <DatePick value={f.fechaInicio} onChange={v => v && set('fechaInicio', v)} />
        </div>
      </div>

      <p className="ed-error" role="alert">{err}</p>
      <div className="modal-btns">
        {b && <button type="button" className="modal-btn cancel danger-text" onClick={eliminar}><Ic n="trash" size={14} /> Eliminar</button>}
        <span className="grow" />
        <button type="button" className="modal-btn cancel" onClick={cerrarModal}>Cancelar</button>
        <button type="submit" className="modal-btn ok">{b ? 'Guardar' : 'Crear bitácora'}</button>
      </div>
    </form>
  );
}
