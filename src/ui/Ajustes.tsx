// ===== Panel de ajustes (puerto del menú de cuenta de Cognose: tools/10-settings.js + 18-notify.js) =====
// Botón flotante abajo a la derecha → panel con secciones plegables.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getDatos, mutar, reemplazar, useDatos } from '../lib/store';
import { backend, esTauri } from '../lib/backend';
import { aCsv } from '../lib/csv';
import { todayISO, uid } from '../lib/fechas';
import { DatePick } from './DatePick';
import { alerta, confirmar, toast } from './core';
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
    const r = await backend.guardarArchivo(`respaldo-bitacoras-${todayISO()}.json`, JSON.stringify(getDatos(), null, 1), 'json', 'Respaldo JSON');
    if (r) toast('Respaldo guardado');
  }
  async function restaurar(file: File) {
    try {
      const raw = JSON.parse(await file.text()) as Datos;
      if (!raw || !Array.isArray(raw.bitacoras)) throw new Error('El archivo no es un respaldo de Bitácora Tracker.');
      const ok = await confirmar({ titulo: '¿Restaurar respaldo?', texto: `Se reemplazarán los datos actuales por ${raw.bitacoras.length} bitácoras del respaldo. Puedes deshacer con Ctrl+Z.`, ok: 'Restaurar', icon: '♻️' });
      if (ok) { reemplazar(raw); toast('Respaldo restaurado', true); }
    } catch (e: any) { alerta('No se pudo leer', e.message || String(e), '⚠️', '#f59e0b'); }
  }

  const sz = SIZES.indexOf(a.tamano);
  return (
    <>
      <button className="settings-fab" onClick={toggleAjustes} title="Ajustes" aria-label="Ajustes">{ACCOUNT_ICON}</button>
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
          <div className="set-row">
            <label htmlFor="diaDef">Día de aviso por defecto</label>
            <select id="diaDef" className="mini-input" value={a.diaAvisoDefecto} onChange={e => setAj({ diaAvisoDefecto: Number(e.target.value) })}>
              {Array.from({ length: 28 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
            </select>
          </div>
          {esTauri && (
            <div className="set-row">
              <span>Abrir al iniciar el equipo</span>
              <button type="button" className={`set-switch ${(auto ?? a.autoInicio) ? 'on' : ''}`} role="switch" aria-checked={!!(auto ?? a.autoInicio)} onClick={toggleAuto}><i>{(auto ?? a.autoInicio) ? '⚡' : '·'}</i></button>
            </div>
          )}
          <div className="set-col">
            <span>Revisión semestral: primera fecha <small className="muted">(luego cada 6 meses)</small></span>
            <DatePick value={a.semestralInicio} onChange={v => v && setAj({ semestralInicio: v }, true)} />
          </div>
          <button className="theme-btn" onClick={async () => { if (!(await backend.probarAviso())) alerta('Sin permiso', 'Activa las notificaciones para probar.', '🔕', '#f59e0b'); }}>🔔 Probar notificación</button>
          <small className="set-hint">Cerrar la ventana la deja en la bandeja del sistema: los avisos siguen llegando. Para salir del todo usa «Salir» en el icono de la bandeja.</small>
        </details>

        <details className="settings-group set-sec" open={sec === 'colores' || undefined} data-sec="colores">
          <summary>🎨 Colores de prioridad</summary>
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

        <details className="settings-group set-sec" data-sec="datos">
          <summary>💾 Datos</summary>
          <button className="theme-btn" onClick={exportarCsv}>📊 Exportar a CSV (Excel)</button>
          <div className="set-row">
            <label htmlFor="sep">Separador CSV</label>
            <select id="sep" className="mini-input" value={a.separadorCsv} onChange={e => setAj({ separadorCsv: e.target.value as ';' | ',' })}>
              <option value=";">; (Excel en español)</option>
              <option value=",">, (inglés)</option>
            </select>
          </div>
          <button className="theme-btn" onClick={respaldo}>⬇️ Guardar respaldo (.json)</button>
          <button className="theme-btn" onClick={() => fileRef.current?.click()}>♻️ Restaurar respaldo</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) restaurar(f); e.target.value = ''; }} />
          {carpeta && <small className="set-hint">Tus datos se guardan en: <code>{carpeta}</code></small>}
        </details>

        <details className="settings-group set-sec" data-sec="atajos">
          <summary>⌨️ Atajos</summary>
          <ul className="keys">
            <li><kbd>N</kbd> nueva bitácora</li><li><kbd>I</kbd> importar PDF</li><li><kbd>R</kbd> revisión semestral</li>
            <li><kbd>/</kbd> buscar</li><li><kbd>T</kbd> volver a hoy</li><li><kbd>J</kbd>/<kbd>K</kbd> mes siguiente / anterior</li>
            <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> deshacer</li>
          </ul>
          <small className="set-hint">Arrastra una bitácora de la lista a un día del calendario para cambiar su día de aviso.</small>
        </details>
      </div>
    </>
  );
}
