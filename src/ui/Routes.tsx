// ===== Rutas: weekly routes on Google Maps, from project to project =====
// The week's pending inspections, each project once. «Plan de la semana» (default): every pending inspection,
// late ones included, spread over the days left in the week as trips of nearby projects (lib/plan.ts).
// «Por fecha»: one route per day by the inspection date. «Sugeridas»: nearby projects grouped into trips.
// Every route starts at the start point (home / office), visits the projects in the shortest order
// found and (optionally) comes back. «Abrir en Google Maps» opens the route ready to drive.
import { useEffect, useState } from 'react';
import type { AppData, Project } from '../lib/types';
import { reportTasks, type ReportTask } from '../lib/schedule';
import { planDays, planWeek, planMonday } from '../lib/plan';
import { addDays, fromISO, longDate, monthNameOf, shortDate, todayISO } from '../lib/dates';
import { distanceKm, groupNearby, kmTxt, parseCoordinates, planRoute, routeKm, routeLink, type Point } from '../lib/geo';
import { editDelivery, getData, markStep, mutate } from '../lib/store';
import { backend } from '../lib/backend';
import { toast } from './core';
import { openEditor } from './ProjectEditor';

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
/** Straight lines are shorter than roads: a rough factor for the estimate. */
const ROAD = 1.35;

interface Stop { b: Project; tasks: ReportTask[]; date: string }

const mondayOf = (iso: string) => { const wd = fromISO(iso).getDay(); return addDays(iso, wd === 0 ? -6 : 1 - wd); };


/** One stop per project: its pending inspections in the range (the oldest one gives the date). */
function stopsOf(list: ReportTask[]): Stop[] {
  const m = new Map<string, Stop>();
  for (const t of list) {
    const s = m.get(t.b.id);
    if (s) s.tasks.push(t); else m.set(t.b.id, { b: t.b, tasks: [t], date: t.date });
  }
  return [...m.values()].sort((a, c) => a.date.localeCompare(c.date));
}

