// ===== Settings panel (port of the Cognose account menu: tools/10-settings.js + 18-notify.js) =====
// Floating button bottom right → panel with collapsible sections.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getData, mutate, reload, replaceAll, factoryReset, useAppData } from '../lib/store';
import { api, backend, esTauri, esWeb, type WebUser } from '../lib/backend';
import { currentUser } from './Login';
import { toCsv } from '../lib/csv';
import { todayISO, uid } from '../lib/dates';
import { openModal, alertBox, closeModal, confirmDialog, HbHead, toast } from './core';
import { openTutorial } from './Tutorial';
import { enableHelpMode } from './Help';
import { UpdatesSection } from './Updates';
import type { Settings as SettingsData, AppData } from '../lib/types';

let opened = false, section: string | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());
export function openSettings(sec?: string) { opened = true; section = sec || null; emit(); }
export function toggleSettings() { opened = !opened; section = null; emit(); }

const ACCOUNT_ICON = (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);

const SIZES = [85, 92, 100, 108, 116, 125];

export const APP_COLORS: { c: string; n: string }[] = [
  { c: '#4ade80', n: 'Verde' }, { c: '#2dd4bf', n: 'Turquesa' }, { c: '#60a5fa', n: 'Azul' }, { c: '#a78bfa', n: 'Morado' },
  { c: '#f472b6', n: 'Rosa' }, { c: '#f87171', n: 'Rojo' }, { c: '#fb923c', n: 'Naranja' }, { c: '#facc15', n: 'Amarillo' }
];
const THEMES: { id: SettingsData['theme']; n: string; i: string }[] = [{ id: 'light', n: 'Claro', i: '☀️' }, { id: 'dark', n: 'Oscuro', i: '🌙' }, { id: 'system', n: 'Sistema', i: '💻' }];

