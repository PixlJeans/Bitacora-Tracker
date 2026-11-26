// ===== Create / edit project dialog (consistent with the Cognose editor) =====
// The user only sets code + project, opening date, status, progress and location.
// Delivery dates are calculated from the opening date; each one can then be adjusted in the calendar.
import { useState } from 'react';
import { Timeline } from './Timeline';
import type { Project, Status, ProjectLocation } from '../lib/types';
import { STATUSES, isActiveProject, isFinished } from '../lib/types';
import { codeExists, getData, mutate, labelForStatus, archive, useAppData, markAllBefore } from '../lib/store';
import { normalizeCode, isValidCode } from '../lib/parser';
import { nextRegencia, openingFrom, pendingBefore, monthsSinceOpening, dueInMonth } from '../lib/schedule';
import { mapLink, parseCoordinates } from '../lib/geo';
import { gpsComun } from '../lib/exif';
import { backend } from '../lib/backend';
import { shortDate, longDate, fromISO, todayISO, uid, monthName, monthNameOf, addMonths } from '../lib/dates';
import { ProjectCalendar } from './ProjectCalendar';
import { projectFolder } from '../lib/folders';
import { agoText, daysSince } from '../lib/setenaInfo';
import { MonthNote } from './Delivery';
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

type Tab = 'details' | 'timeline' | 'log' | 'notes' | 'location';

export function openEditor(b?: Project, initial?: Partial<Project>, initialTab: Tab = 'details') {
  openModal(<ProjectEditor b={b} initial={initial} initialTab={initialTab} />, 'create-modal editor');
}

