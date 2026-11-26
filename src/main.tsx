import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { start } from './lib/store';
import { esWeb } from './lib/backend';
import { Login } from './ui/Login';
import './styles/base.css';
import './styles/cognose.css';
import './styles/app.css';
import './styles/setena.css';

const root = createRoot(document.getElementById('root')!);

if (!esWeb) {
  // Desktop (or preview): straight into the app
  start().finally(() => root.render(<StrictMode><App /></StrictMode>));
} else {
  // Published web: sign-in first, then the server data
  root.render(<StrictMode><WebRoot /></StrictMode>);
}

function WebRoot() {
  const [phase, setPhase] = useState<'login' | 'loading' | 'app' | 'error'>('login');
  const [err, setErr] = useState('');
  const enter = () => {
    setPhase('loading');
    start().then(() => setPhase('app')).catch((e: any) => { setErr(e?.message || String(e)); setPhase('error'); });
  };
  if (phase === 'app') return <App />;
  if (phase === 'loading') return <div className="loading">Cargando tus bitácoras…</div>;
  if (phase === 'error') return (
    <div className="login"><div className="login-card">
      <div className="login-logo">⚠️</div><h1>No se pudieron cargar los datos</h1>
      <p className="login-err">{err}</p>
      <button className="btn primary login-btn" onClick={enter}>Reintentar</button>
    </div></div>
  );
  return <Login onReady={enter} />;
}
