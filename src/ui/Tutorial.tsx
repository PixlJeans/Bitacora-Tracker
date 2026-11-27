// ===== Step-by-step tutorial (in the style of the Cognose tours) =====
// Highlights each part of the screen with an explanation card. Shown the first time,
// and can be replayed from Settings → «Reiniciar tutorial».
import { useEffect, useLayoutEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { mutate } from '../lib/store';
import { openImport } from './Import';

interface Step { selected?: string; icon: string; title: string; text: string; view?: string }

const STEPS: Step[] = [
  { icon: '🌿', title: '¡Bienvenido a Bitácora Tracker!', text: 'Sigue lo que se hace en SETENA en cada bitácora: la inspección (fotos) y el llenado de bitácora de cada mes, y la Regencia cada 6 meses. Lee lo que bajas de SETENA y te dice qué falta. Te muestro lo básico en un minuto.' },
  { selected: '[data-tour="import"]', icon: '📥', title: '1. Trae todo de SETENA', text: 'En ⋯ → «📥 Descargar todo de SETENA»: abre SETENA (entras tú con tu usuario) y baja las anotaciones, fotos y PDF de cada proyecto a su carpeta, sin reemplazar nada. La app lee los PDF sola: regencias, notas de recibido, la firma del cliente y hasta la ubicación del proyecto. No escribe nada en SETENA.' },
  { selected: '[data-tour="new"]', icon: '➕', title: '2. O crea una a mano', text: 'Solo necesitas número, nombre del proyecto, fecha de apertura y estado. Las entregas se calculan solas; si alguna cambia, ajusta su fecha dentro del proyecto.' },
  { selected: '[data-tour="project"]', icon: '📅', title: '3. Cada proyecto, una fila', text: 'Lo vencido arriba. Debajo del nombre: 🌐 la última anotación en SETENA (en rojo si pasó más de un mes) y el avance. Columnas: 🚗 Inspección · 📋 Bitácora · 🗂️ Regencia · estado.', view: 'active' },
  { selected: '[data-tour="progress"], .color-filter', icon: '🚦', title: '4. Colores de avance', text: 'Pendiente (rojo), En proceso (amarillo) o Listo (verde). Un clic lo cambia; nombres y colores se editan en Ajustes.' },
  { selected: '[data-tour="monthly"]', icon: '📋', title: '5. Lo que falta', text: 'Cuenta como pendiente el mes pasado y el actual; lo de antes queda en la historia. Las fotos en SETENA marcan la inspección y cada anotación el llenado de bitácora. La Regencia va: ✍️ Elaboración → 🖊️ Firma del cliente → 📤 Subir a SETENA → 🧾 Nota de recibido. ✓ marca a mano lo que falte.' },
  { selected: '[data-tour="project"] .c-acc', icon: '🕘', title: '6. Línea de tiempo', text: 'Abre un proyecto → «Línea de tiempo»: todo lo que pasó, lo más nuevo arriba, por mes, con filtros y búsqueda. Lo marcado en la app sin anotación en SETENA sale en gris para que se note. 📂 abre la carpeta del proyecto.' },
  { selected: '[data-tour="views"]', icon: '🗂️', title: '7. Pestañas', text: 'Tareas (arriba: «🌐 En SETENA», lo último que se anotó y los proyectos sin anotar) · Proyectos · Rutas (visitas de la semana con Google Maps) · Archivadas. Un proyecto terminado se archiva con 📦; no se borra.' },
  { selected: '[data-tour="settings"]', icon: '⚙️', title: '8. Ajustes', text: 'Modo claro (estilo SETENA) u oscuro (neón), color principal, hora de los avisos y tus datos (Documentos › Bitácora Tracker, con respaldo diario).' },
  { selected: '[data-tour="help"]', icon: '❓', title: '9. Ayuda siempre a mano', text: 'Este botón abre la ayuda: repite este recorrido o activa «¿Qué hace cada cosa?» y toca cualquier botón para que te explique para qué sirve.' },
  { icon: '🔔', title: '¡Listo!', text: 'Los avisos llegan como notificación aunque cierres la ventana: la app sigue junto al reloj. Las carpetas vacías se mueven solas a «Carpetas vacías (se pueden borrar)».' }
];

let opened = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());
export function openTutorial() { opened = true; emit(); }

export function Tutorial({ hasProjects: hasProjects }: { hasProjects: boolean }) {
  const open = useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb); }; }, () => opened);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [, force] = useState(0);
  const step = STEPS[i];

  useEffect(() => { if (open) setI(0); }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    if (step.view) window.dispatchEvent(new CustomEvent('bt:view', { detail: step.view }));
    const measure = () => {
      const el = step.selected ? document.querySelector(step.selected) as HTMLElement | null : null;
      if (el) el.scrollIntoView({ block: 'nearest' });
      setRect(el ? el.getBoundingClientRect() : null);
    };
    const t = setTimeout(measure, 60);
    const r = () => { measure(); force(x => x + 1); };
    window.addEventListener('resize', r);
    return () => { clearTimeout(t); window.removeEventListener('resize', r); };
  }, [open, i, step]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); sig(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setI(x => Math.max(0, x - 1)); }
    };
    document.addEventListener('keydown', k, true);
    return () => document.removeEventListener('keydown', k, true);
  });

  if (!open) return null;

  function close() {
    opened = false; emit();
    mutate(d => { d.settings.tutorialSeen = true; }, { undo: false });
  }
  function sig() { if (i < STEPS.length - 1) setI(i + 1); else close(); }

  const pad = 6, W = 340;
  let cardStyle: CSSProperties = { left: '50%', top: '50%', transform: 'translate(-50%,-50%)' };
  if (rect) {
    const below = rect.bottom + 14 + 200 < window.innerHeight;
    const left = Math.max(12, Math.min(window.innerWidth - W - 12, rect.left + rect.width / 2 - W / 2));
    cardStyle = below ? { left, top: rect.bottom + 14 } : { left, top: Math.max(12, rect.top - 14), transform: 'translateY(-100%)' };
  }

  return (
    <div className="tour" role="dialog" aria-label="Tutorial">
      {rect
        ? <div className="tour-hole" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
        : <div className="tour-veil" />}
      <div className="tour-card" style={{ ...cardStyle, width: W }}>
        <div className="tour-top"><span className="tour-ic">{step.icon}</span>
          <span className="tour-n">{i + 1} / {STEPS.length}</span>
          <button className="tour-x" onClick={close} title="Saltar tutorial">✕</button></div>
        <h3>{step.title}</h3>
        <p>{step.text}</p>
        <div className="tour-dots">{STEPS.map((_, k) => <i key={k} className={k === i ? 'on' : k < i ? 'ok' : ''} onClick={() => setI(k)} />)}</div>
        <div className="tour-btns">
          {i > 0 && <button className="btn sm" onClick={() => setI(i - 1)}>← Atrás</button>}
          {i === 0 && <button className="btn ghost sm" onClick={close}>Saltar</button>}
          <span className="grow" />
          {i === STEPS.length - 1 && !hasProjects
            ? <button className="btn primary sm" onClick={() => { close(); openImport(); }}>Importar mi PDF</button>
            : <button className="btn primary sm" autoFocus onClick={sig}>{i === STEPS.length - 1 ? '¡Empezar!' : 'Siguiente →'}</button>}
        </div>
      </div>
    </div>
  );
}