function ProjectEditor({ b, initial: initial, initialTab: initialTab }: { b?: Project; initial?: Partial<Project>; initialTab: Tab }) {
  const [tab, setTab] = useState(initialTab);
  const [editFields, setEditFields] = useState(false);
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
  const nextReg = nextRegencia(view, today);
  const monthStart = `${today.slice(0, 7)}-01`;
  const behind = live ? pendingBefore(live, monthStart).length : 0;
  const [askCatchUp, setAskCatchUp] = useState(false);
  function catchUp() {
    if (!b) return;
    const n = markAllBefore([b.id], monthStart);
    setAskCatchUp(false);
    toast(`✓ ${b.code}: ${n} marcadas como hechas, cada una con su fecha`, true);
  }

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
        {b && <button type="button" className="dp-link" title={view.setenaUrl ? 'Abrir la bitácora de este proyecto en SETENA (en tu navegador)' : 'Abrir tus bitácoras en SETENA (en tu navegador). La página de cada proyecto se guarda con «Descargar todo de SETENA».'}
          // in the normal browser: its login (with reCAPTCHA) works and stays open between projects
          onClick={() => backend.openMap(view.setenaUrl ?? 'https://bitacora.setena.go.cr/BitacoraDigital/CargarBitacorasGrid?tipoConsulta=1').catch(e => toast(String(e)))}>🌐 Abrir en SETENA</button>}
        {b && <button type="button" className="dp-link" title={`Abrir ${projectFolder(b)}`} onClick={() => backend.openSubfolder(projectFolder(b)).catch(e => toast(String(e)))}>📂 Carpeta</button>}
        {b && (
          <div className="ed-tabs" role="tablist">
            <button type="button" role="tab" className={tab === 'details' ? 'on' : ''} onClick={() => setTab('details')}>📋 Entregas</button>
            <button type="button" role="tab" className={tab === 'timeline' ? 'on' : ''} onClick={() => setTab('timeline')}>🕘 Línea de tiempo</button>
            <button type="button" role="tab" className={tab === 'notes' || tab === 'log' ? 'on' : ''} onClick={() => setTab('notes')}>📝 Notas</button>
            <button type="button" role="tab" className={tab === 'location' ? 'on' : ''} onClick={() => setTab('location')}>📍 Ubicación{view.location ? '' : <b className="tab-badge">!</b>}</button>
          </div>
        )}
      </div>
      {b && tab === 'timeline' ? <Timeline b={view} />
        : b && (tab === 'notes' || tab === 'log') ? <MonthNotes b={view} f={f} setNotes={v => set('notes', v)} />
        : b && tab === 'location' ? <div className="ed-location"><LocationField b={view} onChange={setLoc} /></div> : <>
      {b && !editFields && (
        <div className="ed-summary">
          <span className={`status-chip status-${f.status}`}>{STATUSES.find(x => x.id === f.status)?.name}</span>
          <span>Apertura <b>{f.noOpeningDate ? '—' : longDate(f.openedOn)}</b></span>
          {isActiveProject(f) && !f.noOpeningDate && <span className="muted">· tareas el día {day} de cada mes{nextReg ? ` · regencia ${shortDate(nextReg.due)}` : ''}</span>}
          {f.setenaStart && f.setenaStart !== f.openedOn && (
            <span className="setena-start" title="Fecha de la primera anotación en la bitácora de SETENA (al final de su página)">
              SETENA: inicio <b>{shortDate(f.setenaStart)} {f.setenaStart.slice(2, 4)}</b>{' '}
              <button type="button" className="dp-link" onClick={() => {
                const o = f.setenaStart!;
                setF(x => ({ ...x, openedOn: o, noOpeningDate: false }));
                mutate(dd => { const x = dd.projects.find(y => y.id === b.id); if (x) { x.openedOn = o; x.noOpeningDate = false; } });
                toast(`📅 ${f.code}: apertura ${longDate(o)}`, true);
              }}>usar esta fecha</button>
            </span>
          )}
          <span className="grow" />
          <button type="button" className="dp-link" onClick={() => setEditFields(true)}>✏️ Editar datos</button>
        </div>
      )}
      {b && !editFields && view.setena && <SetenaLine b={view} />}
      {(!b || editFields) && <div className="ed-row">
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
      </div>}

      {isActiveProject(f) && f.noOpeningDate && <MissingOpening f={f} onSet={o => {
        setF(x => ({ ...x, openedOn: o, noOpeningDate: false }));
        if (b) mutate(dd => { const x = dd.projects.find(y => y.id === b.id); if (x) { x.openedOn = o; x.noOpeningDate = false; } });
        toast(`📅 ${f.code}: apertura ${longDate(o)}; entregas calculadas`, true);
      }} />}
      {isActiveProject(f) && f.noOpeningDate ? null : isActiveProject(f)
        ? <div className="ed-auto-line muted">{!b && <>📅 Inspección y bitácora el día <b>{day}</b> de cada mes · Regencia cada 6 meses</>}
            {b && live && <><button type="button" className="dp-link" title="Ir al mes de inicio (carta de Inicio de obras)" onClick={() => window.dispatchEvent(new CustomEvent('bt-goto-month', { detail: view.openedOn.slice(0, 7) }))}>🏗️ Inicio de obras{live.deliveries?.['s:start']?.uploaded ? ' ✓' : ''}</button></>}
            {b && live && behind > 0 && (askCatchUp
              ? <span className="catch-up">¿Marcar como hechas las {behind} tareas anteriores a {monthName(fromISO(today)).toLowerCase()}? <button type="button" className="btn sm primary" onClick={catchUp}>Sí, marcar</button> <button type="button" className="dp-link" onClick={() => setAskCatchUp(false)}>no</button></span>
              : <button type="button" className="dp-link catch-up" onClick={() => setAskCatchUp(true)}>✓ Marcar todo lo anterior a {monthName(fromISO(today)).toLowerCase()} como hecho ({behind})</button>)}</div>
        : <p className="ed-auto-line muted">{f.archived ? 'Archivada: sin entregas.' : 'Ya terminó: no genera entregas. Ciérrala con 📦 Archivar.'}</p>}

      <ProjectCalendar b={view} live={!!live} onChange={c => setF(x => ({ ...x, ...c }))} />

      <details className="ed-more">
        <summary>Más datos · avance</summary>
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
          </div>
          {!b && <div><LocationField b={view} onChange={setLoc} /></div>}
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
          <small className="muted">{u.source === 'photo' ? 'del GPS de las fotos' : u.source === 'regencia' ? `de las coordenadas de su regencia${u.text ? ` (${u.text})` : ''}` : 'puesta a mano'}</small>
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

/** Notes by month: one box per month (newest first), the same notes shown in each month of «Entregas». */
function MonthNotes({ b, f, setNotes }: { b: Project; f: Project; setNotes: (v: string) => void }) {
  const today = todayISO();
  const months = monthsSinceOpening(b, addMonths(today, 1)).filter(mk => dueInMonth(b, mk)).reverse();
  const [all, setAll] = useState(false);
  const withText = (mk: string) => !!b.deliveries?.[`m:${mk}`]?.notes;
  const shown = all ? months : months.filter((mk, i) => i < 3 || withText(mk));
  const oldLog = b.entries.filter(e => e.text.trim());
  return (
    <div className="month-notes">
      {!months.length && <p className="muted">Las notas por mes aparecen cuando el proyecto tiene fecha de apertura.</p>}
      {shown.map(mk => (
        <div key={mk} className="mn-row">
          <b className="mn-month">{monthNameOf(mk)}</b>
          <MonthNote b={b} itemKey={`m:${mk}`} rows={2} placeholder="Notas de este mes…" />
        </div>
      ))}
      {!all && months.length > shown.length && <button type="button" className="dp-link" onClick={() => setAll(true)}>Ver todos los meses ({months.length})</button>}
      {(f.notes || oldLog.length > 0) && (
        <details className="ed-more" open={!!f.notes}>
          <summary>Notas generales de antes</summary>
          <textarea className="modal-input" rows={3} value={f.notes} onChange={e => setNotes(e.target.value)} />
          {oldLog.map(e => <p key={e.id} className="mn-old"><b>{shortDate(e.date)}</b> {e.text}</p>)}
        </details>
      )}
    </div>
  );
}

/** One line with what SETENA's page says: progress, newest entry, entries, people. */
function SetenaLine({ b }: { b: Project }) {
  const s = b.setena!;
  const today = todayISO();
  const old = s.lastEntry ? daysSince(s.lastEntry, today) > 35 : true;
  const left = s.people.filter(p => /renuncia/i.test(p)).map(p => p.replace(/\s*\(.*$/, ''));
  return (
    <div className="setena-line" title={`Leído de SETENA el ${s.readAt.slice(0, 10)}${s.people.length ? ` · Participantes: ${s.people.join(', ')}` : ''}`}>
      <b>🌐 SETENA</b>
      {s.avance !== null && <span className="sl-avance"><span className="sl-bar"><i style={{ width: `${s.avance}%` }} /></span> avance {s.avance}%</span>}
      {s.lastEntry ? <span className={old && b.status === 'open' && !s.participationClosed ? 'red-t' : ''}>última anotación {shortDate(s.lastEntry)} {s.lastEntry.slice(2, 4)} · {agoText(s.lastEntry, today)}</span>
        : <span className="muted">sin anotaciones{s.approvedOn ? ` · aprobada el ${shortDate(s.approvedOn)} ${s.approvedOn.slice(2, 4)}` : ''}</span>}
      <span className="muted">{s.entries} anotaciones</span>
      {s.participationClosed && <span className="sr-chip">participación cerrada</span>}
      {s.others.length > 0 && <span className="muted">también escriben: {s.others.join(', ')}</span>}
      {left.length > 0 && <span className="muted">renunció: {left.join(', ')}</span>}
    </div>
  );
}
