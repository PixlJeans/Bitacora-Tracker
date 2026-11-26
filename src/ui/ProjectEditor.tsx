// ===== Create / edit project dialog (consistent with the Cognose editor) =====
// The user only sets code + project, opening date, status, progress and location.
// Delivery dates are calculated from the opening date; each one can then be adjusted in the calendar.
import { useState } from 'react';
import type { Project, Status, ProjectLocation } from '../lib/types';
import { STATUSES, isActiveProject, isFinished } from '../lib/types';
import { codeExists, getData, mutate, labelForStatus, archive, useAppData } from '../lib/store';
import { normalizeCode, isValidCode } from '../lib/parser';
import { trackingStart, regenciaDueDates, regenciaDue, openingFrom } from '../lib/schedule';
import { mapLink, parseCoordinates } from '../lib/geo';
import { gpsComun } from '../lib/exif';
import { backend } from '../lib/backend';
import { shortDate, longDate, fromISO, addMonths, todayISO, uid } from '../lib/dates';
import { ProjectCalendar } from './ProjectCalendar';
import { ProjectLog } from './ProjectLog';
import { Ic, openModal, closeModal, confirmDialog, toast } from './core';
import { openSettings } from './Settings';

/** Deletes a project (with confirmation). Can be undone with Ctrl+Z or «Deshacer».
 *  Photos and PDFs are not deleted from disk: they stay in the project folder, to be safe. */
export async function deleteProject(b: Project): Promise<boolean> {
  const photos = b.entries.reduce((n, a) => n + a.attachments.length, 0);
  const ok = await confirmDialog({
    title: '¿Eliminar este proyecto?',
    text: `${b.code} → ${b.name}. Se borra de la lista con sus entregas, cartas y anotaciones${photos ? ` (sus ${photos} archivo(s) se quedan en la carpeta del proyecto)` : ''}. Si solo terminó, mejor archívalo.`,
    ok: 'Eliminar', danger: true, icon: '🗑️'
  });
  if (!ok) return false;
  mutate(dd => {
    dd.projects = dd.projects.filter(x => x.id !== b.id);
    dd.snoozed = dd.snoozed.filter(p => p.ref !== b.id);
  });
  toast(`🗑️ ${b.code} eliminado`, true);
  return true;
}

export function openEditor(b?: Project, initial?: Partial<Project>, initialTab: 'details' | 'log' = 'details') {
  openModal(<ProjectEditor b={b} initial={initial} initialTab={initialTab} />, 'create-modal editor');
}

