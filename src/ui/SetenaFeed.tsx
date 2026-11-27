// ===== «En SETENA»: what was done in SETENA lately, across all projects (top of Tareas) =====
// The tracker's main question: what did we actually put in SETENA, and which projects have gone quiet?
// Data: each project's Línea de tiempo (SETENA entries, regencia PDFs, receipts), read with «Descargar todo de SETENA».
import { useMemo, useState } from 'react';
import type { AppData, Project } from '../lib/types';
import { timelineOf, type TlItem } from '../lib/timeline';
import { quietInSetena, agoText } from '../lib/setenaInfo';
import { addDays, shortDate, todayISO } from '../lib/dates';
import { backend } from '../lib/backend';
import { openEditor } from './ProjectEditor';
import { toast } from './core';

const DAYS = 45;
const ICON: Partial<Record<TlItem['kind'], string>> = { setena: '🌐', regencia: '🗂️', receipt: '🧾', visit: '📷' };

/** Why a project may have gone quiet, only from what SETENA itself says: its last entry mentions a resignation or the
 *  closing, or the progress is at 100%. (A hint to decide whether to archive it; nothing is changed.) */
function whyQuiet(b: Project): string {
  const last = timelineOf(b).find(x => x.kind === 'setena')?.text ?? '';
  if (/renuncia/i.test(last)) return 'renuncia';
  if (/cierre|cerrar la bit[aá]cora|proyecto conclu/i.test(last)) return 'cierre';
  if (b.setena?.avance === 100) return 'avance 100%';
  return '';
}

export function SetenaFeed({ d }: { d: AppData }) {
  const today = todayISO();
  const [all, setAll] = useState(false);
  const { items, readAt, quiet } = useMemo(() => {
    const from = addDays(today, -DAYS);
    const items: { b: Project; x: TlItem }[] = [];
    let readAt = '';
    for (const b of d.projects) {
      if (b.archived) continue;
      if (b.setena?.readAt && b.setena.readAt > readAt) readAt = b.setena.readAt;
      // only what SETENA itself shows: its entries and the PDFs downloaded from it (not tasks ticked in the app)
      for (const x of timelineOf(b)) if (x.exact && (x.kind === 'setena' || (ICON[x.kind] && (x.tag?.startsWith('PDF') || x.title.startsWith('📷')))) && x.date >= from && x.date <= today) items.push({ b, x });
    }
    items.sort((a, c) => c.x.date.localeCompare(a.x.date) || a.b.code.localeCompare(c.b.code));
    return { items, readAt, quiet: quietInSetena(d, today) };
  }, [d, today]);
  if (!readAt && !items.length) return null; // never read from SETENA: nothing to show yet
  const projects = new Set(items.map(i => i.b.id)).size;
  const shown = all ? items : items.slice(0, 6);
  const open = (b: Project) => openEditor(d.projects.find(x => x.id === b.id) ?? b, undefined, 'timeline');

  return (
    <section className="sf">
      <div className="sf-h">
        <h3>🌐 En SETENA <small>últimos {DAYS} días</small></h3>
        <span className="sf-sum"><b>{items.length}</b> anotaciones en <b>{projects}</b> proyecto{projects === 1 ? '' : 's'}</span>
        <span className="grow" />
        {readAt && <span className="muted sf-read" title={`Leído de SETENA el ${readAt.slice(0, 10)}`}>leído {agoText(readAt.slice(0, 10), today)}</span>}
        <button type="button" className="btn sm" title="Abre SETENA y trae lo nuevo (no cambia nada en SETENA)" onClick={() => backend.setenaOpen().catch(e => toast(String(e)))}>📥 Actualizar</button>
      </div>
      {shown.length > 0 ? (
        <div className="sf-list">
          {shown.map(({ b, x }, i) => (
            <button type="button" key={i} className={`sf-item k-${x.kind}`} onClick={() => open(b)} title="Ver la línea de tiempo del proyecto">
              <span className="sf-date">{shortDate(x.date)}</span>
              <span className="sf-ic">{ICON[x.kind]}</span>
              <span className="sf-code mono">{b.code}</span>
              <span className="sf-txt"><b>{x.kind === 'setena' ? (x.text ?? '').split('\n')[0] : x.title.replace(/^📷 /, '')}</b></span>
            </button>
          ))}
          {items.length > 6 && <button type="button" className="dp-link sf-more" onClick={() => setAll(v => !v)}>{all ? 'Ver menos' : `Ver las ${items.length} anotaciones`}</button>}
        </div>
      ) : <p className="muted sf-empty">Nada nuevo en SETENA en los últimos {DAYS} días.</p>}
      {quiet.length > 0 && (
        <div className="sf-quiet">
          <span>⏳ <b>{quiet.length}</b> abierta{quiet.length === 1 ? '' : 's'} sin anotar hace más de un mes:</span>
          {quiet.slice(0, 14).map(({ b, last }) => (
            <button type="button" key={b.id} className="sf-chip" onClick={() => open(b)} title={`${b.name} · ${last ? 'última anotación ' + shortDate(last) + ' ' + last.slice(0, 4) : 'sin anotaciones'}${whyQuiet(b) ? ' · ' + whyQuiet(b) : ''}`}>
              <span className="mono">{b.code}</span> <small>{last ? agoText(last, today).replace('hace ', '') : 'nunca'}</small>
              {whyQuiet(b) && <em className="sf-why">{whyQuiet(b)}</em>}
            </button>
          ))}
          {quiet.length > 14 && <small className="muted">y {quiet.length - 14} más (📊 Informe)</small>}
        </div>
      )}
    </section>
  );
}
