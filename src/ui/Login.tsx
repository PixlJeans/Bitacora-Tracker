// ===== Sign-in for the web version =====
// All in the same page: if there are no accounts yet, the administrator's is created;
// otherwise user + password. After signing in the server data is loaded and the app appears.
import { useEffect, useState } from 'react';
import { api, type WebUser } from '../lib/backend';

let current: WebUser | null = null;
export const currentUser = () => current;

export function Login({ onReady }: { onReady: (u: WebUser) => void }) {
  const [phase, setPhase] = useState<'loading' | 'login' | 'first' | 'error'>('loading');
  const [user, setUser] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function check() {
    setErr(''); setPhase('loading');
    try {
      const r = await api<{ hasUsers: boolean; user: WebUser | null }>('status');
      if (r.user) { current = r.user; onReady(r.user); return; }
      setPhase(r.hasUsers ? 'login' : 'first');
    } catch (e: any) { setErr(e.message); setPhase('error'); }
  }
  useEffect(() => { check(); }, []); // eslint-disable-line

  async function send() {
    setErr('');
    if (phase === 'first' && password !== password2) return setErr('Las contraseñas no coinciden.');
    setBusy(true);
    try {
      const r = await api<{ user: WebUser }>(phase === 'first' ? 'createFirst' : 'login', { user, name, password });
      current = r.user; onReady(r.user);
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={e => { e.preventDefault(); send(); }}>
        <div className="login-logo">🌿</div>
        <h1>Bitácora Tracker</h1>
        <p className="login-sub">Bitácoras ambientales SETENA</p>

        {phase === 'loading' && <p className="muted center">Conectando…</p>}
        {phase === 'error' && <>
          <p className="login-err">{err}</p>
          <button type="button" className="btn primary" onClick={check}>Reintentar</button>
        </>}

        {(phase === 'login' || phase === 'first') && <>
          {phase === 'first' && <div className="login-note">👋 Primera vez: crea la cuenta del <b>administrador</b>. Después podrás agregar a más personas desde Ajustes → Cuenta.</div>}
          {phase === 'first' && <>
            <label className="modal-label" htmlFor="ac_nom">Tu nombre</label>
            <input id="ac_nom" className="modal-input" value={name} onChange={e => setName(e.target.value)} autoComplete="name" placeholder="Ej. María Rodríguez" />
          </>}
          <label className="modal-label" htmlFor="ac_us">Usuario</label>
          <input id="ac_us" className="modal-input" value={user} onChange={e => setUser(e.target.value.toLowerCase().trim())} autoComplete="username" autoCapitalize="none" autoFocus placeholder="usuario o correo" />
          <label className="modal-label" htmlFor="ac_cl">Contraseña</label>
          <div className="login-password">
            <input id="ac_cl" className="modal-input" type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} autoComplete={phase === 'first' ? 'new-password' : 'current-password'} placeholder={phase === 'first' ? 'mínimo 8 caracteres' : ''} />
            <button type="button" className="icon-btn sm" onClick={() => setShowPassword(v => !v)} title={showPassword ? 'Ocultar' : 'Mostrar'}>{showPassword ? '🙈' : '👁️'}</button>
          </div>
          {phase === 'first' && <>
            <label className="modal-label" htmlFor="ac_cl2">Repite la contraseña</label>
            <input id="ac_cl2" className="modal-input" type={showPassword ? 'text' : 'password'} value={password2} onChange={e => setPassword2(e.target.value)} autoComplete="new-password" />
          </>}
          <p className="login-err" role="alert">{err}</p>
          <button type="submit" className="btn primary login-btn" disabled={busy || !user || !password}>
            {busy ? 'Un momento…' : phase === 'first' ? 'Crear cuenta y entrar' : 'Entrar'}</button>
          {phase === 'login' && <p className="login-foot">¿Olvidaste la contraseña? Pídele al administrador que te cree una nueva.</p>}
        </>}
      </form>
    </div>
  );
}
