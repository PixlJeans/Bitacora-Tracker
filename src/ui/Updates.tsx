// ===== Settings section: installed version =====
// The app is built and installed on this computer with update-app.bat (GitHub only keeps a backup of the code).
import { useEffect, useState } from 'react';
import { esTauri } from '../lib/backend';

export function UpdatesSection() {
  const [version, setVersion] = useState('');
  useEffect(() => {
    if (!esTauri) return;
    import('@tauri-apps/api/app').then(m => m.getVersion()).then(setVersion).catch(() => { /* outside the app */ });
  }, []);
  if (!esTauri) return null;
  return (
    <details className="settings-group set-sec" data-sec="updates">
      <summary>🔄 Versión</summary>
      <div className="set-row"><span>Versión instalada</span><b className="mono">{version || '—'}</b></div>
      <small className="set-hint">Para actualizar: en la carpeta del proyecto, doble clic en update-app.bat. Compila, instala y vuelve a abrir la app.</small>
    </details>
  );
}
