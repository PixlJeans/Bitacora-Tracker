// ===== Bitácora Tracker: main screen =====
// Inverted structure: the project LIST is the main thing and each project carries its own
// delivery calendar. Tabs: Activas · Agenda y rutas · Mes actual · Mes próximo · Regencias · Archivadas.
// Same architecture as the Cognose calendar: single store → views that only render → shared dialogs.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAppData, isReady, Undo, mutate, reload } from './lib/store';
import type { Project, Status } from './lib/types';
import { isActiveProject, isFinished } from './lib/types';
import { completeIn, nextDue, upcomingRegencias, summary, monthTasks, type RegenciaInfo, sortDate } from './lib/schedule';
import { matches } from './lib/search';
import { monthKeyOf, monthNameOf, todayISO } from './lib/dates';
import { ReminderCards } from './ui/ReminderCards';
import { SettingsPanel, applyAppearance, toggleSettings } from './ui/Settings';
import { Ic, ModalHost, ToastHost, hasModal, toast } from './ui/core';
import { openEditor } from './ui/ProjectEditor';
import { openImport, pausedImport } from './ui/Import';
import { RowHeader, ProjectRow, type Mode } from './ui/ProjectRow';
import { openReview } from './ui/Review';
import { Tutorial, openTutorial } from './ui/Tutorial';
import { Help } from './ui/Help';
import { Agenda } from './ui/Agenda';
import { listenToPhone } from './ui/ProjectLog';
import { backend, esWeb } from './lib/backend';
import { toCsv } from './lib/csv';

type View = 'active' | 'agenda' | 'month' | 'nextMonth' | 'regencias' | 'archive';
type SortOrder = 'nextDue' | 'code' | 'name' | 'openedOn';
type StatusFilter = 'all' | Status | 'overdue';

const LS_VIEW = 'bt_vista';