function ProjectEditor({ b, initial: initial, initialTab: initialTab }: { b?: Project; initial?: Partial<Project>; initialTab: 'details' | 'log' }) {
  const [tab, setTab] = useState(initialTab);
  const d = useAppData();
  // Deliveries, steps, log entries and photos are saved immediately: always read from the live data
  const live = b ? d.projects.find(x => x.id === b.id) : undefined;
  const [locTouched, setLocTouched] = useState(false);
  const today = todayISO();
  const [f, setF] = useState<Project>(() => b ? structuredClone(b) : {
    id: uid(), code: '', name: '', status: 'new', labelId: labelForStatus('new'), openedOn: today, notes: '',
    uploads: [], visits: [], regencias: [], entries: [], archived: false, archivedOn: null, lastUpdated: null, createdOn: today, ...initial
  });
  const [err, setErr] = useState('');
  const set = <K extends keyof Project>(k: K, v: Project[K]) => setF(x => ({ ...x, [k]: v }));
  const view: Project = live ? {
    ...f, uploads: live.uploads, visits: live.visits, regencias: live.regencias, deliveries: live.deliveries,
    entries: live.entries, location: locTouched ? f.location : live.location
  } : f;
  const setLoc = (u: ProjectLocation | null) => { setLocTouched(true); set('location', u); };

  const day = fromISO(f.openedOn).getDate();
  const regencias = regenciaDueDates(view, trackingStart(view), addMonths(today, 13)).slice(0, 3);

  function save() {
    const code = normalizeCode(f.code);
    const name = f.name.trim().replace(/\s+/g, ' ');
    if (!code) return setErr('Falta el número de bitácora.');
    if (!isValidCode(code)) return setErr('El número debe tener el formato D1-XXXX-AAAA (ej. D1-0170-2020).');
    if (!name) return setErr('Falta el nombre del proyecto: el número siempre va ligado a un proyecto.');
    if (!f.openedOn) return setErr('Falta la fecha de apertura.');
    if (codeExists(code, f.id)) return setErr(`Ya existe una bitácora con el número ${code}.`);
    // Log entries are saved right away in the «Bitácora» tab: don't overwrite them with the form's copy
    const current = getData().projects.find(x => x.id === f.id);
    const result: Project = current ? {
      ...f, code: code, name: name, entries: current.entries, uploads: current.uploads, visits: current.visits,
      regencias: current.regencias, deliveries: current.deliveries, location: locTouched ? f.location ?? null : current.location ?? null
    } : { ...f, code: code, name: name };
    mutate(dd => {
      const i = dd.projects.findIndex(x => x.id === f.id);
      if (i >= 0) dd.projects[i] = result; else dd.projects.push(result);
    });
    closeModal();
    toast(b ? `Bitácora ${code} actualizada` : `Bitácora ${code} creada`, true);
  }

  async function remove() {
    if (!b) return;
    if (!(await deleteProject(b))) openEditor(b);
  }

  return (
    <form onSubmit={e => { e.preventDefault(); save(); }}>
      <div className="ed-top">
        <h2>{b ? <><span className="mono">{b.code}</span> {b.name}</> : '🌿 Nueva bitácora'}</h2>
        {b && (
          <div className="ed-tabs" role="tablist">
            <button type="button" role="tab" className={tab === 'details' ? 'on' : ''} onClick={() => setTab('details')}>📋 Entregas</button>
            <button type="button" role="tab" className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>
              📷 Notas{b.entries.some(a => !a.uploaded) ? <b className="tab-badge">{b.entries.filter(a => !a.uploaded).length}</b> : null}</button>
          </div>
        )}
      </div>
      {tab === 'log' && b ? <ProjectLog id={b.id} /> : <>
      <div className="ed-row">
        <div className="ed-f code">
          <label className="modal-label" htmlFor="ed_num">Número</label>
          <input id="ed_num" className="modal-input mono" placeholder="D1-0170-2020" value={f.code} autoFocus={!b}
            onChange={e => { set('code', e.target.value.toUpperCase()); setErr(''); }}
            onBlur={e => { const n = normalizeCode(e.target.value); if (n) set('code', n); }} />
        </div>
        <div className="ed-f name">
          <label className="modal-label" htmlFor="ed_nom">Nombre del proyecto</label>
          <input id="ed_nom" className="modal-input" placeholder="CONDOMINIO VISTA DEL BOSQUE" value={f.name}
            onChange={e => { set('name', e.target.value); setErr(''); }} />
        </div>
        <div className="ed-f">
          <label className="modal-label" htmlFor="ed_ap">Apertura</label>
          <input id="ed_ap" type="date" className="modal-input" value={f.openedOn} onChange={e => e.target.value && setF(x => ({ ...x, openedOn: e.target.value, noOpeningDate: false }))} />
        </div>
        <div className="ed-f">
          <label className="modal-label" htmlFor="ed_st">Estado</label>
          <select id="ed_st" className={`modal-input status-${f.status}`} value={f.status} onChange={e => set('status', e.target.value as Status)}>
            {STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {isActiveProject(f) && f.noOpeningDate && <MissingOpening f={f} onSet={o => {
        setF(x => ({ ...x, openedOn: o, noOpeningDate: false }));
        if (b) mutate(dd => { const x = dd.projects.find(y => y.id === b.id); if (x) { x.openedOn = o; x.noOpeningDate = false; } });
        toast(`📅 ${f.code}: apertura ${longDate(o)}; entregas calculadas`, true);
      }} />}
      {isActiveProject(f) && f.noOpeningDate ? null : isActiveProject(f)
        ? <p className="ed-auto-line muted">📅 Informe Regencial el día <b>{day}</b> de cada mes · Regencia cada 6 meses{regencias.length ? ` (próxima ${shortDate(regenciaDue(view, regencias.find(v => !view.regencias.includes(v)) ?? regencias[0]))})` : ''} · ✏️ cada fecha se puede cambiar</p>
        : <p className="ed-auto-line muted">{f.archived ? 'Archivada: sin entregas.' : 'Ya terminó: no genera entregas. Ciérrala con 📦 Archivar.'}</p>}

      <ProjectCalendar b={view} live={!!live} onChange={c => setF(x => ({ ...x, ...c }))} />

      <details className="ed-more">
        <summary>Más datos · avance, ubicación y notas</summary>
        <div className="ed-more-grid">
          <div>
            <label className="modal-label">Avance
              <button type="button" className="dp-link inline" onClick={() => { closeModal(); openSettings('colors'); }}>editar</button>
            </label>
            <div className="chip-pick">
              {d.labels.map(e => (
                <button type="button" key={e.id} className={`echip ${f.labelId === e.id ? 'on' : ''}`} style={{ ['--ec' as any]: e.color }}
                  onClick={() => set('labelId', e.id)}><span className="dot" />{e.name}</button>
              ))}
            </div>
            <label className="modal-label" htmlFor="ed_notas">Notas</label>
            <textarea id="ed_notas" className="modal-input" rows={2} value={f.notes} placeholder="Regente, consultor, observaciones…"
              onChange={e => set('notes', e.target.value)} />
          </div>
          <div><LocationField b={view} onChange={setLoc} /></div>
        </div>
      </details>
      </>}

      <p className="ed-error" role="alert">{err}</p>
      <div className="modal-btns">
        {b && <button type="button" className="modal-btn cancel danger-text" onClick={remove}><Ic n="trash" size={14} /> Eliminar</button>}
        {b && (isFinished(b.status) || b.archived) && <button type="button" className="modal-btn cancel" onClick={() => { closeModal(); archive(b.id, !b.archived); toast(b.archived ? `${b.code} restaurada` : `📦 ${b.code} archivada`, true); }}>
          {b.archived ? '↑ Restaurar' : '📦 Archivar'}</button>}
        <span className="grow" />
        <button type="button" className="modal-btn cancel" onClick={closeModal}>Cancelar</button>
        <button type="submit" className="modal-btn ok">{b ? 'Guardar' : 'Crear bitácora'}</button>
      </div>
    </form>
  );
}

/** Project location: paste coordinates or a Google Maps link, or take it from the photos' GPS. */
function LocationField({ b, onChange }: { b: Project; onChange: (u: ProjectLocation | null) => void }) {
  const u = b.location ?? null;
  const [txt, setTxt] = useState('');
  const [err, setErr] = useState('');
  const gpsPhotos = b.entries.flatMap(a => a.attachments).filter(f => f.lat != null && f.lng != null);
  const fromPhotos = gpsComun(gpsPhotos.map(f => ({ date: null, time: null, lat: f.lat!, lng: f.lng! })));
  const paste = (v: string) => {
    setTxt(v); setErr('');
    if (!v.trim()) return;
    const p = parseCoordinates(v);
    if (p) { onChange({ lat: p.lat, lng: p.lng, text: u?.text ?? '', source: 'manual' }); setTxt(''); }
    else if (v.trim().length > 6) setErr('No encontré coordenadas. Pega «9.9325, -84.0795» o el enlace de Google Maps (Compartir → Copiar enlace, abierto en el navegador).');
  };
  return (
    <div className="loc">
      <label className="modal-label">📍 Ubicación del proyecto <small className="muted">(para agrupar visitas cercanas el mismo día)</small></label>
      {u ? (
        <div className="loc-row">
          <span className="loc-coord mono">{u.lat.toFixed(5)}, {u.lng.toFixed(5)}</span>
          <small className="muted">{u.source === 'photo' ? 'del GPS de las fotos' : 'puesta a mano'}</small>
          <button type="button" className="dp-link" onClick={() => backend.openMap(mapLink(u)).catch(e => toast(String(e)))}>Ver en el mapa</button>
          <button type="button" className="dp-link danger" onClick={() => onChange(null)}>Quitar</button>
        </div>
      ) : <p className="muted sm">Sin ubicación. Pégala abajo, o se toma sola del GPS de las primeras fotos con ubicación.</p>}
      <div className="loc-row">
        <input className="modal-input" placeholder={u ? 'Cambiar: pega coordenadas o enlace de Google Maps' : 'Pega coordenadas (9.9325, -84.0795) o enlace de Google Maps'} value={txt}
          onChange={e => paste(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }} />
        {fromPhotos && (!u || u.source !== 'photo') && <button type="button" className="btn sm" onClick={() => onChange({ ...fromPhotos, text: u?.text ?? '', source: 'photo' })}>Usar GPS de las fotos ({gpsPhotos.length})</button>}
      </div>
      {u && <input className="modal-input" placeholder="Dirección o referencia (opcional): 200 m norte de la iglesia de…" value={u.text}
        onChange={e => onChange({ ...u, text: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }} />}
      {err && <p className="ed-hint warn">{err}</p>}
    </div>
  );
}

/** Box for projects whose opening date is unknown: set it directly, or work it out from the
 *  next Informe Regencial (gives the day of the month) and the next Regencia (gives the months). */
function MissingOpening({ f, onSet }: { f: Project; onSet: (opening: string) => void }) {
  const [opening, setOpening] = useState('');
  const [inf, setInf] = useState('');
  const [reg, setReg] = useState('');
  const calc = inf && reg ? openingFrom(inf, reg, f.code) : '';
  return (
    <div className="ed-missing">
      <b>📅 Falta la fecha de apertura</b> <span className="muted">— no venía en el PDF. Sin ella no se calculan el informe ni la regencia.</span>
      <div className="ed-missing-row">
        <label>Apertura <input type="date" className="modal-input sm" value={opening} onChange={e => setOpening(e.target.value)} /></label>
        <button type="button" className="btn sm primary" disabled={!opening} onClick={() => onSet(opening)}>Usar</button>
        <span className="muted">o si no la sabes:</span>
        <label>Próximo informe <input type="date" className="modal-input sm" value={inf} onChange={e => setInf(e.target.value)} /></label>
        <label>Próxima regencia <input type="date" className="modal-input sm" value={reg} onChange={e => setReg(e.target.value)} /></label>
        <button type="button" className="btn sm primary" disabled={!calc} onClick={() => onSet(calc)} title={calc ? `Apertura calculada: ${longDate(calc)}` : ''}>Calcular</button>
        <button type="button" className="dp-link" onClick={() => onSet(f.openedOn)}>La de arriba ({shortDate(f.openedOn)}) es correcta</button>
      </div>
    </div>
  );
}
