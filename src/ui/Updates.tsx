// ===== «Hay una versión nueva» dialog and Settings section =====
import { useEffect, useState } from 'react';
import { checkForUpdate, checkInBackground, currentVersion } from '../lib/updater';
import { esTauri } from '../lib/backend';
import { HbHead, openModal, closeModal, hasModal, toast } from './core';

type Install = (p: (n: number) => void) => Promise<void>;

function UpdateModal({ version, notes: notes, install: install }: { version: string; notes: string; install: Install }) {
  const [p, setP] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const start = () => {
    setP(0); setErr('');
    install(setP).catch(e => { setP(null); setErr(String(e?.message || e)); });
  };
  return (
    <div>
      <HbHead icon="🔄" title="Hay una versión nueva" sub={`Bitácora Tracker ${version}`} />
      {notes && <p className="muted sm" style={{ whiteSpace: 'pre-wrap' }}>{notes}</p>}
      <p className="sm">Se descarga, se instala y la app se vuelve a abrir sola. Tus proyectos, fotos y cartas no se tocan.</p>
      {p !== null && <div className="upd-bar"><i style={{ width: `${p}%` }} /><span>{p < 100 ? `Descargando… ${p}%` : 'Instalando…'}</span></div>}
      {err && <p className="ed-hint warn">No se pudo actualizar: {err}</p>}
      <div className="modal-btns">
        <button type="button" className="modal-btn cancel" disabled={p !== null} onClick={closeModal}>Más tarde</button>
        <button type="button" className="modal-btn ok" disabled={p !== null} onClick={start}>Actualizar ahora</button>
      </div>
    </div>
  );
}

const show = (version: string, notes: string, install: Install) =>
  openModal(<UpdateModal version={version} notes={notes} install={install} />, 'small hb');

let started = false;
/** Called once when the app opens. */
export function startUpdates() {
  if (started || !esTauri) return;
  started = true;
  checkInBackground((v, n, install) => {
    if (hasModal()) toast(`🔄 Hay una versión nueva (${v}): Ajustes → Actualizaciones`);
    else show(v, n, install);
  });
}

/** Settings section: installed version + «Buscar actualizaciones» button. */
export function UpdatesSection() {
  const [version, setVersion] = useState('');
  const [status, setStatusText] = useState('');
  useEffect(() => { currentVersion().then(setVersion); }, []);
  if (!esTauri) return null;
  const check = async () => {
    setStatusText('Buscando…');
    try {
      const u = await checkForUpdate();
      if (u) { setStatusText(''); show(u.version, u.notes, u.install); }
      else setStatusText('✓ Tienes la versión más reciente.');
    } catch (e: any) { setStatusText('No se pudo revisar (¿sin internet?): ' + (e?.message || e)); }
  };
  return (
    <details className="settings-group set-sec" data-sec="updates">
      <summary>🔄 Actualizaciones</summary>
      <div className="set-row"><span>Versión instalada</span><b className="mono">{version || '—'}</b></div>
      <button className="theme-btn" onClick={check}>🔄 Buscar actualizaciones</button>
      {status && <small className="set-hint">{status}</small>}
      <small className="set-hint">La app revisa sola al abrir y cada 6 horas. Si hay una versión nueva, te pregunta y se actualiza sin reinstalar.</small>
    </details>
  );
}