export default function App() {
  const d = useAppData();
  const [view, setViewRaw] = useState<View>(() => { try { const v = localStorage.getItem(LS_VIEW) as View; return ['active', 'agenda', 'month', 'nextMonth', 'regencias', 'archive'].includes(v) ? v : 'active'; } catch { return 'active'; } });
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const [sortOrder, setSortOrderRaw] = useState<SortOrder>(() => { try { const o = localStorage.getItem('bt_orden') as SortOrder; return ['nextDue', 'code', 'name', 'openedOn'].includes(o) ? o : 'nextDue'; } catch { return 'nextDue'; } });
  const setSortOrder = (o: SortOrder) => { setSortOrderRaw(o); try { localStorage.setItem('bt_orden', o); } catch { /* opcional */ } };
  const [q, setQ] = useState('');
  const [dropAll, setDropAll] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const setView = (v: View) => { setViewRaw(v); setQ(''); try { localStorage.setItem(LS_VIEW, v); } catch { /* opcional */ } };

  useEffect(() => { applyAppearance(d.settings); }, [d.settings]);
  // «System» theme: follow Windows or macOS light/dark live
  useEffect(() => {
    if (d.settings.theme !== 'system' || !window.matchMedia) return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const f = () => applyAppearance(d.settings);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, [d.settings]);
  // Web: changes from other people / devices, conflicts and expired session
  useEffect(() => {
    if (!esWeb) return;
    const remoto = () => { if (!hasModal()) reload().then(() => toast('🔄 Se actualizaron los datos (cambios desde otro dispositivo)')).catch(() => { /* sin red */ }); };
    const conflict = () => reload().then(() => toast('⚠️ Otra persona guardó cambios al mismo tiempo. Se cargó su versión: repite tu último cambio.')).catch(() => { /* sin red */ });
    const session = () => location.reload();
    window.addEventListener('bt:remote', remoto); window.addEventListener('bt:conflict', conflict); window.addEventListener('bt:session', session);
    return () => { window.removeEventListener('bt:remote', remoto); window.removeEventListener('bt:conflict', conflict); window.removeEventListener('bt:session', session); };
  }, []);
  // Photos and notes arriving from the phone
  useEffect(() => { listenToPhone(); }, []);
  // The phone page needs the list of active projects to choose where the photos go
  const phoneList = useMemo(() => JSON.stringify(d.projects.filter(b => isActiveProject(b)).map(b => ({ code: b.code, name: b.name }))), [d.projects]);
  useEffect(() => { backend.phoneProjects(phoneList).catch(() => { /* sin servidor del celular */ }); }, [phoneList]);
  useEffect(() => { if (!d.settings.tutorialSeen) { const t = setTimeout(openTutorial, 700); return () => clearTimeout(t); } }, [d.settings.tutorialSeen]);
  useEffect(() => {
    const f = (e: Event) => {
      const v = String((e as CustomEvent).detail);
      const views: View[] = ['active', 'agenda', 'month', 'nextMonth', 'regencias', 'archive'];
      setView(views.includes(v as View) ? v as View : 'active'); setFilter('all'); setLabelFilter(null);
    };
    window.addEventListener('bt:view', f);
    return () => window.removeEventListener('bt:view', f);
  }, []);

  const TABS: { id: View; txt: string; keyName: string }[] = [
    { id: 'active', txt: 'Activas', keyName: '1' }, { id: 'agenda', txt: 'Agenda y rutas', keyName: '2' },
    { id: 'month', txt: 'Mes actual', keyName: '3' }, { id: 'nextMonth', txt: 'Mes próximo', keyName: '4' },
    { id: 'regencias', txt: 'Regencias', keyName: '5' }, { id: 'archive', txt: 'Archivadas', keyName: '6' }
  ];

  useEffect(() => {
    const k = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && !(ev.target as HTMLElement).closest('input,textarea')) {
        ev.preventDefault(); if (Undo.pop()) toast('Deshecho'); return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'f') { ev.preventDefault(); searchRef.current?.focus(); return; }
      if (ev.ctrlKey || ev.metaKey || ev.altKey || hasModal() || document.querySelector('.tour')) return;
      if ((ev.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) { if (ev.key === 'Escape') (ev.target as HTMLElement).blur(); return; }
      const t = TABS.find(x => x.keyName === ev.key);
      if (t) { ev.preventDefault(); setView(t.id); return; }
      const act: Record<string, () => void> = { n: () => openEditor(), i: () => openImport(), r: () => openReview(), '/': () => searchRef.current?.focus(), ',': toggleSettings };
      const fn = act[ev.key.toLowerCase()];
      if (fn) { ev.preventDefault(); fn(); }
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, []); // eslint-disable-line

  const today = todayISO(), mk = today.slice(0, 7);
  const now = new Date();
  const nextMk = monthKeyOf(new Date(now.getFullYear(), now.getMonth() + 1, 1, 12));
  const r = summary(d);
  const paused = pausedImport(d);
  const searching = q.trim().length > 0;
  const activeProjects = useMemo(() => d.projects.filter(b => !b.archived), [d]);
  const regencias = useMemo(() => upcomingRegencias(d), [d]);

  // Search: ALWAYS across every project (active and archived), with no hidden filters
  const results = useMemo(() => searching ? d.projects.filter(b => matches(d, b, q)) : [], [d, q, searching]);

  const activeList = useMemo(() => {
    // Priority = DATE of the most urgent pending delivery (Informe Regencial or Regencia): overdue first
    const pf = new Map(activeProjects.map(b => [b.id, nextDue(b)]));
    const prox = (b: Project) => { const x = pf.get(b.id); return x ? sortDate(x) : '9999'; };
    const l = activeProjects.filter(b =>
      (filter === 'all' || (filter === 'overdue' ? !!pf.get(b.id)?.overdue : b.status === filter)) && (!labelFilter || b.labelId === labelFilter));
    const cmp: Record<SortOrder, (a: Project, b: Project) => number> = {
      nextDue: (a, b) => (isActiveProject(a) ? 0 : 1) - (isActiveProject(b) ? 0 : 1) || prox(a).localeCompare(prox(b)) || a.code.localeCompare(b.code),
      code: (a, b) => a.code.localeCompare(b.code),
      name: (a, b) => a.name.localeCompare(b.name),
      openedOn: (a, b) => a.openedOn.localeCompare(b.openedOn)
    };
    return [...l].sort(cmp[sortOrder]);
  }, [d, activeProjects, filter, labelFilter, sortOrder]);

  const archiveFinished = () => {
    const n = d.projects.filter(b => !b.archived && isFinished(b.status)).length;
    mutate(dd => { dd.projects.forEach(b => { if (!b.archived && isFinished(b.status)) { b.archived = true; b.archivedOn = todayISO(); } }); });
    toast(`📦 ${n} proyecto(s) archivados (siguen en la pestaña Archivadas)`, true);
  };

  if (!isReady()) return <div className="loading">Cargando…</div>;

  const chip = (id: StatusFilter, txt: string, n: number, cls = '') => (
    <button className={`fchip ${cls} ${filter === id ? 'on' : ''}`} onClick={() => setFilter(f => (f === id ? 'all' : id))}>{txt}<b>{n}</b></button>
  );
  const emptyData = (txt: string) => <div className="empty-list"><p>{txt}</p></div>;
  let tourMarked = false;
  const P = (b: Project, mode?: Mode) => {
    const data = !tourMarked ? 'project' : undefined; tourMarked = true;
    return <ProjectRow key={b.id + (mode?.type ?? '')} d={d} b={b} mode={mode} data={data} />;
  };

  let body: ReactNode;
  if (searching) {
    body = <>
      <div className="info-bar searching"><Ic n="search" /> {results.length} resultado{results.length === 1 ? '' : 's'} para «{q.trim()}» (activas y archivadas) <button className="dp-link" onClick={() => setQ('')}>Limpiar</button></div>
      {results.length ? <><RowHeader />{results.map(b => P(b))}</> : emptyData('Ninguna bitácora coincide.')}
    </>;
  } else if (view === 'active') {
    body = !d.projects.length ? (
      <div className="empty-list"><div className="empty">
        <div className="empty-ic">🌿</div>
        <h2>Empieza con tu PDF de SETENA</h2>
        <p>Importa el listado; la app extrae número, proyecto y estado.<br />El Informe Regencial mensual y la Regencia cada 6 meses se calculan solos desde la fecha de apertura.</p>
        <div className="row"><button className="btn primary" onClick={() => openImport()}><Ic n="upload" /> Importar PDF</button>
          <button className="btn" onClick={() => openEditor()}><Ic n="plus" /> Crear a mano</button></div>
      </div></div>
    ) : <>
      <div className="filters" data-help-title="Filtros" data-help="Muestra solo un estado (Nuevas, Abiertas…), las vencidas o un color de avance. Clic otra vez para quitar el filtro. La lista se ordena por fecha: lo vencido y lo más próximo arriba.">
        {chip('all', 'Todas', activeProjects.length)}
        {chip('new', 'Nuevas', r.new, 'status-new')}
        {chip('open', 'Abiertas', r.open, 'status-open')}
        {chip('closing', 'Sol. cierre', r.closing, 'status-closing')}
        {chip('finished', 'Terminadas', r.finishedCount, 'status-finished')}
        {chip('overdue', 'Vencidas', activeProjects.filter(b => nextDue(b)?.overdue).length, 'warn')}
        <span className="sep" />
        <span className="color-filter" title="Filtrar por avance">
          {d.labels.map(e => (
            <button key={e.id} className={labelFilter === e.id ? 'on' : ''} style={{ ['--ec' as any]: e.color }} onClick={() => setLabelFilter(x => (x === e.id ? null : e.id))}>
              <i /><span>{e.name}</span><b>{activeProjects.filter(b => b.labelId === e.id).length}</b></button>))}
        </span>
        <select className="sort" value={sortOrder} onChange={e => setSortOrder(e.target.value as SortOrder)} title="Ordenar">
          <option value="nextDue">Prioridad (por fecha)</option>
          <option value="openedOn">Fecha de apertura</option><option value="code">Número</option><option value="name">Proyecto</option>
        </select>
      </div>
      {r.finished > 0 && filter !== 'finished' && filter !== 'closing' && <div className="info-bar soft"><Ic n="download" /> {r.finished} proyecto(s) en Solicitud de Cierre o Terminados siguen en la lista: ya no generan entregas; ciérralos con 📦 (pasan a Archivadas con todo su historial).
        <button className="dp-link" onClick={() => archiveFinished()}>Archivar todos</button></div>}
      {activeList.length ? <><RowHeader />{activeList.map(b => P(b))}</> : emptyData('Ninguna bitácora coincide con el filtro.')}
    </>;
  } else if (view === 'agenda') {
    body = <Agenda d={d} />;
  } else if (view === 'month' || view === 'nextMonth') {
    const m = view === 'month' ? mk : nextMk;
    const t = monthTasks(d, m);
    const doneCount = t.filter(x => completeIn(x.b, m)).length;
    const withRegencia = t.filter(x => x.regencia).length;
    body = <>
      <div className="month-summary">
        <div><b>{t.length}</b><span>informes regenciales en {monthNameOf(m).split(' ')[0].toLowerCase()}</span></div>
        <div className={doneCount === t.length && t.length ? 'ok' : ''}><b>{doneCount}/{t.length}</b><span>completas</span></div>
        <div><b>{withRegencia}</b><span>con Regencia</span></div>
      </div>
      {t.length > 0 && <RowHeader />}
      {t.length ? [...t].sort((a, c) => Number(completeIn(a.b, m)) - Number(completeIn(c.b, m)) || a.date.localeCompare(c.date)).map(x => P(x.b, { type: 'month', mk: m }))
        : emptyData('No hay entregas este mes.')}
    </>;
  } else if (view === 'regencias') {
    const groups: [string, RegenciaInfo[]][] = [['Vencidos', regencias.filter(i => i.status === 'overdue')], ['En aviso (último mes)', regencias.filter(i => i.status === 'dueSoon')], ['Próximos', regencias.filter(i => i.status === 'future')]];
    body = regencias.length ? <>
      <p className="view-note"><Ic n="review" size={14} /> La Regencia vence cada 6 meses desde la fecha de apertura (la fecha se puede ajustar en el proyecto); los avisos empiezan 1 mes antes.</p>
      {groups.filter(([, l]) => l.length).map(([heading, l]) => <section key={heading} className="group"><h4 className="view-h">{heading} <small>{l.length}</small></h4><RowHeader />{l.map(i => P(i.b, { type: 'regencia' }))}</section>)}
    </> : emptyData('No hay Regencias pendientes.');
  } else {
    const archived = d.projects.filter(b => b.archived).sort((a, c) => (c.archivedOn ?? '').localeCompare(a.archivedOn ?? ''));
    body = archived.length ? <>
      <p className="view-note"><Ic n="download" size={14} /> Proyectos cerrados: fuera de la lista y sin recordatorios, pero con todo su historial. Restaura con el botón ↑.</p>
      <RowHeader />{archived.map(b => P(b))}
    </> : emptyData('No hay proyectos archivados. Cuando un proyecto termine, cámbialo a «Terminada» y ciérralo con el botón 📦.');
  }

  return (
    <div className={`app ${dropAll ? 'drop-all' : ''}`}
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropAll(true); } }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDropAll(false); }}
      onDrop={e => { setDropAll(false); const f = e.dataTransfer.files?.[0]; if (f && /pdf$/i.test(f.name)) { e.preventDefault(); openImport(f); } }}>

      <header className="top">
        <div className="brand"><span className="logo">🌿</span><h1>Bitácora Tracker</h1><small>SETENA</small></div>
        <div className={`search ${searching ? 'active' : ''}`} data-help-title="Buscar" data-help="Busca por número (con o sin guiones), nombre del proyecto o estado. No importan acentos ni mayúsculas, y busca también en las archivadas. Atajo: / o Ctrl+F."><Ic n="search" />
          <input ref={searchRef} placeholder="Buscar número, proyecto o estado  ( / )" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setQ(''); }} />
          {q && <button className="icon-btn sm" onClick={() => setQ('')} title="Limpiar"><Ic n="close" /></button>}</div>
        <div className="top-btns">
          <button className={`btn ${paused ? 'paused' : ''}`} data-tour="import" data-help-title="Importar PDF" data-help="Carga el PDF (o el texto copiado) del listado de SETENA. La app saca número, proyecto, estado y fecha de apertura, y luego los revisas uno por uno. Puedes pausar y continuar otro día." onClick={() => openImport()} title={paused ? `Continuar importación (${paused.doneCount}/${paused.total})` : 'Importar PDF (I)'}>
            <Ic n="upload" /> {paused ? <>Continuar <b>{paused.doneCount}/{paused.total}</b></> : 'Importar PDF'}</button>
          <button className="btn" data-help-title="Exportar CSV" data-help="Descarga todas las bitácoras en un archivo para Excel: número, proyecto, estado, avance, próximas entregas, pasos y ubicación." onClick={async () => { if (await backend.saveFile(`bitacoras-${today}.csv`, toCsv(d), 'csv', 'CSV (Excel)')) toast('CSV exportado'); }} title="Exportar a CSV"><Ic n="download" /> CSV</button>
          <button className="btn" data-help-title="Resumen" data-help="Revisión general: cuántos proyectos hay por estado, qué falta este mes y qué Regencias vienen." onClick={() => openReview()} title="Resumen general (R)"><Ic n="review" /> Resumen</button>
          <button className="btn primary" data-tour="new" data-help-title="Nueva bitácora" data-help="Crea una bitácora a mano: número D1-XXXX-AAAA, nombre del proyecto, fecha de apertura, estado y ubicación. Las entregas se calculan solas." onClick={() => openEditor()} title="Nueva bitácora (N)"><Ic n="plus" /> Nueva bitácora</button>
        </div>
      </header>

      <div className="bar">
        <div className="seg" role="tablist" data-tour="views" data-help-title="Pestañas" data-help="Activas: todos los proyectos, ordenados por fecha. Agenda y rutas: todo lo pendiente por fecha y las salidas con proyectos cercanos. Mes actual / próximo: los Informes Regenciales de ese mes. Regencias: las semestrales por vencer. Archivadas: proyectos cerrados. Atajos 1–6.">
          {TABS.map(t => (
            <button key={t.id} role="tab" aria-selected={!searching && view === t.id} className={!searching && view === t.id ? 'on' : ''} onClick={() => setView(t.id)} title={`${t.txt} (${t.keyName})`}>
              {t.txt}
              {t.id === 'month' && r.pendingMonth > 0 && <b className="red">{r.pendingMonth}</b>}
              {t.id === 'regencias' && (r.regenciasOverdue + r.regenciasDueSoon) > 0 && <b className={r.regenciasOverdue ? 'red' : ''}>{r.regenciasOverdue + r.regenciasDueSoon}</b>}
              {t.id === 'archive' && r.archivedCount > 0 && <b className="gray">{r.archivedCount}</b>}
            </button>))}
        </div>
        <div className="stats" data-help-title="Contadores" data-help="Informes Regenciales pendientes del mes, Regencias en aviso o vencidas y proyectos activos.">
          <span title="Informes Regenciales del mes pendientes"><i className="red" />{r.pendingMonth} pendientes</span>
          <span title="Regencias en aviso o vencidas"><i className="purple" />{r.regenciasDueSoon + r.regenciasOverdue} regencias</span>
          <span title="Proyectos activos"><i />{r.activeProjects} activos</span>
        </div>
      </div>

      {paused && !searching && (
        <div className="info-bar paused-bar"><Ic n="clock" /> Importación en pausa · {paused.file} · {paused.doneCount} de {paused.total} revisadas
          <button className="btn primary sm" onClick={() => openImport()}>▶ Continuar</button></div>
      )}

      <main className="project-list">{body}</main>

      <footer className="foot">
        <span>I = inspección (7 días antes) · Inf = informe a SETENA · Regencia = semestral · 🚗📤 = inspección / informe</span>
        <span className="grow" />Clic en el nombre o ✎ para ver sus entregas, la carta, su ubicación y sus fotos · ? = ayuda
      </footer>

      {dropAll && <div className="drop-veil"><Ic n="upload" size={40} /><b>Suelta el PDF para importarlo</b></div>}
      <ReminderCards />
      <Tutorial hasProjects={d.projects.length > 0} />
      <Help />
      <SettingsPanel />
      <ToastHost />
      <ModalHost />
    </div>
  );
}