/** Claro u oscuro efectivo («Sistema» sigue a Windows / macOS). */
export const effectiveTheme = (t: SettingsData['theme']): 'light' | 'dark' =>
  t === 'system' ? (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t;

/** Applies theme, color and size (App calls it on every change). */
export function applyAppearance(a: SettingsData) {
  const t = effectiveTheme(a.theme);
  document.body.classList.toggle('theme-light', t === 'light');
  document.body.classList.toggle('theme-dark', t === 'dark');
  document.documentElement.style.colorScheme = t;
  // In light mode, very light colors (yellow, lime) are darkened a bit so they stay readable
  document.documentElement.style.setProperty('--accent', t === 'light' ? `color-mix(in srgb, ${a.accent} 78%, #000)` : a.accent);
  document.documentElement.style.setProperty('--accent-raw', a.accent);
  document.documentElement.style.fontSize = a.textSize === 100 ? '' : a.textSize + '%';
}

const setSettingsVal = (p: Partial<SettingsData>, undo = false) => mutate(d => { Object.assign(d.settings, p); }, { undo });

export function SettingsPanel() {
  const open = useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb); }; }, () => opened);
  const sec = useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb); }; }, () => section);
  const d = useAppData();
  const a = d.settings;
  const panel = useRef<HTMLDivElement>(null);
  const [folder, setFolder] = useState('');
  const [auto, setAuto] = useState<boolean | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    backend.dataFolder().then(setFolder).catch(() => setFolder(''));
    backend.autoStartEnabled().then(setAuto);
    if (sec) setTimeout(() => panel.current?.querySelector(`[data-sec="${sec}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50);
  }, [open, sec]);

  async function toggleNotif() {
    if (a.notifications) return setSettingsVal({ notifications: false });
    const ok = await backend.requestPermission();
    setSettingsVal({ notifications: true });
    if (!ok) alertBox('Permiso de notificaciones', 'El sistema no dio permiso. Actívalo en Configuración → Notificaciones del sistema para Bitácora Tracker. Mientras tanto verás los avisos dentro de la app.', '🔕', '#f59e0b');
  }

  async function toggleAuto() {
    const on = !(auto ?? a.autoStart);
    try { await backend.autoStart(on); setAuto(on); setSettingsVal({ autoStart: on }); }
    catch (e) { alertBox('No se pudo cambiar', String(e), '⚠️', '#f59e0b'); }
  }

  async function exportCsv() {
    const r = await backend.saveFile(`bitacoras-${todayISO()}.csv`, toCsv(getData()), 'csv', 'CSV (Excel)');
    if (r) toast('CSV exportado');
  }
  async function backup() {
    const r = await backend.saveFile(`bitacora-tracker-datos-${todayISO()}.json`, JSON.stringify(getData(), null, 1), 'json', 'Datos de Bitácora Tracker');
    if (r) alertBox('Archivo de transferencia listo', <>Copia <b>{r.split(/[\\/]/).pop()}</b> a la otra computadora (USB, correo, nube) y ahí usa <b>Ajustes → Tus datos → Importar archivo</b>. Funciona entre Windows y macOS.</>, '📦');
  }
  async function changeFolder() {
    const path = await backend.pickFolder();
    if (!path) return;
    try {
      const status = await backend.changeFolder(path, 'probe');
      if (status === 'exists') {
        const use = await confirmDialog({ title: 'Esa carpeta ya tiene datos', text: '¿Quieres USAR los datos que ya están ahí (por ejemplo, traídos de otra computadora)? Si eliges «Cancelar», no se cambia nada.', ok: 'Usar esos datos', icon: '📂' });
        if (!use) return;
        await backend.changeFolder(path, 'use');
        await reload();
        toast('Datos cargados desde la nueva carpeta');
      } else {
        await backend.changeFolder(path, 'move');
        toast('Tus datos ahora se guardan en la nueva carpeta');
      }
      setFolder(await backend.dataFolder());
    } catch (e: any) { alertBox('No se pudo cambiar la carpeta', e?.message || String(e), '⚠️', '#f59e0b'); }
  }
  async function restore(file: File) {
    try {
      const raw = JSON.parse(await file.text()) as AppData;
      if (!raw || !Array.isArray(raw.projects)) throw new Error('El archivo no es un respaldo de Bitácora Tracker.');
      const ok = await confirmDialog({ title: '¿Importar estos datos?', text: `Se reemplazarán los datos actuales por ${raw.projects.length} bitácoras del archivo. Puedes deshacer con Ctrl+Z.`, ok: 'Importar', icon: '📦' });
      if (ok) { replaceAll(raw); toast('Datos importados', true); }
    } catch (e: any) { alertBox('No se pudo leer', e.message || String(e), '⚠️', '#f59e0b'); }
  }

  const sz = SIZES.indexOf(a.textSize);
  return (
    <>
      <button className="settings-fab" data-tour="settings" data-help-title="Ajustes" data-help="Hora de los avisos, colores de avance, color principal, modo claro u oscuro, y tus datos (carpeta, pasar a otra computadora, CSV)." onClick={toggleSettings} title="Ajustes" aria-label="Ajustes">{ACCOUNT_ICON}</button>
      <div className={`settings-panel ${open ? 'open' : ''}`} ref={panel}>
        <div className="settings-header">
          <h3>Ajustes</h3>
          <button className="settings-close" onClick={toggleSettings} aria-label="Cerrar">✕</button>
        </div>

        <details className="settings-group set-sec" open={sec === 'appearance' || !sec || undefined} data-sec="appearance">
          <summary>🎨 Apariencia</summary>
          <div className="set-col">
            <span>Modo</span>
            <div className="theme-seg" role="radiogroup" aria-label="Modo claro u oscuro">
              {THEMES.map(t => (
                <button type="button" key={t.id} role="radio" aria-checked={a.theme === t.id} className={a.theme === t.id ? 'on' : ''} onClick={() => setSettingsVal({ theme: t.id })}>
                  <i>{t.i}</i>{t.n}</button>))}
            </div>
            {a.theme === 'system' && <small className="set-hint">Sigue el modo de Windows / macOS (ahora: {effectiveTheme('system') === 'dark' ? 'oscuro' : 'claro'}).</small>}
          </div>
          <div className="set-col">
            <span>Color principal</span>
            <div className="color-presets">
              {APP_COLORS.map(c => (
                <button type="button" key={c.c} title={c.n} aria-label={c.n} className={a.accent.toLowerCase() === c.c ? 'on' : ''} style={{ ['--pc' as any]: c.c }} onClick={() => setSettingsVal({ accent: c.c })} />))}
              <label className={`pc-custom ${APP_COLORS.some(c => c.c === a.accent.toLowerCase()) ? '' : 'on'}`} title="Otro color" style={{ ['--pc' as any]: a.accent }}>
                <input type="color" value={a.accent} onChange={e => setSettingsVal({ accent: e.target.value })} aria-label="Otro color" />＋</label>
            </div>
            <div className="color-sample"><span className="btn primary sm">Botón</span><span className="ck on">✓</span><span className="sample-txt">Así se verá</span></div>
          </div>
          <div className="set-row">
            <span>Tamaño del texto</span>
            <div className="size-ctl">
              <button type="button" onClick={() => setSettingsVal({ textSize: SIZES[Math.max(0, sz - 1)] })} aria-label="Más pequeño">A−</button>
              <b>{a.textSize}%</b>
              <button type="button" onClick={() => setSettingsVal({ textSize: SIZES[Math.min(SIZES.length - 1, sz + 1)] })} aria-label="Más grande">A+</button>
            </div>
          </div>
        </details>

        {esWeb && <Account isOpen={sec === 'account'} />}

        <details className="settings-group set-sec" open={sec === 'reminders' || undefined} data-sec="reminders">
          <summary>🔔 Recordatorios</summary>
          <div className="set-row">
            <span>Notificaciones del sistema</span>
            <button type="button" className={`set-switch ${a.notifications ? 'on' : ''}`} role="switch" aria-checked={a.notifications} onClick={toggleNotif}><i>{a.notifications ? '🔔' : '🔕'}</i></button>
          </div>
          <div className="set-row">
            <label htmlFor="reminderTime">Hora de los avisos</label>
            <input id="reminderTime" type="time" className="mini-input" value={a.reminderTime} onChange={e => /^\d\d:\d\d$/.test(e.target.value) && setSettingsVal({ reminderTime: e.target.value })} />
          </div>
          {esTauri && (
            <div className="set-row">
              <span>Abrir al iniciar el equipo</span>
              <button type="button" className={`set-switch ${(auto ?? a.autoStart) ? 'on' : ''}`} role="switch" aria-checked={!!(auto ?? a.autoStart)} onClick={toggleAuto}><i>{(auto ?? a.autoStart) ? '⚡' : '·'}</i></button>
            </div>
          )}
          <small className="set-hint">Automático para cada bitácora activa: Informe Regencial cada mes el mismo día de su apertura, y Regencia cada 6 meses (avisos desde 1 mes antes). Si ajustas una fecha en el proyecto, el aviso la sigue. Terminadas y archivadas no avisan.</small>
          <button className="theme-btn" onClick={async () => { if (!(await backend.testReminder())) alertBox('Sin permiso', 'Activa las notificaciones para probar.', '🔕', '#f59e0b'); }}>🔔 Probar notificación</button>
          {esWeb && <small className="set-hint">En la versión web los avisos llegan mientras la página esté abierta (en una pestaña). Para recibirlos con la página cerrada usa la app de escritorio.</small>}
          {!esWeb && <small className="set-hint">Cerrar la ventana la deja en la bandeja del sistema: los avisos siguen llegando. Para salir del todo usa «Salir» en el icono de la bandeja.</small>}
        </details>

        <details className="settings-group set-sec" open={sec === 'colors' || undefined} data-sec="colors">
          <summary>🎨 Avance (Pendiente · En proceso · Listo)</summary>
          <div className="label-list">
            {d.labels.map(e => {
              const uses = d.projects.filter(b => b.labelId === e.id).length;
              return (
                <div className="label-row" key={e.id}>
                  <input type="color" value={e.color} onChange={ev => mutate(dd => { const x = dd.labels.find(y => y.id === e.id); if (x) x.color = ev.target.value; }, { undo: false })} />
                  <input className="mini-input grow" value={e.name} maxLength={30} onChange={ev => mutate(dd => { const x = dd.labels.find(y => y.id === e.id); if (x) x.name = ev.target.value; }, { undo: false })} />
                  <small className="muted" title="Bitácoras con este color">{uses}</small>
                  <button className="mini x" title="Eliminar color" disabled={d.labels.length <= 1} onClick={async () => {
                    const other = d.labels.find(y => y.id !== e.id)!;
                    if (uses && !(await confirmDialog({ title: `¿Eliminar «${e.name}»?`, text: `${uses} bitácora(s) pasarán a «${other.name}».`, ok: 'Eliminar', danger: true }))) return;
                    mutate(dd => { dd.labels = dd.labels.filter(y => y.id !== e.id); dd.projects.forEach(b => { if (b.labelId === e.id) b.labelId = other.id; }); });
                    toast(`Color «${e.name}» eliminado`, true);
                  }}>✕</button>
                </div>
              );
            })}
          </div>
          <button className="theme-btn" onClick={() => mutate(dd => { dd.labels.push({ id: uid(), name: 'Nuevo color', color: '#60a5fa' }); })}>＋ Agregar color</button>
        </details>


        <details className="settings-group set-sec" open={sec === 'data' || undefined} data-sec="data">
          <summary>💾 Tus datos</summary>
          <small className="set-hint">{esWeb ? 'Se guardan en el servidor de la página (todas las personas con usuario ven los mismos proyectos), con un respaldo automático por día.' : 'Se guardan en una carpeta normal de tu computadora (no en una base de datos oculta), con un respaldo automático por día.'}</small>
          {folder && <code className="route" title={folder}>{folder}</code>}
          {esTauri && <div className="btn-par">
            <button className="theme-btn" onClick={() => backend.openFolder().catch(e => alertBox('No se pudo abrir', String(e), '⚠️', '#f59e0b'))}>📂 Abrir carpeta</button>
            <button className="theme-btn" onClick={changeFolder}>🔀 Cambiar carpeta…</button>
          </div>}

          <div className="sub-h">{esWeb ? 'Pasar datos entre la web y la app de escritorio' : 'Pasar a otra computadora (Windows ↔ macOS)'}</div>
          <button className="theme-btn" onClick={backup}>📦 Exportar archivo de datos</button>
          <button className="theme-btn" onClick={() => fileRef.current?.click()}>📥 Importar archivo de datos</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) restore(f); e.target.value = ''; }} />
          {!esWeb && <small className="set-hint">Otra forma: copia la carpeta completa a la otra computadora y aquí elige «Cambiar carpeta…». Si la pones en OneDrive / iCloud / Google Drive, las dos computadoras pueden usarla (abre la app en una a la vez).</small>}

          <div className="sub-h">Excel</div>
          <button className="theme-btn" onClick={exportCsv}>📊 Exportar a CSV</button>
          <div className="set-row">
            <label htmlFor="sep">Separador CSV</label>
            <select id="sep" className="mini-input" value={a.csvSeparator} onChange={e => setSettingsVal({ csvSeparator: e.target.value as ';' | ',' })}>
              <option value=";">; (Excel en español)</option>
              <option value=",">, (inglés)</option>
            </select>
          </div>
        </details>

        <UpdatesSection />
        <details className="settings-group set-sec" open={sec === 'help' || undefined} data-sec="help">
          <summary>🧭 Ayuda y restablecer</summary>
          <button className="theme-btn" onClick={() => { toggleSettings(); openTutorial(); }}>🎓 Reiniciar tutorial</button>
          <button className="theme-btn" onClick={() => { toggleSettings(); enableHelpMode(true); }}>👆 ¿Qué hace cada cosa? (modo ayuda)</button>
          {(!esWeb || currentUser()?.admin) && <button className="theme-btn risky" onClick={() => openModal(<ConfirmFactoryReset />, 'small hb')}>⚠️ Restablecer todo de fábrica</button>}
          <small className="set-hint">Borra todas las bitácoras y ajustes y deja la app como recién instalada. Antes se guarda un respaldo de seguridad en la carpeta «respaldos».</small>
        </details>

        <details className="settings-group set-sec" open={sec === 'shortcuts' || undefined} data-sec="shortcuts">
          <summary>⌨️ Atajos</summary>
          <ul className="keys">
            <li><kbd>N</kbd> nueva bitácora</li><li><kbd>I</kbd> importar PDF</li><li><kbd>R</kbd> resumen general</li><li><kbd>1</kbd>–<kbd>5</kbd> cambiar de pestaña</li>
            <li><kbd>/</kbd> o <kbd>Ctrl</kbd>+<kbd>F</kbd> buscar</li><li><kbd>,</kbd> ajustes</li>
            <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> deshacer</li><li><kbd>Esc</kbd> cerrar</li>
          </ul>
        </details>
      </div>
    </>
  );
}

/** Strong confirmation for the factory reset: you have to type BORRAR. */
function ConfirmFactoryReset() {
  const [txt, setTxt] = useState('');
  const d = getData();
  const ok = txt.trim().toUpperCase() === 'BORRAR';
  return (
    <>
      <HbHead icon="⚠️" title="Restablecer de fábrica" color="var(--danger)" />
      <p className="modal-text center">Se borrarán <b>{d.projects.length} bitácoras</b>, colores y ajustes. La app quedará como recién instalada y verás el tutorial de nuevo.</p>
      <p className="modal-text center">Antes se guarda un respaldo en la carpeta <b>respaldos</b>, por si acaso.</p>
      <label className="modal-label" htmlFor="fab">Escribe <b>&nbsp;BORRAR&nbsp;</b> para confirmar</label>
      <input id="fab" className="modal-input" value={txt} autoFocus onChange={e => setTxt(e.target.value)} />
      <div className="modal-btns center">
        <button className="modal-btn cancel" onClick={closeModal}>Cancelar</button>
        <button className="modal-btn ok danger" disabled={!ok} onClick={async () => {
          closeModal(); toggleSettings();
          const path = await factoryReset();
          alertBox('App restablecida', path ? <>Se guardó un respaldo de seguridad en:<br /><code className="route">{path}</code></> : 'Todo volvió al estado inicial.', '🧹');
        }}>Borrar todo</button>
      </div>
    </>
  );
}

/** Web: current user, sign out, change password and (administrator) users. */
function Account({ isOpen }: { isOpen: boolean }) {
  const me = currentUser();
  const [list, setList] = useState<WebUser[] | null>(null);
  const [newOne, setNewOne] = useState({ user: '', name: '', password: '', admin: false });
  const [pw, setPw] = useState({ current: '', next: '' });
  const [mode, setMode] = useState<'' | 'password' | 'users'>('');
  useEffect(() => { if (mode === 'users' && !list) api<{ users: WebUser[] }>('users').then(r => setList(r.users)).catch(e => toast(e.message)); }, [mode, list]);
  if (!me) return null;
  return (
    <details className="settings-group set-sec" open={isOpen || undefined} data-sec="account">
      <summary>👤 Cuenta</summary>
      <div className="account-me"><span className="account-av">{(me.name || me.user).slice(0, 1).toUpperCase()}</span>
        <div><b>{me.name}</b><small className="muted">{me.user}{me.admin ? ' · administrador' : ''}</small></div></div>
      <div className="btn-par">
        <button className="theme-btn" onClick={() => setMode(m => m === 'password' ? '' : 'password')}>🔑 Contraseña</button>
        <button className="theme-btn" onClick={async () => { await api('logout').catch(() => { /* ya salió */ }); location.reload(); }}>🚪 Cerrar sesión</button>
      </div>
      {mode === 'password' && <form className="set-col" onSubmit={async e => { e.preventDefault();
        try { await api('changePassword', pw); setPw({ current: '', next: '' }); setMode(''); toast('Contraseña cambiada'); } catch (er: any) { toast(er.message); } }}>
        <input className="mini-input" type="password" placeholder="Contraseña actual" autoComplete="current-password" value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} />
        <input className="mini-input" type="password" placeholder="Nueva (mín. 8)" autoComplete="new-password" value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} />
        <button className="theme-btn" type="submit">Guardar contraseña</button>
      </form>}
      {me.admin && <button className="theme-btn" onClick={() => setMode(m => m === 'users' ? '' : 'users')}>👥 Personas con acceso</button>}
      {mode === 'users' && <div className="set-col">
        {list?.map(u => (
          <div className="label-row" key={u.user}>
            <span className="grow">{u.name} <small className="muted">{u.user}{u.admin ? ' · admin' : ''}</small></span>
            {u.user !== me.user && <button className="mini x" title="Quitar acceso" onClick={async () => {
              if (!(await confirmDialog({ title: `¿Quitar el acceso a ${u.name}?`, text: 'Ya no podrá entrar. Sus anotaciones se conservan.', ok: 'Quitar', danger: true }))) return;
              try { setList((await api<{ users: WebUser[] }>('userDelete', { user: u.user })).users); } catch (er: any) { toast(er.message); }
            }}>✕</button>}
          </div>))}
        <div className="sub-h">Agregar persona</div>
        <input className="mini-input" placeholder="Nombre" value={newOne.name} onChange={e => setNewOne({ ...newOne, name: e.target.value })} />
        <input className="mini-input" placeholder="Usuario (sin espacios)" autoCapitalize="none" value={newOne.user} onChange={e => setNewOne({ ...newOne, user: e.target.value.toLowerCase().trim() })} />
        <input className="mini-input" placeholder="Contraseña inicial (mín. 8)" value={newOne.password} onChange={e => setNewOne({ ...newOne, password: e.target.value })} />
        <label className="na-check"><input type="checkbox" checked={newOne.admin} onChange={e => setNewOne({ ...newOne, admin: e.target.checked })} /> Administrador (puede agregar personas)</label>
        <button className="theme-btn" onClick={async () => {
          try { setList((await api<{ users: WebUser[] }>('userCreate', newOne)).users); toast(`${newOne.name || newOne.user} ya puede entrar`); setNewOne({ user: '', name: '', password: '', admin: false }); }
          catch (er: any) { toast(er.message); }
        }}>＋ Agregar</button>
        <small className="set-hint">Comparte con esa persona la dirección de la página, su usuario y la contraseña inicial; luego puede cambiarla en Cuenta.</small>
      </div>}
    </details>
  );
}
