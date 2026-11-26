// ===== Agenda: everything pending by DATE, and trips grouping nearby projects =====
// Each row is a delivery (the month's Informe Regencial or a semiannual Regencia) of a project, from the most
// urgent to the furthest away (overdue first). With «Agrupar por cercanía» projects less than X km apart
// are joined into trips, to do several visits on the same day, with the route in Google Maps.
import { useState } from 'react';
import type { AppData } from '../lib/types';
import { agenda, type PendingItem } from '../lib/schedule';
import { shortDate, addDays, todayISO } from '../lib/dates';
import { groupNearby, distanceKm, mapLink, routeLink, kmTxt, orderRoute } from '../lib/geo';
import { mutate } from '../lib/store';
import { backend } from '../lib/backend';
import { Ic, toast } from './core';
import { openEditor } from './ProjectEditor';
import { DeliveryCard, StepsMini, daysText } from './Delivery';

const HORIZONS = [14, 30, 45, 90];
const RADIOS = [5, 10, 15, 25, 40];
const LS = 'bt_agenda';

export function Agenda({ d }: { d: AppData }) {
  const today = todayISO();
  const [cfg, setCfgRaw] = useState<{ days: number; group: boolean }>(() => {
    try { return { days: 30, group: true, ...JSON.parse(localStorage.getItem(LS) || '{}') }; } catch { return { days: 30, group: true }; }
  });
  const setCfg = (c: Partial<typeof cfg>) => { const n = { ...cfg, ...c }; setCfgRaw(n); try { localStorage.setItem(LS, JSON.stringify(n)); } catch { /* opcional */ } };
  const [isOpen, setOpenRow] = useState<string | null>(null);
  const radius = d.settings.radiusKm || 15;

  const items = agenda(d, today, addDays(today, cfg.days));
  const overdueCount = items.filter(x => x.overdue).length;
  const noLocationCount = new Set(items.filter(x => !x.b.location).map(x => x.b.id)).size;

  const openMap = (url: string) => backend.openMap(url).catch(e => toast(String(e)));

  // A function (not a component) so the open letter isn't remounted on every save
  const row = (x: PendingItem, near = false) => {
    const id = `${x.b.id}|${x.key}`;
    const neighbors = near && x.b.location
      ? [...new Map(items.filter(y => y.b.id !== x.b.id && y.b.location && distanceKm(x.b.location!, y.b.location) <= radius)
        .map(y => [y.b.id, { b: y.b, km: distanceKm(x.b.location!, y.b.location!) }])).values()].sort((a, c) => a.km - c.km)
      : [];
    return (
      <div key={id} className={`ag-row ${x.overdue ? 'overdue' : ''} ${isOpen === id ? 'open' : ''}`}>
        <div className="ag-main" onClick={() => setOpenRow(a => (a === id ? null : id))} title="Clic para ver los pasos, ajustar la fecha y escribir la carta">
          <span className="ag-date"><b>{shortDate(x.date)}</b><small>{daysText(x.days)}</small></span>
          <span className={`ag-type ${x.type}`}>{x.type === 'monthly' ? '📋 Inf. Regencial' : '🗂️ Regencia'}</span>
          <span className="ag-project"><span className="mono">{x.b.code}</span> <span className="ag-name">{x.b.name}</span>
            {neighbors.length > 0 && <span className="ag-near" title={neighbors.map(v => `${v.b.code} a ${kmTxt(v.km)}`).join('\n')}>📍 cerca: {neighbors.slice(0, 2).map(v => `${v.b.code} (${kmTxt(v.km)})`).join(', ')}{neighbors.length > 2 ? ` +${neighbors.length - 2}` : ''}</span>}
            {!x.b.location && <span className="c-noloc" title="Sin ubicación">📍?</span>}
          </span>
          <StepsMini b={x.b} itemKey={x.key} />
          <span className="ag-acc" onClick={ev => ev.stopPropagation()}>
            {x.b.location && <button className="icon-btn sm" title="Ver en el mapa" onClick={() => openMap(mapLink(x.b.location!))}>🗺️</button>}
            <button className="icon-btn sm" title="Abrir el proyecto" onClick={() => openEditor(x.b)}><Ic n="edit" /></button>
          </span>
        </div>
        {isOpen === id && <div className="ag-detail"><DeliveryCard b={x.b} itemKey={x.key} /></div>}
      </div>
    );
  };

  let body;
  if (!items.length) body = <div className="empty-list"><p>Nada pendiente en los próximos {cfg.days} días. 🎉</p></div>;
  else if (!cfg.group) body = <div className="ag-list">{items.map(x => row(x, true))}</div>;
  else {
    const { groups: groups, withoutLocation: withoutLocation } = groupNearby(items, radius);
    const sortOrder = groups.map(g => ({ g, first: g[0].date })).sort((a, c) => a.first.localeCompare(c.first));
    body = <>
      {sortOrder.map(({ g }, n) => {
        const projects = [...new Map(g.map(x => [x.b.id, x])).values()];
        const path = orderRoute(projects);
        const overdue = g.filter(x => x.overdue).length;
        return (
          <section key={n} className="ag-group">
            <header>
              <b>{projects.length > 1 ? `🚗 Salida · ${projects.length} proyectos cercanos` : `📍 ${projects[0].b.code}`}</b>
              <span className={`ag-due ${overdue ? 'overdue' : ''}`}>{overdue ? `${overdue} vencida(s) · ` : ''}ir antes del {shortDate(g[0].date)} ({daysText(g[0].days)})</span>
              <span className="grow" />
              {projects.length > 1 && <small className="muted">máx. {kmTxt(Math.max(...projects.flatMap(a => projects.map(c => distanceKm(a.b.location!, c.b.location!)))))} entre ellos</small>}
              <button className="btn sm" onClick={() => openMap(projects.length > 1 ? routeLink(path.map(x => x.b.location!)) : mapLink(projects[0].b.location!))}>
                🗺️ {projects.length > 1 ? 'Ruta en Google Maps' : 'Ver en el mapa'}</button>
            </header>
            {g.map(x => row(x))}
          </section>
        );
      })}
      {withoutLocation.length > 0 && (
        <section className="ag-group noloc">
          <header><b>📍? Sin ubicación</b><span className="muted">Abre el proyecto y pega su ubicación, o se toma sola del GPS de las fotos.</span></header>
          {withoutLocation.map(x => row(x))}
        </section>
      )}
    </>;
  }

  return (
    <>
      <div className="filters ag-bar" data-help-title="Agenda" data-help="Todo lo que falta, por fecha: lo vencido arriba. Clic en una fila para ver sus pasos (visita, fotos, carta, subido), ajustar la fecha y escribir la carta. «Agrupar por cercanía» junta proyectos cercanos en una sola salida con la ruta en Google Maps.">
        <span className="ag-res"><b>{items.length}</b> pendientes{overdueCount ? <> · <b className="red-t">{overdueCount}</b> vencidas</> : null}</span>
        <span className="sep" />
        <label>Próximos <select className="sort" value={cfg.days} onChange={e => setCfg({ days: Number(e.target.value) })}>
          {HORIZONS.map(h => <option key={h} value={h}>{h} días</option>)}</select></label>
        <button className={`fchip ${cfg.group ? 'on' : ''}`} onClick={() => setCfg({ group: !cfg.group })}>🚗 Agrupar por cercanía</button>
        <label>a menos de <select className="sort" value={radius} onChange={e => mutate(dd => { dd.settings.radiusKm = Number(e.target.value); }, { undo: false })}>
          {[...new Set([...RADIOS, radius])].sort((a, c) => a - c).map(r => <option key={r} value={r}>{r} km</option>)}</select></label>
        {noLocationCount > 0 && <small className="muted">{noLocationCount} proyecto(s) sin ubicación</small>}
      </div>
      {body}
    </>
  );
}
