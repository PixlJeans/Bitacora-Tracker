// ===== Panel de ajustes (puerto del menú de cuenta de Cognose: tools/10-settings.js + 18-notify.js) =====
// Botón flotante abajo a la derecha → panel con secciones plegables.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getDatos, mutar, recargar, reemplazar, restablecerFabrica, useDatos } from '../lib/store';
import { backend, esTauri } from '../lib/backend';
import { aCsv } from '../lib/csv';
import { todayISO, uid } from '../lib/fechas';
import { abrirModal, alerta, cerrarModal, confirmar, HbHead, toast } from './core';
import { abrirTutorial } from './Tutorial';
import type { Ajustes as TAjustes, Datos } from '../lib/types';

let abierto = false, seccion: string | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());
export function abrirAjustes(sec?: string) { abierto = true; seccion = sec || null; emit(); }
export function toggleAjustes() { abierto = !abierto; seccion = null; emit(); }

const ACCOUNT_ICON = (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);

const SIZES = [85, 92, 100, 108, 116, 125];

/** Aplica tema, color y tamaño (lo llama App en cada cambio). */
export function aplicarApariencia(a: TAjustes) {
  document.body.classList.toggle('theme-light', a.tema === 'light');
  document.body.classList.toggle('theme-dark', a.tema !== 'light');
  document.documentElement.style.setProperty('--accent', a.acento);
  document.documentElement.style.fontSize = a.tamano === 100 ? '' : a.tamano + '%';
}

const setAj = (p: Partial<TAjustes>, undo = false) => mutar(d => { Object.assign(d.ajustes, p); }, { undo });

