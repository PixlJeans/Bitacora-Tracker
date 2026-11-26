// ===== UI core (port of Cognose tools/05-modal.js + cal-forms toast + cal-views icons) =====
//  · A single dialog system for everything: openModal / closeModal / confirmDialog / alertBox
//  · Habitica-style pop-ups: colored header with a big icon (variant `hb`)
//  · Bottom toast with «Deshacer» (undo)
//  · Anchored popover (quick status and color picker)
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Undo } from '../lib/store';

// ---------- SVG icons (inherit the text color) ----------
const ICONS: Record<string, string> = {
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="12" cy="5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="19" r="1.3"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  review: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  notes: '<path d="M5 7h14M5 12h14M5 17h9"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>'
};
export const Ic = ({ n, size }: { n: string; size?: number }) => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" style={size ? { width: size, height: size } : undefined} dangerouslySetInnerHTML={{ __html: ICONS[n] || '' }} />
);

// ---------- Ventanas ----------
interface ModalState { node: ReactNode; size: string; locked?: boolean }
let modal: ModalState | null = null;
const msubs = new Set<() => void>();
const memit = () => msubs.forEach(f => f());

export function openModal(node: ReactNode, size = '') { modal = { node, size }; memit(); }
export function closeModal() { modal = null; memit(); }
export const hasModal = () => !!modal;

// Same as in Cognose: if the click started inside the dialog (selecting text, dragging), it doesn't close.
let pressInside = false, dragDist = 0, down: { x: number; y: number } | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener('mousedown', e => {
    down = { x: e.clientX, y: e.clientY }; dragDist = 0;
    pressInside = !!(e.target as HTMLElement).closest?.('.modal');
  });
  document.addEventListener('mousemove', e => {
    if (down) dragDist = Math.max(dragDist, Math.abs(e.clientX - down.x), Math.abs(e.clientY - down.y));
  });
  document.addEventListener('mouseup', () => { down = null; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal && !document.querySelector('.pop')) closeModal(); });
}

export function ModalHost() {
  const m = useSyncExternalStore(cb => { msubs.add(cb); return () => { msubs.delete(cb); }; }, () => modal);
  if (!m) return null;
  return (
    <div className="modal-overlay" onClick={() => { if (!pressInside && dragDist <= 5) closeModal(); }}>
      <div className={`modal ${m.size}`} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">{m.node}</div>
    </div>
  );
}

/** Habitica-style header: colored band with a big round icon and the centered title. */
export function HbHead({ icon, title: title, sub, color = 'var(--accent)' }: { icon: string; title: string; sub?: string; color?: string }) {
  return (
    <div className="hb-head" style={{ ['--hb' as any]: color }}>
      <div className="hb-band"><span className="hb-spark s1" /><span className="hb-spark s2" /><span className="hb-spark s3" /></div>
      <div className="hb-icon">{icon}</div>
      <h3>{title}</h3>
      {sub && <p className="hb-sub">{sub}</p>}
    </div>
  );
}

export function confirmDialog(o: { title: string; text: string; ok?: string; danger?: boolean; icon?: string }): Promise<boolean> {
  return new Promise(res => {
    const end = (v: boolean) => { closeModal(); res(v); };
    openModal(
      <>
        <HbHead icon={o.icon || (o.danger ? '🗑️' : '❔')} title={o.title} color={o.danger ? 'var(--danger)' : 'var(--accent)'} />
        <p className="modal-text center">{o.text}</p>
        <div className="modal-btns center">
          <button className="modal-btn cancel" onClick={() => end(false)}>Cancelar</button>
          <button className={`modal-btn ok ${o.danger ? 'danger' : ''}`} autoFocus onClick={() => end(true)}>{o.ok || 'Aceptar'}</button>
        </div>
      </>, 'small hb');
  });
}

export function alertBox(title: string, text?: ReactNode, icon = '✨', color?: string) {
  openModal(
    <>
      <HbHead icon={icon} title={title} color={color} />
      {text && <div className="modal-text center">{text}</div>}
      <div className="modal-btns center"><button className="modal-btn ok" autoFocus onClick={closeModal}>¡Listo!</button></div>
    </>, 'small hb');
}

// ---------- Toast with Undo ----------
let toastMsg: { msg: string; undo: boolean; id: number } | null = null;
let toastT: ReturnType<typeof setTimeout> | null = null;
const tsubs = new Set<() => void>();
export function toast(msg: string, undo = false) {
  toastMsg = { msg, undo, id: Date.now() };
  tsubs.forEach(f => f());
  if (toastT) clearTimeout(toastT);
  toastT = setTimeout(() => { toastMsg = null; tsubs.forEach(f => f()); }, 5000);
}
export function ToastHost() {
  const t = useSyncExternalStore(cb => { tsubs.add(cb); return () => { tsubs.delete(cb); }; }, () => toastMsg);
  if (!t) return null;
  const close = () => { toastMsg = null; tsubs.forEach(f => f()); };
  return (
    <div className="toast" key={t.id}>
      <span>{t.msg}</span>
      {t.undo && <button onClick={() => { Undo.pop(); close(); }}>Deshacer</button>}
      <button className="x" onClick={close} title="Cerrar"><Ic n="close" /></button>
    </div>
  );
}

// ---------- Anchored popover (like the quick popover of the Cognose calendar) ----------
export function Popover({ anchor, onClose, children, width = 230 }:
  { anchor: HTMLElement; onClose: () => void; children?: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const h = ref.current?.offsetHeight || 200;
    let left = Math.min(r.left, window.innerWidth - width - 8);
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    setPos({ left: Math.max(8, left), top });
  }, [anchor, width]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', k, true);
    return () => document.removeEventListener('keydown', k, true);
  }, [onClose]);
  return (
    <div className="pop-layer" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pop" ref={ref} style={{ ...pos, width }}>{children}</div>
    </div>
  );
}