export function RoutesView({ d }: { d: AppData }) {
  const today = todayISO();
  const [mon, setMon] = useState(() => planMonday(today));
  const [mode, setMode] = useState<Mode>('plan');
  const [withLate, setWithLate] = useState(false);
  useEffect(() => {
    const f = (e: Event) => setMon(mondayOf(String((e as CustomEvent).detail)));
    window.addEventListener('bt-routes-week', f);
    return () => window.removeEventListener('bt-routes-week', f);
  }, []);
  const sun = addDays(mon, 6);
  const home = d.settings.home;
  const back = d.settings.roundTrip;
  const radius = d.settings.radiusKm || 15;

  const { overdue, upcoming } = reportTasks(d, today, sun);
  const inWeek = [...overdue, ...upcoming].filter(t => t.kind === 'inspection' && t.date >= mon && t.date <= sun);
  // the plan always includes what is late (catching up is the point); the other views only when ticked
  const late = withLate || mode === 'plan' ? overdue.filter(t => t.kind === 'inspection' && t.date < mon) : [];
  const stops = stopsOf([...inWeek, ...late]);
  const lateCount = new Set(overdue.filter(t => t.kind === 'inspection' && t.date < mon).map(t => t.b.id)).size;

  const routes: Route[] = [];
  if (mode === 'plan') {
    const plan = planWeek(stops, planDays(mon, today), radius);
    for (const x of plan.days) routes.push({ title: `${DAYS[fromISO(x.day).getDay()]} ${shortDate(x.day)}`, day: x.day, stops: x.stops });
    if (plan.withoutLocation.length) routes.push({ title: 'Sin ubicación', stops: plan.withoutLocation });
    if (plan.overflow.length) routes.push({ title: 'Para la semana siguiente', stops: plan.overflow, later: true });
  } else if (mode === 'day') {
    const lateStops = stops.filter(s => s.date < mon);
    if (lateStops.length) routes.push({ title: '⚠️ Atrasadas (sin día)', stops: lateStops });
    for (let i = 0; i < 7; i++) {
      const day = addDays(mon, i);
      const l = stops.filter(s => s.date === day);
      if (l.length) routes.push({ title: `${DAYS[fromISO(day).getDay()]} ${shortDate(day)}`, day, stops: l });
    }
  } else {
    const { groups, withoutLocation } = groupNearby(stops, radius);
    groups.forEach((g, i) => routes.push({ title: `Viaje ${i + 1}`, stops: g }));
    if (withoutLocation.length) routes.push({ title: 'Sin ubicación', stops: withoutLocation });
  }

  return (
    <div className="routes">
      <div className="rt-bar">
        <div className="rt-week">
          <button className="btn sm" onClick={() => setMon(addDays(mon, -7))} title="Semana anterior">‹</button>
          <b>Semana del {shortDate(mon)} al {shortDate(sun)}</b>
          <button className="btn sm" onClick={() => setMon(addDays(mon, 7))} title="Semana siguiente">›</button>
          {mon !== mondayOf(today) && <button className="dp-link" onClick={() => setMon(mondayOf(today))}>{mon === addDays(mondayOf(today), 7) ? '← lo que queda de esta semana' : 'esta semana'}</button>}
          {mon === addDays(mondayOf(today), 7) && <span className="muted sm">(la próxima semana)</span>}
        </div>
        <div className="ed-tabs">
          <button className={mode === 'plan' ? 'on' : ''} onClick={() => setMode('plan')} title="Todas las inspecciones pendientes (también las atrasadas), repartidas en los días que quedan, juntando proyectos cercanos">🗓️ Plan de la semana</button>
          <button className={mode === 'day' ? 'on' : ''} onClick={() => setMode('day')}>📅 Por fecha</button>
          <button className={mode === 'suggest' ? 'on' : ''} onClick={() => setMode('suggest')}>✨ Sugeridas</button>
        </div>
      </div>

      <div className="rt-opts">
        <HomePoint home={home} />
        <label className="rt-opt"><input type="checkbox" checked={back} onChange={e => mutate(dd => { dd.settings.roundTrip = e.target.checked; }, { undo: false })} /> volver a la salida</label>
        {mode !== 'day' && <label className="rt-opt">juntar a menos de <select value={radius} onChange={e => mutate(dd => { dd.settings.radiusKm = Number(e.target.value); }, { undo: false })}>
          {[5, 10, 15, 25, 40, 60].map(k => <option key={k} value={k}>{k} km</option>)}</select></label>}
        {lateCount > 0 && mode !== 'plan' && <label className="rt-opt"><input type="checkbox" checked={withLate} onChange={e => setWithLate(e.target.checked)} /> incluir {lateCount} atrasada(s)</label>}
      </div>

      {mode === 'plan' && stops.length > 0 && <div className="rt-plan-note muted">🗓️ {stops.length} inspección(es) por hacer{lateCount ? ` (${lateCount} atrasada(s))` : ''}, repartidas en {planDays(mon, today).length} día(s), hasta 6 por día, juntando los proyectos cercanos. «📅 Programar» guarda el día en cada proyecto.{!home ? ' Pon tu 🏠 punto de salida para ordenar mejor las rutas.' : ''}</div>}
      {!stops.length && <div className="rt-empty muted">No hay inspecciones pendientes esta semana.{lateCount > 0 && !withLate ? ' Marca «incluir atrasadas» para planear las que quedaron pendientes.' : ''}</div>}
      {routes.map(r => <RouteCard key={r.title} r={r} home={home} back={back} mode={mode} mon={mon} />)}
    </div>
  );
}

