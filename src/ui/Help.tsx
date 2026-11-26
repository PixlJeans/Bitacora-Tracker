// ===== Floating help («?» button, bottom right) =====
// Menu with: step-by-step tour · «¿Qué hace esto?» (help mode: each part of the screen
// shows a «?»; tapping it opens a floating card explaining what it does) · shortcuts.
// The explanations live in the HTML itself in the data-help="…" attribute (and data-help-title for the title).
import { useEffect, useLayoutEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { openTutorial } from './Tutorial';
import { openSettings } from './Settings';

let menu = false, mode = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());
const useVal = <T,>(get: () => T) => useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb); }; }, get);
export function enableHelpMode(on = true) { mode = on; menu = false; document.body.classList.toggle('help-mode', on); emit(); }
export const helpModeActive = () => mode;

const HELP_ICON = (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" /><path d="M12 17h.01" />
  </svg>
);

interface Point { el: HTMLElement; r: DOMRect; t: string; txt: string }

export function Help() {
  const opened = useVal(() => menu);
  const isActive = useVal(() => mode);
  const [points, setPoints] = useState<Point[]>([]);
  const [selected, setSel] = useState<Point | null>(null);

  // Measure every element with an explanation that is visible on screen
  useLayoutEffect(() => {
    if (!isActive) { setPoints([]); setSel(null); return; }
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const seen = new Set<string>();
        const l: Point[] = [];
        document.querySelectorAll<HTMLElement>('[data-help]').forEach(el => {
          if (el.closest('.help-ui')) return;
          const r = el.getBoundingClientRect();
          if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return;
          const txt = el.dataset.help!;
          // In lists, a single «?» per column type (the first visible one)
          const key = (el.dataset.helpTitle || '') + txt;
          if (seen.has(key)) return;
          seen.add(key);
          l.push({ el, r, t: el.dataset.helpTitle || el.getAttribute('aria-label') || el.title || (el.textContent || '').trim().slice(0, 40), txt });
        });
        setPoints(l);
      });
    };
    measure();
    const observer = new MutationObserver(measure);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    addEventListener('resize', measure); addEventListener('scroll', measure, true);
    return () => { observer.disconnect(); removeEventListener('resize', measure); removeEventListener('scroll', measure, true); cancelAnimationFrame(raf); };
  }, [isActive]);

  // In help mode, a click explains instead of acting
  useEffect(() => {
    if (!isActive) return;
    const clicked = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('.help-ui')) return;
      e.preventDefault(); e.stopPropagation();
      const el = t.closest<HTMLElement>('[data-help]');
      if (!el) { setSel(null); return; }
      setSel({ el, r: el.getBoundingClientRect(), t: el.dataset.helpTitle || el.getAttribute('aria-label') || el.title || (el.textContent || '').trim().slice(0, 40), txt: el.dataset.help! });
    };
    const keyName = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); if (selected) setSel(null); else enableHelpMode(false); } };
    document.addEventListener('click', clicked, true);
    document.addEventListener('keydown', keyName, true);
    return () => { document.removeEventListener('click', clicked, true); document.removeEventListener('keydown', keyName, true); };
  }, [isActive, selected]);

  useEffect(() => {
    if (!opened) return;
    const outside = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.help-menu, .help-fab')) { menu = false; emit(); } };
    setTimeout(() => document.addEventListener('click', outside), 0);
    return () => document.removeEventListener('click', outside);
  }, [opened]);

  const W = 300;
  let cardStyle: CSSProperties = {};
  if (selected) {
    const r = selected.r;
    const below = r.bottom + 12 + 150 < innerHeight;
    const left = Math.max(10, Math.min(innerWidth - W - 10, r.left + r.width / 2 - W / 2));
    cardStyle = below ? { left, top: r.bottom + 10, width: W } : { left, top: r.top - 10, width: W, transform: 'translateY(-100%)' };
  }

  return (
    <>
      <button className={`help-fab help-ui ${isActive ? 'on' : ''}`} data-tour="help" title="Ayuda y tutorial" aria-label="Ayuda y tutorial"
        onClick={() => { if (isActive) enableHelpMode(false); else { menu = !menu; emit(); } }}>
        {isActive ? <span className="help-x">✕</span> : HELP_ICON}
      </button>

      {opened && (
        <div className="help-menu help-ui" role="menu">
          <div className="help-menu-h">¿Cómo te ayudo?</div>
          <button role="menuitem" onClick={() => { menu = false; emit(); openTutorial(); }}>
            <span>🎓</span><div><b>Recorrido paso a paso</b><small>Te muestro lo básico en 1 minuto</small></div></button>
          <button role="menuitem" onClick={() => enableHelpMode(true)}>
            <span>👆</span><div><b>¿Qué hace cada cosa?</b><small>Toca cualquier botón y te explico para qué sirve</small></div></button>
          <button role="menuitem" onClick={() => { menu = false; emit(); openSettings('appearance'); }}>
            <span>🎨</span><div><b>Color y modo claro / oscuro</b><small>Personaliza la apariencia</small></div></button>
          <button role="menuitem" onClick={() => { menu = false; emit(); openSettings('shortcuts'); }}>
            <span>⌨️</span><div><b>Atajos de teclado</b><small>N, I, R, 1–5, /…</small></div></button>
        </div>
      )}

      {isActive && <>
        <div className="help-banner help-ui">👆 <b>Modo ayuda:</b> toca cualquier parte marcada con <i className="help-q">?</i> para saber qué hace.
          <button className="btn sm" onClick={() => enableHelpMode(false)}>Salir (Esc)</button></div>
        {points.map((p, k) => (
          <button key={k} className={`help-q help-ui float ${selected?.el === p.el ? 'sel' : ''}`} style={{ left: p.r.right - 9, top: p.r.top - 9 }}
            onClick={() => setSel(p)} aria-label={`Qué es: ${p.t}`}>?</button>
        ))}
        {selected && <>
          <div className="help-frame help-ui" style={{ left: selected.r.left - 4, top: selected.r.top - 4, width: selected.r.width + 8, height: selected.r.height + 8 }} />
          <div className="help-card help-ui" style={cardStyle} role="tooltip">
            <b>{selected.t}</b>
            <p>{selected.txt}</p>
            <div className="help-card-b"><small className="muted">Toca otra parte o Esc</small>
              <button className="btn sm" onClick={() => setSel(null)}>Entendido</button></div>
          </div>
        </>}
      </>}
    </>
  );
}
