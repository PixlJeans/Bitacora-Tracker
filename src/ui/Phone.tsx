// ===== Celular: the phone page over Wi-Fi (free, no accounts) =====
// The laptop app serves a page on the local network. Scan the QR once, add it to the home screen,
// and from then on the phone shows the tasks (checkboxes) and sends photos straight to the
// month's Fotos folder. It works while the app is open on the laptop and both are on the same Wi-Fi.
import { useEffect, useState } from 'react';
import { backend } from '../lib/backend';
import { openModal, closeModal, toast } from './core';

export function openPhone() { openModal(<Phone />, 'create-modal phone-modal'); }

function Phone() {
  const [qr, setQr] = useState<{ url: string; svg: string } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { backend.phoneStart().then(setQr).catch((e: any) => setErr(e?.message || String(e))); }, []);
  return (
    <div className="phone-box">
      <h2>📱 Usar en el celular</h2>
      {err && <p className="ed-hint warn">{err}</p>}
      {qr && <div className="phone-grid">
        <div className="qr" dangerouslySetInnerHTML={{ __html: qr.svg }} />
        <ol className="phone-steps">
          <li>Conecta el celular al <b>mismo Wi-Fi</b> que esta computadora.</li>
          <li>Abre la cámara y escanea el código.</li>
          <li>En el navegador del celular: <b>⋮ → Agregar a la pantalla de inicio</b>. Queda como una app.</li>
          <li>Ahí ves las <b>✅ Tareas</b> para marcarlas, y con <b>📷</b> tomas las fotos de la inspección: llegan a la carpeta Fotos del mes y marcan la inspección.</li>
        </ol>
      </div>}
      {qr && <p className="qr-url"><code>{qr.url}</code> <button type="button" className="dp-link" onClick={() => navigator.clipboard.writeText(qr.url).then(() => toast('Enlace copiado'))}>Copiar enlace</button></p>}
      <p className="muted sm">Gratis y sin cuentas: funciona mientras la app esté abierta en la computadora. El enlace es siempre el mismo (si Windows pregunta por el firewall, permite el acceso en redes privadas).</p>
      <div className="modal-actions"><span className="grow" /><button type="button" className="btn primary" onClick={closeModal}>Listo</button></div>
    </div>
  );
}