/** Start point of the routes: paste coordinates or a Google Maps link. */
function HomePoint({ home }: { home: AppData['settings']['home'] }) {
  const [editing, setEditing] = useState(!home);
  const [txt, setTxt] = useState('');
  const save = () => {
    const p = parseCoordinates(txt);
    if (!p) { toast('No encontré coordenadas: pega «9.93, -84.08» o un enlace de Google Maps con la ubicación'); return; }
    mutate(dd => { dd.settings.home = { lat: p.lat, lng: p.lng, text: '' }; }, { undo: false });
    setEditing(false); setTxt('');
    toast('🏠 Punto de salida guardado');
  };
  if (!editing && home) return (
    <span className="rt-home">🏠 Salida: <button className="dp-link" onClick={() => backend.openMap(`https://www.google.com/maps/search/?api=1&query=${home.lat},${home.lng}`).catch(e => toast(String(e)))}>{home.lat.toFixed(4)}, {home.lng.toFixed(4)}</button>
      <button className="dp-link" onClick={() => setEditing(true)}>cambiar</button></span>
  );
  return (
    <span className="rt-home edit">🏠 Salida:
      <input className="modal-input sm" placeholder="Pega coordenadas o enlace de Google Maps de tu casa / oficina" value={txt}
        onChange={e => setTxt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); }} />
      <button className="btn sm primary" onClick={save}>Guardar</button>
      {home && <button className="dp-link" onClick={() => setEditing(false)}>cancelar</button>}
    </span>
  );
}

type Mode = 'plan' | 'day' | 'suggest';
type Route = { title: string; day?: string; stops: Stop[]; later?: boolean };

function RouteCard({ r, home, back, mode, mon }: { r: Route; home: Point | null; back: boolean; mode: Mode; mon: string }) {
  const today = todayISO();
  const withGps = r.stops.filter(s => s.b.location);
  const noGps = r.stops.filter(s => !s.b.location);
  const order = planRoute(withGps, home, back);
  const pts = order.map(s => s.b.location!);
  const km = routeKm(pts, home, back);
  const parts: Stop[][] = [];
  const size = back && home ? 9 : 10;
  for (let i = 0; i < order.length; i += size) parts.push(order.slice(i, i + size));
  const [day, setDay] = useState(r.day ?? (today > mon && today <= addDays(mon, 6) ? today : mon));

  const open = (p: Stop[], i: number) => {
    const startAt = i === 0 ? home : parts[i - 1][parts[i - 1].length - 1].b.location!;
    backend.openMap(routeLink(p.map(s => s.b.location!), startAt, back && i === parts.length - 1)).catch(e => toast(String(e)));
  };
  const copy = async () => {
    const txt = [`Ruta ${r.title}`, ...order.map((s, i) => `${i + 1}. ${s.b.code} ${s.b.name}`), ...parts.map((p, i) => routeLink(p.map(s => s.b.location!), i === 0 ? home : parts[i - 1][parts[i - 1].length - 1].b.location!, back && i === parts.length - 1))].join('\n');
    try { await navigator.clipboard.writeText(txt); toast('Ruta copiada: pégala en WhatsApp'); } catch { toast('No se pudo copiar'); }
  };
  const schedule = () => {
    for (const s of r.stops) for (const t of s.tasks) editDelivery(s.b.id, t.key, { planned: day });
    toast(`🚗 ${r.stops.length} inspección(es) programadas el ${longDate(day)}`, true);
  };
  const done = (s: Stop) => {
    const t = s.tasks[0];
    markStep(s.b.id, t.key, 'visit', t.date <= today ? t.date : today);
    toast(`✓ ${s.b.code}: inspección hecha`, true);
  };
  const legKm = (i: number) => i === 0 ? (home ? distanceKm(home, pts[0]) : 0) : distanceKm(pts[i - 1], pts[i]);

  return (
    <section className="rt-card">
      <div className="rt-card-h">
        <b>{r.title}</b>
        <span className="muted">{r.stops.length} proyecto(s){order.length > 0 && km * ROAD >= 0.5 && ` · ~${kmTxt(km * ROAD)} aprox.`}</span>
        <span className="grow" />
        {r.later && <span className="muted rt-later">no caben en los días que quedan: salen en el plan de la semana siguiente (›)</span>}
        {mode !== 'day' && !r.later && r.stops.length > 0 && r.title !== 'Sin ubicación' && <span className="rt-sched">
          <select value={day} onChange={e => setDay(e.target.value)}>
            {Array.from({ length: 7 }, (_, i) => addDays(mon, i)).map(x => <option key={x} value={x}>{DAYS[fromISO(x).getDay()]} {shortDate(x)}</option>)}
          </select>
          <button className="btn sm" onClick={schedule} title="Mueve la inspección de estos proyectos a ese día">📅 Programar</button>
        </span>}
        {!r.later && parts.map((p, i) => <button key={i} className="btn sm primary" onClick={() => open(p, i)}>🗺️ {parts.length > 1 ? `Parte ${i + 1}` : 'Abrir en Google Maps'}</button>)}
        {order.length > 0 && <button className="btn sm" onClick={copy} title="Copiar la lista y el enlace">📋</button>}
      </div>
      <div className="rt-body">
        {order.length > 0 && <MiniMap pts={pts} home={home} back={back} />}
        <ol className="rt-stops">
          {home && order.length > 0 && <li className="rt-home-li">🏠 Salida</li>}
          {order.map((s, i) => (
            <li key={s.b.id}>
              <span className="rt-num">{i + 1}</span>
              <button className="tk-proj" onClick={() => openEditor(getData().projects.find(x => x.id === s.b.id) ?? s.b)}><b className="mono">{s.b.code}</b> <span>{s.b.name}</span></button>
              <small className={s.date < today ? 'red-t' : 'muted'}>{s.tasks.length > 1 ? `${s.tasks.length} pendientes · desde ${monthNameOf([...s.tasks].sort((x, y) => x.month.localeCompare(y.month))[0].month).toLowerCase()} · ` : `${monthNameOf(s.tasks[0].month).split(' ')[0].toLowerCase()} · `}{shortDate(s.date)}</small>
              <small className="muted rt-leg">{(i > 0 || home) ? `+${kmTxt(legKm(i) * ROAD)}` : ''}</small>
              <button className="ck" title="Inspección hecha" onClick={() => done(s)}>✓</button>
            </li>
          ))}
          {home && back && order.length > 0 && <li className="rt-home-li">🏠 Regreso <small className="muted">+{kmTxt(distanceKm(pts[pts.length - 1], home) * ROAD)}</small></li>}
        </ol>
      </div>
      {noGps.length > 0 && (
        <div className="rt-nogps">📍 Sin ubicación (no entran en la ruta):{' '}
          {noGps.map(s => <button key={s.b.id} className="dp-link" onClick={() => openEditor(getData().projects.find(x => x.id === s.b.id) ?? s.b, undefined, 'location')}>{s.b.code} · poner ubicación</button>)}
        </div>
      )}
    </section>
  );
}