export function AjustesPanel() {
  const open = useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb); }; }, () => abierto);
  const sec = useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb); }; }, () => seccion);
  const d = useDatos();
  const a = d.ajustes;
  const panel = useRef<HTMLDivElement>(null);
  const [carpeta, setCarpeta] = useState('');
  const [auto, setAuto] = useState<boolean | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    backend.carpetaDatos().then(setCarpeta).catch(() => setCarpeta(''));
    backend.autoInicioActivo().then(setAuto);
    if (sec) setTimeout(() => panel.current?.querySelector(`[data-sec="${sec}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50);
  }, [open, sec]);

  async function toggleNotif() {
    if (a.notificaciones) return setAj({ notificaciones: false });
    const ok = await backend.pedirPermiso();
    setAj({ notificaciones: true });
    if (!ok) alerta('Permiso de notificaciones', 'El sistema no dio permiso. Actívalo en Configuración → Notificaciones del sistema para Bitácora Tracker. Mientras tanto verás los avisos dentro de la app.', '🔕', '#f59e0b');
  }

  async function toggleAuto() {
    const on = !(auto ?? a.autoInicio);
    try { await backend.autoInicio(on); setAuto(on); setAj({ autoInicio: on }); }
    catch (e) { alerta('No se pudo cambiar', String(e), '⚠️', '#f59e0b'); }
  }

  async function exportarCsv() {
    const r = await backend.guardarArchivo(`bitacoras-${todayISO()}.csv`, aCsv(getDatos()), 'csv', 'CSV (Excel)');
    if (r) toast('CSV exportado');
  }
  async function respaldo() {
    const r = await backend.guardarArchivo(`bitacora-tracker-datos-${todayISO()}.json`, JSON.stringify(getDatos(), null, 1), 'json', 'Datos de Bitácora Tracker');
    if (r) alerta('Archivo de transferencia listo', <>Copia <b>{r.split(/[\\/]/).pop()}</b> a la otra computadora (USB, correo, nube) y ahí usa <b>Ajustes → Tus datos → Importar archivo</b>. Funciona entre Windows y macOS.</>, '📦');
  }
  async function cambiarCarpeta() {
    const ruta = await backend.elegirCarpeta();
    if (!ruta) return;
    try {
      const estado = await backend.cambiarCarpeta(ruta, 'probar');
      if (estado === 'existe') {
        const usar = await confirmar({ titulo: 'Esa carpeta ya tiene datos', texto: '¿Quieres USAR los datos que ya están ahí (por ejemplo, traídos de otra computadora)? Si eliges «Cancelar», no se cambia nada.', ok: 'Usar esos datos', icon: '📂' });
        if (!usar) return;
        await backend.cambiarCarpeta(ruta, 'usar');
        await recargar();
        toast('Datos cargados desde la nueva carpeta');
      } else {
        await backend.cambiarCarpeta(ruta, 'llevar');
        toast('Tus datos ahora se guardan en la nueva carpeta');
      }
      setCarpeta(await backend.carpetaDatos());
    } catch (e: any) { alerta('No se pudo cambiar la carpeta', e?.message || String(e), '⚠️', '#f59e0b'); }
  }
  async function restaurar(file: File) {
    try {
      const raw = JSON.parse(await file.text()) as Datos;
      if (!raw || !Array.isArray(raw.bitacoras)) throw new Error('El archivo no es un respaldo de Bitácora Tracker.');
      const ok = await confirmar({ titulo: '¿Importar estos datos?', texto: `Se reemplazarán los datos actuales por ${raw.bitacoras.length} bitácoras del archivo. Puedes deshacer con Ctrl+Z.`, ok: 'Importar', icon: '📦' });
      if (ok) { reemplazar(raw); toast('Datos importados', true); }
    } catch (e: any) { alerta('No se pudo leer', e.message || String(e), '⚠️', '#f59e0b'); }
  }

  const sz = SIZES.indexOf(a.tamano);
  return (
    <>
      <button className="settings-fab" data-tour="ajustes" onClick={toggleAjustes} title="Ajustes" aria-label="Ajustes">{ACCOUNT_ICON}</button>
      <div className={`settings-panel ${open ? 'open' : ''}`} ref={panel}>
        <div className="settings-header">
          <h3>Ajustes</h3>
          <button className="settings-close" onClick={toggleAjustes} aria-label="Cerrar">✕</button>
        </div>

        <details className="settings-group set-sec" open data-sec="avisos">
          <summary>🔔 Recordatorios</summary>
          <div className="set-row">
            <span>Notificaciones del sistema</span>
            <button type="button" className={`set-switch ${a.notificaciones ? 'on' : ''}`} role="switch" aria-checked={a.notificaciones} onClick={toggleNotif}><i>{a.notificaciones ? '🔔' : '🔕'}</i></button>
          </div>
          <div className="set-row">
            <label htmlFor="horaAviso">Hora de los avisos</label>
            <input id="horaAviso" type="time" className="mini-input" value={a.horaAviso} onChange={e => /^\d\d:\d\d$/.test(e.target.value) && setAj({ horaAviso: e.target.value })} />
          </div>
          {esTauri && (
            <div className="set-row">
              <span>Abrir al iniciar el equipo</span>
              <button type="button" className={`set-switch ${(auto ?? a.autoInicio) ? 'on' : ''}`} role="switch" aria-checked={!!(auto ?? a.autoInicio)} onClick={toggleAuto}><i>{(auto ?? a.autoInicio) ? '⚡' : '·'}</i></button>
            </div>
          )}
          <small className="set-hint">Automático para cada bitácora activa: revisión mensual el mismo día de su apertura, e informe regencial cada 6 meses (avisos desde 1 mes antes). Terminadas y archivadas no avisan.</small>
          <button className="theme-btn" onClick={async () => { if (!(await backend.probarAviso())) alerta('Sin permiso', 'Activa las notificaciones para probar.', '🔕', '#f59e0b'); }}>🔔 Probar notificación</button>
          <small className="set-hint">Cerrar la ventana la deja en la bandeja del sistema: los avisos siguen llegando. Para salir del todo usa «Salir» en el icono de la bandeja.</small>
        </details>

        <details className="settings-group set-sec" open={sec === 'colores' || undefined} data-sec="colores">
          <summary>🎨 Avance (Pendiente · En proceso · Listo)</summary>
          <div className="etq-list">
            {d.etiquetas.map(e => {
              const usos = d.bitacoras.filter(b => b.etiquetaId === e.id).length;
              return (
                <div className="etq-row" key={e.id}>
                  <input type="color" value={e.color} onChange={ev => mutar(dd => { const x = dd.etiquetas.find(y => y.id === e.id); if (x) x.color = ev.target.value; }, { undo: false })} />
                  <input className="mini-input grow" value={e.nombre} maxLength={30} onChange={ev => mutar(dd => { const x = dd.etiquetas.find(y => y.id === e.id); if (x) x.nombre = ev.target.value; }, { undo: false })} />
                  <small className="muted" title="Bitácoras con este color">{usos}</small>
                  <button className="mini x" title="Eliminar color" disabled={d.etiquetas.length <= 1} onClick={async () => {
                    const otra = d.etiquetas.find(y => y.id !== e.id)!;
                    if (usos && !(await confirmar({ titulo: `¿Eliminar «${e.nombre}»?`, texto: `${usos} bitácora(s) pasarán a «${otra.nombre}».`, ok: 'Eliminar', peligro: true }))) return;
                    mutar(dd => { dd.etiquetas = dd.etiquetas.filter(y => y.id !== e.id); dd.bitacoras.forEach(b => { if (b.etiquetaId === e.id) b.etiquetaId = otra.id; }); });
                    toast(`Color «${e.nombre}» eliminado`, true);
                  }}>✕</button>
                </div>
              );
            })}
          </div>
          <button className="theme-btn" onClick={() => mutar(dd => { dd.etiquetas.push({ id: uid(), nombre: 'Nuevo color', color: '#60a5fa' }); })}>＋ Agregar color</button>
        </details>

        <details className="settings-group set-sec" data-sec="apariencia">
          <summary>✨ Apariencia</summary>
          <div className="set-row">
            <span>🌙 Modo oscuro</span>
            <button type="button" className={`set-switch ${a.tema === 'dark' ? 'on' : ''}`} role="switch" aria-checked={a.tema === 'dark'} onClick={() => setAj({ tema: a.tema === 'dark' ? 'light' : 'dark' })}><i>{a.tema === 'dark' ? '🌙' : '☀️'}</i></button>
          </div>
          <div className="set-row">
            <span>Tamaño</span>
            <div className="size-ctl">
              <button type="button" onClick={() => setAj({ tamano: SIZES[Math.max(0, sz - 1)] })} aria-label="Más pequeño">A−</button>
              <b>{a.tamano}%</b>
              <button type="button" onClick={() => setAj({ tamano: SIZES[Math.min(SIZES.length - 1, sz + 1)] })} aria-label="Más grande">A+</button>
            </div>
          </div>
          <div className="set-row">
            <label htmlFor="acc">Color de la app</label>
            <input id="acc" type="color" value={a.acento} onChange={e => setAj({ acento: e.target.value })} />
          </div>
        </details>

        <details className="settings-group set-sec" open={sec === 'datos' || undefined} data-sec="datos">
          <summary>💾 Tus datos</summary>
          <small className="set-hint">Se guardan en una carpeta normal de tu computadora (no en una base de datos oculta), con un respaldo automático por día.</small>
          {carpeta && <code className="ruta" title={carpeta}>{carpeta}</code>}
          {esTauri && <div className="btn-par">
            <button className="theme-btn" onClick={() => backend.abrirCarpeta().catch(e => alerta('No se pudo abrir', String(e), '⚠️', '#f59e0b'))}>📂 Abrir carpeta</button>
            <button className="theme-btn" onClick={cambiarCarpeta}>🔀 Cambiar carpeta…</button>
          </div>}

          <div className="sub-h">Pasar a otra computadora (Windows ↔ macOS)</div>
          <button className="theme-btn" onClick={respaldo}>📦 Exportar archivo de datos</button>
          <button className="theme-btn" onClick={() => fileRef.current?.click()}>📥 Importar archivo de datos</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) restaurar(f); e.target.value = ''; }} />
          <small className="set-hint">Otra forma: copia la carpeta completa a la otra computadora y aquí elige «Cambiar carpeta…». Si la pones en OneDrive / iCloud / Google Drive, las dos computadoras pueden usarla (abre la app en una a la vez).</small>

          <div className="sub-h">Excel</div>
          <button className="theme-btn" onClick={exportarCsv}>📊 Exportar a CSV</button>
          <div className="set-row">
            <label htmlFor="sep">Separador CSV</label>
            <select id="sep" className="mini-input" value={a.separadorCsv} onChange={e => setAj({ separadorCsv: e.target.value as ';' | ',' })}>
              <option value=";">; (Excel en español)</option>
              <option value=",">, (inglés)</option>
            </select>
          </div>
        </details>

        <details className="settings-group set-sec" open={sec === 'ayuda' || undefined} data-sec="ayuda">
          <summary>🧭 Ayuda y restablecer</summary>
          <button className="theme-btn" onClick={() => { toggleAjustes(); abrirTutorial(); }}>🎓 Reiniciar tutorial</button>
          <button className="theme-btn peligro" onClick={() => abrirModal(<ConfirmarFabrica />, 'small hb')}>⚠️ Restablecer todo de fábrica</button>
          <small className="set-hint">Borra todas las bitácoras y ajustes y deja la app como recién instalada. Antes se guarda un respaldo de seguridad en la carpeta «respaldos».</small>
        </details>

        <details className="settings-group set-sec" data-sec="atajos">
          <summary>⌨️ Atajos</summary>
          <ul className="keys">
            <li><kbd>N</kbd> nueva bitácora</li><li><kbd>I</kbd> importar PDF</li><li><kbd>R</kbd> resumen general</li><li><kbd>1</kbd>–<kbd>4</kbd> cambiar de vista</li>
            <li><kbd>/</kbd> buscar</li><li><kbd>T</kbd> volver a hoy</li><li><kbd>J</kbd>/<kbd>K</kbd> mes siguiente / anterior</li>
            <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> deshacer</li>
          </ul>
          <small className="set-hint">Arrastra una bitácora de la lista a un día del calendario para cambiar su día de aviso.</small>
        </details>
      </div>
    </>
  );
}

/** Confirmación fuerte para el restablecimiento de fábrica: hay que escribir BORRAR. */
function ConfirmarFabrica() {
  const [txt, setTxt] = useState('');
  const d = getDatos();
  const ok = txt.trim().toUpperCase() === 'BORRAR';
  return (
    <>
      <HbHead icon="⚠️" titulo="Restablecer de fábrica" color="var(--danger)" />
      <p className="modal-text center">Se borrarán <b>{d.bitacoras.length} bitácoras</b>, colores y ajustes. La app quedará como recién instalada y verás el tutorial de nuevo.</p>
      <p className="modal-text center">Antes se guarda un respaldo en la carpeta <b>respaldos</b>, por si acaso.</p>
      <label className="modal-label" htmlFor="fab">Escribe <b>&nbsp;BORRAR&nbsp;</b> para confirmar</label>
      <input id="fab" className="modal-input" value={txt} autoFocus onChange={e => setTxt(e.target.value)} />
      <div className="modal-btns center">
        <button className="modal-btn cancel" onClick={cerrarModal}>Cancelar</button>
        <button className="modal-btn ok danger" disabled={!ok} onClick={async () => {
          cerrarModal(); toggleAjustes();
          const ruta = await restablecerFabrica();
          alerta('App restablecida', ruta ? <>Se guardó un respaldo de seguridad en:<br /><code className="ruta">{ruta}</code></> : 'Todo volvió al estado inicial.', '🧹');
        }}>Borrar todo</button>
      </div>
    </>
  );
}
