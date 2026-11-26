// ===== Step-by-step tutorial (in the style of the Cognose tours) =====
// Highlights each part of the screen with an explanation card. Shown the first time,
// and can be replayed from Settings → «Reiniciar tutorial».
import { useEffect, useLayoutEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { mutate } from '../lib/store';
import { openImport } from './Import';

interface Step { selected?: string; icon: string; title: string; text: string; view?: string }

const STEPS: Step[] = [
  { icon: '🌿', title: '¡Bienvenido a Bitácora Tracker!', text: 'Te recuerda el Informe Regencial de cada mes y la Regencia cada 6 meses de tus bitácoras SETENA, ordena todo por fecha, guarda fotos, cartas y notas, y agrupa visitas a proyectos cercanos. Las fechas salen de la apertura y se pueden ajustar. Te muestro lo básico en un minuto.' },
  { selected: '[data-tour="import"]', icon: '📄', title: '1. Importa tu listado', text: 'Suelta aquí el PDF de SETENA (o pega el texto). La app encuentra número, proyecto y estado, y luego revisas cada bitácora una por una. Puedes pausar y seguir otro día.' },
  { selected: '[data-tour="new"]', icon: '➕', title: '2. O crea una a mano', text: 'Solo necesitas número, nombre del proyecto, fecha de apertura y estado. Las entregas se calculan solas; si alguna cambia, ajusta su fecha dentro del proyecto.' },
  { selected: '[data-tour="project"]', icon: '📅', title: '3. Cada proyecto, una fila', text: 'Ordenados por fecha: lo vencido y lo más próximo arriba. Avance · código · nombre · próxima fecha (con sus pasos 🚗📷✉️⬆) · estado · V · S · Regencia.', view: 'active' },
  { selected: '[data-tour="progress"], .color-filter', icon: '🚦', title: '4. Colores de avance', text: 'Pendiente (rojo), En proceso (amarillo) o Listo (verde). Un clic lo cambia; nombres y colores se editan en Ajustes.' },
  { selected: '[data-tour="monthly"]', icon: '📋', title: '5. Marca el Informe Regencial del mes', text: '«V» = visita hecha, «S» = subido a SETENA: con las dos el mes queda completo. «Regencia» marca la semestral. Dentro del proyecto marcas también fotos y carta, y corriges cada fecha. Los recordatorios se apagan solos.' },
  { selected: '[data-tour="project"] .c-acc', icon: '📷', title: '6. Fotos, informes y notas', text: 'Abre un proyecto (✎) → pestaña «Bitácora»: agrega fotos de la visita, el PDF de la Regencia u observaciones. La fecha y el GPS de las fotos se leen solos: marcan la visita y guardan la ubicación del proyecto. Con «Fotos desde el celular» escaneas un QR y las fotos llegan solas. Cada anotación queda «Por subir a SETENA» hasta que la marcas como subida.' },
  { selected: '[data-tour="views"]', icon: '🗂️', title: '7. Pestañas', text: 'Activas · Agenda y rutas (lo pendiente por fecha y salidas con proyectos cercanos) · Mes actual · Mes próximo · Regencias · Archivadas. Cuando un proyecto termina: «Terminada» y ciérralo con 📦; sale de la lista sin borrarse.' },
  { selected: '[data-tour="settings"]', icon: '⚙️', title: '8. Ajustes', text: 'Color principal, modo claro / oscuro, hora de los avisos y tus datos (Documentos › Bitácora Tracker, con respaldo diario y paso a otra computadora).' },
  { selected: '[data-tour="help"]', icon: '❓', title: '9. Ayuda siempre a mano', text: 'Este botón abre la ayuda: repite este recorrido o activa «¿Qué hace cada cosa?» y toca cualquier botón para que te explique para qué sirve.' },
  { icon: '🔔', title: '¡Listo!', text: 'Los recordatorios llegan como notificación del sistema aunque cierres la ventana: la app sigue junto al reloj. Tú solo cambia el estado del proyecto; el resto es automático.' }
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
