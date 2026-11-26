// ===== Bitácora Tracker: main screen =====
// Inverted structure: the project LIST is the main thing and each project carries its own
// delivery calendar. Tabs: Activas · Agenda y rutas · Mes actual · Mes próximo · Regencias · Archivadas.
// Same architecture as the Cognose calendar: single store → views that only render → shared dialogs.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAppData, isReady, Undo, mutate, reload, markAllBefore } from './lib/store';
import type { Project, Status } from './lib/types';
import { isActiveProject, isFinished } from './lib/types';
import { reportTasks, REPORT_LABEL, pendingBefore, completeIn, nextDue, upcomingRegencias, summary, monthTasks, type RegenciaInfo, sortDate } from './lib/schedule';
import { matches } from './lib/search';
import { addDays, monthKeyOf, monthNameOf, shortDate, todayISO } from './lib/dates';
import { SettingsPanel, applyAppearance, toggleSettings } from './ui/Settings';
import { Ic, Popover, ModalHost, ToastHost, hasModal, toast } from './ui/core';
import { openEditor } from './ui/ProjectEditor';
import { openImport, pausedImport } from './ui/Import';
import { RowHeader, ProjectRow, type Mode } from './ui/ProjectRow';
import { openReview } from './ui/Review';
import { Tutorial, openTutorial } from './ui/Tutorial';
import { Help } from './ui/Help';
import { listenToPhone } from './ui/ProjectLog';
import { openStatusReport } from './ui/StatusReport';
import { TasksView } from './ui/Tasks';
import { RoutesView } from './ui/Routes';
import { openPhone } from './ui/Phone';
import { scanFolders } from './lib/scan';
import { applySetena } from './lib/setenaImport';
import { backend, esWeb } from './lib/backend';
import { toCsv } from './lib/csv';

type View = 'tasks' | 'active' | 'agenda' | 'month' | 'nextMonth' | 'regencias' | 'archive';
type SortOrder = 'nextDue' | 'code' | 'name' | 'openedOn';
type StatusFilter = 'all' | Status | 'overdue' | 'nodate';

const LS_VIEW = 'bt_vista';

