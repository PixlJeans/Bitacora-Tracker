// ===== Tutorial paso a paso (estilo de los recorridos de Cognose) =====
// Ilumina cada parte de la pantalla con una tarjeta explicativa. Se muestra la primera vez,
// y se puede repetir desde Ajustes → «Reiniciar tutorial».
import { useEffect, useLayoutEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { mutar } from '../lib/store';
import { abrirImportar } from './Importar';

interface Paso { sel?: string; icon: string; titulo: string; texto: string; vista?: string }

const PASOS: Paso[] = [
  { icon: '🌿', titulo: '¡Bienvenido a Bitácora Tracker!', texto: 'Te recuerda las revisiones mensuales y los informes regenciales de tus bitácoras SETENA. Todo se calcula solo desde la fecha de apertura. Te muestro lo básico en un minuto.' },
  { sel: '[data-tour="importar"]', icon: '📄', titulo: '1. Importa tu PDF', texto: 'Suelta aquí el PDF de SETENA (o pega el texto). La app encuentra número, proyecto y estado, y luego revisas cada bitácora una por una. Puedes pausar y seguir otro día.' },
  { sel: '[data-tour="nueva"]', icon: '➕', titulo: '2. O crea una a mano', texto: 'Solo necesitas número, nombre del proyecto, fecha de apertura y estado. No configuras fechas: las revisiones se calculan solas.' },
  { sel: '[data-tour="proyecto"]', icon: '📅', titulo: '3. Cada proyecto, una fila', texto: 'Avance · código · nombre · próxima fecha · estado · B · I · Entregado. La revisión mensual cae el mismo día de la apertura; el informe regencial, cada 6 meses. Abre un proyecto (✎) para ver su calendario completo.', vista: 'activas' },
  { sel: '[data-tour="avance"], .color-filtro', icon: '🚦', titulo: '4. Colores de avance', texto: 'Pendiente (rojo), En proceso (amarillo) o Listo (verde). Un clic lo cambia; nombres y colores se editan en Ajustes.' },
  { sel: '[data-tour="mensual"]', icon: '📋', titulo: '5. Marca la revisión del mes', texto: '«B» = bitácora llenada, «I» = inspección hecha: con las dos, la revisión del mes queda completa. «Entregado» marca el informe regencial. Los recordatorios se apagan solos.' },
  { sel: '[data-tour="vistas"]', icon: '🗂️', titulo: '6. Pestañas', texto: 'Activas · Mes actual · Mes próximo · Próximos informes · Archivadas. Cuando un proyecto esté «Terminado», archívalo con 📦: sale de la lista sin borrarse.' },
  { sel: '[data-tour="ajustes"]', icon: '⚙️', titulo: '7. Ajustes y tus datos', texto: 'Hora de los avisos, colores y tus datos: se guardan en Documentos › Bitácora Tracker y puedes pasarlos a otra computadora. Aquí también reinicias este tutorial.' },
  { icon: '🔔', titulo: '¡Listo!', texto: 'Los recordatorios llegan como notificación del sistema aunque cierres la ventana: la app sigue junto al reloj. Tú solo cambia el estado del proyecto; el resto es automático.' }
];

let abierto = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());
export function abrirTutorial() { abierto = true; emit(); }

export function Tutorial({ hayBitacoras }: { hayBitacoras: boolean }) {
  const open = useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb); }; }, () => abierto);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [, forzar] = useState(0);
  const paso = PASOS[i];

  useEffect(() => { if (open) setI(0); }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    if (paso.vista) window.dispatchEvent(new CustomEvent('bt:vista', { detail: paso.vista }));
    const medir = () => {
      const el = paso.sel ? document.querySelector(paso.sel) as HTMLElement | null : null;
      if (el) el.scrollIntoView({ block: 'nearest' });
      setRect(el ? el.getBoundingClientRect() : null);
    };
    const t = setTimeout(medir, 60);
    const r = () => { medir(); forzar(x => x + 1); };
    window.addEventListener('resize', r);
    return () => { clearTimeout(t); window.removeEventListener('resize', r); };
  }, [open, i, paso]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); cerrar(); }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); sig(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setI(x => Math.max(0, x - 1)); }
    };
    document.addEventListener('keydown', k, true);
    return () => document.removeEventListener('keydown', k, true);
  });

  if (!open) return null;

  function cerrar() {
    abierto = false; emit();
    mutar(d => { d.ajustes.tutorialVisto = true; }, { undo: false });
  }
  function sig() { if (i < PASOS.length - 1) setI(i + 1); else cerrar(); }

  const pad = 6, W = 340;
  let cardStyle: CSSProperties = { left: '50%', top: '50%', transform: 'translate(-50%,-50%)' };
  if (rect) {
    const abajo = rect.bottom + 14 + 200 < window.innerHeight;
    const left = Math.max(12, Math.min(window.innerWidth - W - 12, rect.left + rect.width / 2 - W / 2));
    cardStyle = abajo ? { left, top: rect.bottom + 14 } : { left, top: Math.max(12, rect.top - 14), transform: 'translateY(-100%)' };
  }

  return (
    <div className="tour" role="dialog" aria-label="Tutorial">
      {rect
        ? <div className="tour-hole" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
        : <div className="tour-veil" />}
      <div className="tour-card" style={{ ...cardStyle, width: W }}>
        <div className="tour-top"><span className="tour-ic">{paso.icon}</span>
          <span className="tour-n">{i + 1} / {PASOS.length}</span>
          <button className="tour-x" onClick={cerrar} title="Saltar tutorial">✕</button></div>
        <h3>{paso.titulo}</h3>
        <p>{paso.texto}</p>
        <div className="tour-dots">{PASOS.map((_, k) => <i key={k} className={k === i ? 'on' : k < i ? 'ok' : ''} onClick={() => setI(k)} />)}</div>
        <div className="tour-btns">
          {i > 0 && <button className="btn sm" onClick={() => setI(i - 1)}>← Atrás</button>}
          {i === 0 && <button className="btn ghost sm" onClick={cerrar}>Saltar</button>}
          <span className="grow" />
          {i === PASOS.length - 1 && !hayBitacoras
            ? <button className="btn primary sm" onClick={() => { cerrar(); abrirImportar(); }}>Importar mi PDF</button>
            : <button className="btn primary sm" autoFocus onClick={sig}>{i === PASOS.length - 1 ? '¡Empezar!' : 'Siguiente →'}</button>}
        </div>
      </div>
    </div>
  );
}