/** Small drawing of the route (relative positions, north up). */
function MiniMap({ pts, home, back }: { pts: Point[]; home: Point | null; back: boolean }) {
  const all = [...(home ? [home] : []), ...pts];
  const W = 220, H = 160, pad = 16;
  const lat0 = Math.min(...all.map(p => p.lat)), lat1 = Math.max(...all.map(p => p.lat));
  const lng0 = Math.min(...all.map(p => p.lng)), lng1 = Math.max(...all.map(p => p.lng));
  const span = Math.max(lat1 - lat0, lng1 - lng0, 0.005);
  const x = (p: Point) => pad + ((p.lng - lng0) / span) * (W - 2 * pad) + ((W - 2 * pad) - ((lng1 - lng0) / span) * (W - 2 * pad)) / 2;
  const y = (p: Point) => H - pad - ((p.lat - lat0) / span) * (H - 2 * pad) - ((H - 2 * pad) - ((lat1 - lat0) / span) * (H - 2 * pad)) / 2;
  const path = [...(home ? [home] : []), ...pts, ...(home && back ? [home] : [])];
  return (
    <svg className="rt-map" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-label="Dibujo de la ruta">
      <polyline points={path.map(p => `${x(p)},${y(p)}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2" strokeDasharray="4 3" />
      {home && <text x={x(home)} y={y(home) + 5} textAnchor="middle" fontSize="14">🏠</text>}
      {pts.map((p, i) => <g key={i}><circle cx={x(p)} cy={y(p)} r="9" fill="var(--accent)" /><text x={x(p)} y={y(p) + 3.5} textAnchor="middle" fontSize="10" fill="#fff" fontWeight="700">{i + 1}</text></g>)}
    </svg>
  );
}