export default function App() {
  const d = useAppData();
  const [view, setViewRaw] = useState<View>(() => { try { const v = localStorage.getItem(LS_VIEW) as View; return ['tasks', 'active', 'agenda', 'archive'].includes(v) ? v : 'tasks'; } catch { return 'tasks'; } });
  const [filter, setFilter] = useState<StatusFilter>('all');
  const labelFilter = null as string | null;
  const sortOrder: SortOrder = 'nextDue';
  const [q, setQ] = useState('');
  const [dropAll, setDropAll] = useState(false);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [dl, setDl] = useState<{ done: number; total: number; saved: number; skipped: number; failed: number } | null>(null);
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
  // «Descargar de SETENA»: the portal window sends what it read → match it to the projects → download the files
  useEffect(() => {
    backend.onSetena(json => {
      let r: ReturnType<typeof applySetena> | null = null;
      try { const m = JSON.parse(json); mutate(dd => { r = applySetena(dd, m); }); } catch (e) { toast('No se pudo leer lo que envió SETENA: ' + String(e)); return; }
      const res = r as ReturnType<typeof applySetena> | null;
      if (!res) return;
      toast(`📥 SETENA: ${res.summary || 'sin cambios'} · descargando ${res.downloads.length} archivo(s)…`, true);
      // The app never replaces a file: it skips the ones downloaded before (even if renamed, moved or deleted)
      // and any name already in the project's folder; it only brings what's missing.
      // receipts already downloaded into Regencias go to «Notas de recibido» (if not there, nothing happens)
      void (async () => {
        for (const mv of res.moves) { try { await backend.moveAttachment(mv.from, mv.folder); } catch { /* not there */ } }
        if (res.downloads.length) await backend.downloadFiles(res.downloads);
        void scanFolders(true).then(msg => { if (msg) toast(msg, true); });
      })().catch(e => toast(String(e)));
    });
    backend.onDownload(p => {
      setDl(p.finished ? null : p);
      if (p.finished) toast(`📥 Descarga lista: ${p.saved} nuevos, ${p.skipped} ya los tenías (no se tocaron)${p.failed ? `, ${p.failed} no se pudieron` : ''}. Están en las carpetas de cada mes.`);
    });
  }, []);
  // Friday summary: open «Rutas» on next week
  useEffect(() => {
    backend.onReminder(list => {
      if (!list.some(r => r.kind === 'weekly')) return;
      setView('agenda');
      const now = todayISO(), wd = new Date(now + 'T12:00').getDay();
      setTimeout(() => window.dispatchEvent(new CustomEvent('bt-routes-week', { detail: addDays(now, ((8 - wd) % 7) || 7) })), 50);
    });
  }, []); // eslint-disable-line
  // Photos / documents put in the project folders by hand: check what they show (on start and when coming back)
  useEffect(() => {
    const run = (force = false) => scanFolders(force).then(m => { if (m) toast(`📂 ${m}`, true); }).catch(() => { /* not on desktop */ });
    const t = setTimeout(() => run(true), 4000);
    const f = () => run();
    window.addEventListener('focus', f);
    return () => { clearTimeout(t); window.removeEventListener('focus', f); };
  }, []);
  // Photos and notes arriving from the phone
  useEffect(() => { listenToPhone(); }, []);
  // The phone page needs the list of active projects to choose where the photos go
  const phoneList = useMemo(() => JSON.stringify(d.projects.filter(b => isActiveProject(b)).map(b => ({ code: b.code, name: b.name }))), [d.projects]);
  useEffect(() => { backend.phoneProjects(phoneList).catch(() => { /* sin servidor del celular */ }); }, [phoneList]);
  // …and the tasks with their checkboxes (phone page «Tareas»)
  const phoneTasks = useMemo(() => {
    const now = todayISO(), t = reportTasks(d, now, addDays(now, 30));
    const W = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
    return JSON.stringify({ tasks: [...t.overdue, ...t.upcoming].slice(0, 500).map(x => ({
      id: x.b.id, code: x.b.code, name: x.b.name, kind: x.kind, key: x.key, step: x.step, date: x.date,
      label: REPORT_LABEL[x.kind] + (x.kind === 'inspection' || x.kind === 'bitacora' ? ` · ${monthNameOf(x.month).split(' ')[0].toLowerCase()}` : ''),
      dateText: `${W[new Date(x.date + 'T12:00').getDay()]} ${shortDate(x.date)}`
    })) });
  }, [d]);
  useEffect(() => { backend.phoneTasks(phoneTasks).catch(() => { /* sin servidor del celular */ }); }, [phoneTasks]);
  useEffect(() => { if (!d.settings.tutorialSeen) { const t = setTimeout(openTutorial, 700); return () => clearTimeout(t); } }, [d.settings.tutorialSeen]);
  useEffect(() => {
    const f = (e: Event) => {
      const v = String((e as CustomEvent).detail);
      const views: View[] = ['tasks', 'active', 'agenda', 'archive'];
      setView(views.includes(v as View) ? v as View : 'active'); setFilter('all');
    };
    window.addEventListener('bt:view', f);
    return () => window.removeEventListener('bt:view', f);
  }, []);

  const TABS: { id: View; txt: string; keyName: string }[] = [
    { id: 'tasks', txt: '✅ Tareas', keyName: '1' }, { id: 'active', txt: 'Proyectos', keyName: '2' },
    { id: 'agenda', txt: 'Rutas', keyName: '3' }, { id: 'archive', txt: 'Archivadas', keyName: '4' }
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
      const act: Record<string, () => void> = { n: () => openEditor(), i: () => openImport(), r: () => openReview(), e: () => openStatusReport(), '/': () => searchRef.current?.focus(), ',': toggleSettings };
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

  const [askAll, setAskAll] = useState(false);
  const taskCounts = useMemo(() => { const t = reportTasks(d, today, addDays(today, 6)); return { late: t.overdue.length, week: t.upcoming.length }; }, [d, today]);
  const allBehind = useMemo(() => activeProjects.reduce((n, b) => n + pendingBefore(b, `${mk}-01`).length, 0), [activeProjects, mk]);
  const activeList = useMemo(() => {
    // Priority = DATE of the most urgent pending delivery (Informe Regencial or Regencia): overdue first
    const pf = new Map(activeProjects.map(b => [b.id, nextDue(b)]));
    const prox = (b: Project) => { const x = pf.get(b.id); return x ? sortDate(x) : '9999'; };
    const l = activeProjects.filter(b =>
      (filter === 'all' || (filter === 'overdue' ? !!pf.get(b.id)?.overdue : filter === 'nodate' ? !!b.noOpeningDate : b.status === filter)) && (!labelFilter || b.labelId === labelFilter));
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
  } else if (view === 'tasks' && d.projects.length) {
    body = <TasksView d={d} />;
  } else if (view === 'active' || view === 'tasks') {
    body = !d.projects.length ? (
      <div className="empty-list"><div className="empty">
        <div className="empty-ic">🌿</div>
        <h2>Empieza con tu PDF de SETENA</h2>
        <p>Importa el listado; la app extrae número, proyecto y estado.<br />El Informe Regencial mensual y la Regencia cada 6 meses se calculan solos desde la fecha de apertura.</p>
        <div className="row"><button className="btn primary" onClick={() => openImport()}><Ic n="upload" /> Importar PDF</button>
          <button className="btn" onClick={() => openEditor()}><Ic n="plus" /> Crear a mano</button></div>
      </div></div>
    ) : <>
      <div className="filters simple" data-help-title="Filtros" data-help="Muestra solo las vencidas, las abiertas o las que ya terminaron. Clic otra vez para quitar el filtro. La lista siempre va por fecha: lo más urgente arriba.">
        {chip('all', 'Todas', activeProjects.length)}
        {chip('overdue', 'Vencidas', activeProjects.filter(b => nextDue(b)?.overdue).length, 'warn')}
        {activeProjects.some(b => b.noOpeningDate) && chip('nodate', 'Sin fecha', activeProjects.filter(b => b.noOpeningDate).length, 'warn')}
        {chip('new', 'Nuevas', r.new, 'status-new')}
        {chip('open', 'Abiertas', r.open, 'status-open')}
        {chip('closing', 'Sol. cierre', r.closing, 'status-closing')}
        {allBehind > 0 && (askAll
          ? <span className="catch-up">¿Marcar como hechas las {allBehind} tareas de todos los proyectos anteriores a {monthNameOf(mk).split(' ')[0].toLowerCase()}? <button className="btn sm primary" onClick={() => { const n = markAllBefore(activeProjects.map(b => b.id), `${mk}-01`); setAskAll(false); toast(`✓ ${n} tareas marcadas como hechas`, true); }}>Sí, marcar</button> <button className="dp-link" onClick={() => setAskAll(false)}>no</button></span>
          : <button className="dp-link" title="Para poner al día lo que ya se hizo antes de usar la app. Cada tarea queda con su fecha; se puede deshacer." onClick={() => setAskAll(true)}>✓ Marcar todo lo anterior a {monthNameOf(mk).split(' ')[0].toLowerCase()} como hecho ({allBehind})</button>)}
        {r.finished > 0 && <button className="dp-link" title="Solicitud de Cierre y Terminadas ya no generan entregas; pasan a Archivadas con todo su historial" onClick={() => archiveFinished()}>📦 Archivar {r.finished} terminada(s)</button>}
      </div>
      {activeList.length ? <><RowHeader />{activeList.map(b => P(b))}</> : emptyData('Ninguna bitácora coincide con el filtro.')}
    </>;
  } else if (view === 'agenda') {
    body = <RoutesView d={d} />;
  } else if (view === 'month' || view === 'nextMonth') {
    const m = view === 'month' ? mk : nextMk;
    const t = monthTasks(d, m);
    const doneCount = t.filter(x => completeIn(x.b, x.mk)).length;
    const withRegencia = t.filter(x => x.regencia).length;
    body = <>
      <div className="month-summary">
        <div><b>{t.length}</b><span>informes regenciales en {monthNameOf(m).split(' ')[0].toLowerCase()}</span></div>
        <div className={doneCount === t.length && t.length ? 'ok' : ''}><b>{doneCount}/{t.length}</b><span>completas</span></div>
        <div><b>{withRegencia}</b><span>con Regencia</span></div>
      </div>
      {t.length > 0 && <RowHeader />}
      {t.length ? [...t].sort((a, c) => Number(completeIn(a.b, a.mk)) - Number(completeIn(c.b, c.mk)) || a.date.localeCompare(c.date)).map(x => P(x.b, { type: 'month', mk: m }))
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
          {paused && <button className="btn paused" onClick={() => openImport()} title="Continuar importación"><Ic n="upload" /> Continuar <b>{paused.doneCount}/{paused.total}</b></button>}
          <button className="btn" data-help-title="Informe de estado" data-help="Qué hay que hacer los próximos días y todo lo que quedó pendiente. Se puede copiar o guardar para imprimir." onClick={() => openStatusReport()} title="Informe de estado (E)">📊 Informe</button>
          <button className="btn primary" data-tour="new" data-help-title="Nueva bitácora" data-help="Crea una bitácora a mano: número, nombre, fecha de apertura y estado. Las tareas se calculan solas." onClick={() => openEditor()} title="Nueva bitácora (N)"><Ic n="plus" /> Nueva</button>
          <button className="btn" onClick={() => openPhone()} title="Usar en el celular por Wi-Fi">📱 Celular</button>
          <button className="btn icon-only" data-tour="import" title="Más: importar PDF, exportar, resumen" onClick={e => setMenu(e.currentTarget)}>⋯</button>
          {menu && <Popover anchor={menu} onClose={() => setMenu(null)} width={230}><>
            <button className="pop-opt" onClick={() => { setMenu(null); backend.setenaOpen().catch(e => toast(String(e))); }}>📥 Descargar todo de SETENA</button>
            <button className="pop-opt" onClick={() => { setMenu(null); openImport(); }}><Ic n="upload" /> Importar PDF de SETENA</button>
            <button className="pop-opt" onClick={async () => { setMenu(null); if (await backend.saveFile(`bitacoras-${today}.csv`, toCsv(d), 'csv', 'CSV (Excel)')) toast('CSV exportado'); }}><Ic n="download" /> Exportar a Excel (CSV)</button>
            <button className="pop-opt" onClick={() => { setMenu(null); openReview(); }}><Ic n="review" /> Resumen general</button>
            <button className="pop-opt" onClick={() => { setMenu(null); backend.openFolder().catch(e => toast(String(e))); }}>📂 Abrir carpeta de datos</button>
          </></Popover>}
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
        <div className="stats">
          <span title="Tareas atrasadas"><i className="red" />{taskCounts.late} atrasadas</span>
          <span title="Tareas de los próximos 7 días"><i className="purple" />{taskCounts.week} esta semana</span>
          <span title="Proyectos activos"><i />{r.activeProjects} activos</span>
        </div>
      </div>

      {dl && (
        <div className="info-bar dl-bar">📥 Descargando de SETENA: <b>{dl.done}</b> de {dl.total} archivos
          <span className="dl-track"><span style={{ width: `${Math.round(dl.done / Math.max(1, dl.total) * 100)}%` }} /></span>
          <small className="muted">{dl.saved} nuevos · {dl.skipped} ya estaban{dl.failed ? ` · ${dl.failed} con error` : ''} · puedes seguir usando la app</small></div>
      )}
      {paused && !searching && (
        <div className="info-bar paused-bar"><Ic n="clock" /> Importación en pausa · {paused.file} · {paused.doneCount} de {paused.total} revisadas
          <button className="btn primary sm" onClick={() => openImport()}>▶ Continuar</button></div>
      )}

      <main className="project-list">{body}</main>


      {dropAll && <div className="drop-veil"><Ic n="upload" size={40} /><b>Suelta el PDF para importarlo</b></div>}
      <Tutorial hasProjects={d.projects.length > 0} />
      <Help />
      <SettingsPanel />
      <ToastHost />
      <ModalHost />
    </div>
  );
}
