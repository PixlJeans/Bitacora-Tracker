// ===== Informe de estado =====
// What to do in the coming days (by day, with nearby inspections grouped into one trip) and everything
// still pending from before (by project). Each task can be checked off right here. Copy as text or save as a page.
import { useState } from 'react';
import type { Project } from '../lib/types';
import { reportTasks, REPORT_LABEL, type ReportTask } from '../lib/schedule';
import { addDays, longDate, shortDate, fromISO, monthNameOf, todayISO } from '../lib/dates';
import { groupNearby, kmTxt, distanceKm, routeLink } from '../lib/geo';
import { getData, markStep, useAppData } from '../lib/store';
import { backend } from '../lib/backend';
import { openModal, closeModal, toast, Ic } from './core';
import { openEditor } from './ProjectEditor';
import { daysText, daysUntil } from './Delivery';

export function openStatusReport() {
  openModal(<StatusReport />, 'create-modal editor status-report');
}

type Range = 'week' | 'next' | 'two';
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Range of the report: next 7 days, next calendar week (Mon–Sun) or next 14 days. */
function rangeOf(r: Range, today: string): { from: string; until: string; title: string } {
  if (r === 'next') {
    const wd = fromISO(today).getDay();
    const mon = addDays(today, ((8 - wd) % 7) || 7);
    return { from: mon, until: addDays(mon, 6), title: `Próxima semana · ${shortDate(mon)} – ${shortDate(addDays(mon, 6))}` };
  }
  const n = r === 'two' ? 13 : 6;
  return { from: today, until: addDays(today, n), title: `Próximos ${n + 1} días · ${shortDate(today)} – ${shortDate(addDays(today, n))}` };
}

const what = (t: ReportTask) => `${REPORT_LABEL[t.kind]}${t.kind === 'inspection' || t.kind === 'bitacora' ? ` de ${monthNameOf(t.month).split(' ')[0].toLowerCase()}` : ''}`;

/** Pending from before, by project: per kind, how many and since when. */
function byProject(list: ReportTask[]) {
  const m = new Map<string, { b: Project; tasks: ReportTask[] }>();
  for (const t of list) { const x = m.get(t.b.id) ?? { b: t.b, tasks: [] }; x.tasks.push(t); m.set(t.b.id, x); }
  return [...m.values()].sort((a, c) => a.tasks[0].date.localeCompare(c.tasks[0].date));
}
function kindSummary(tasks: ReportTask[]) {
  return (Object.keys(REPORT_LABEL) as ReportTask['kind'][]).map(k => {
    const l = tasks.filter(t => t.kind === k);
    if (!l.length) return null;
    return { k, n: l.length, since: l[0].date, text: `${REPORT_LABEL[k]}: ${l.length === 1 ? shortDate(l[0].date) : `${l.length} (desde ${shortDate(l[0].date)})`}` };
  }).filter(Boolean) as { k: ReportTask['kind']; n: number; since: string; text: string }[];
}

function StatusReport() {
  const d = useAppData();
  const today = todayISO();
  const [range, setRange] = useState<Range>('week');
  const rg = rangeOf(range, today);
  const { overdue, upcoming: up, noDate } = reportTasks(d, today, rg.until);
  const upcoming = up.filter(t => t.date >= rg.from);
  const late = byProject(overdue);
  const days = [...new Set(upcoming.map(t => t.date))];
  const insp = upcoming.filter(t => t.kind === 'inspection');
  const { groups: trips } = groupNearby(insp, d.settings.radiusKm || 15);
  const tripsToShow = trips.filter(g => new Set(g.map(t => t.b.id)).size > 1);

  const done = (t: ReportTask) => {
    const date = t.date <= today ? t.date : today;
    markStep(t.b.id, t.key, t.step, date);
    toast(`✓ ${t.b.code}: ${what(t)}`, true);
  };

  // ---- text / page versions ----
  function asText() {
    const L: string[] = [`INFORME DE ESTADO · ${longDate(today)}`, rg.title, ''];
    L.push(`PARA HACER (${upcoming.length})`);
    for (const day of days) {
      L.push(`${WEEKDAYS[fromISO(day).getDay()]} ${shortDate(day)}:`);
      for (const t of upcoming.filter(x => x.date === day)) L.push(`  [ ] ${t.b.code} ${t.b.name} — ${what(t)}`);
    }
    if (!upcoming.length) L.push('  Nada en estos días.');
    if (tripsToShow.length) {
      L.push('', 'INSPECCIONES QUE SE PUEDEN JUNTAR');
      for (const g of tripsToShow) L.push('  ' + g.map(t => `${t.b.code} (${shortDate(t.date)})`).join(' + '));
    }
    L.push('', `PENDIENTE DE ANTES (${overdue.length} en ${late.length} proyectos)`);
    for (const p of late) L.push(`  ${p.b.code} ${p.b.name}: ${kindSummary(p.tasks).map(k => k.text.replace(/^\S+ /, '')).join(' · ')}`);
    if (noDate.length) L.push('', 'SIN FECHA DE APERTURA', ...noDate.map(b => `  ${b.code} ${b.name}`));
    return L.join('\n');
  }
  function asPage() {
    const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
    const rows = days.map(day => `<h3>${WEEKDAYS[fromISO(day).getDay()]} ${esc(shortDate(day))}</h3><ul>${upcoming.filter(x => x.date === day)
      .map(t => `<li>☐ <b>${esc(t.b.code)}</b> ${esc(t.b.name)} — ${esc(what(t))}</li>`).join('')}</ul>`).join('');
    const lateRows = late.map(p => `<tr><td><b>${esc(p.b.code)}</b></td><td>${esc(p.b.name)}</td><td>${kindSummary(p.tasks).map(k => esc(k.text)).join('<br>')}</td></tr>`).join('');
    return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Informe de estado ${today}</title><style>
body{font-family:system-ui,Segoe UI,sans-serif;max-width:820px;margin:2rem auto;padding:0 1rem;color:#1a1a1a}h1{font-size:1.4rem;margin:0}h2{margin-top:1.6rem;border-bottom:2px solid #16a34a;padding-bottom:.2rem;font-size:1.1rem}
h3{font-size:.95rem;margin:.8rem 0 .2rem;text-transform:capitalize}ul{margin:0;padding-left:1.2rem}li{margin:.15rem 0}table{border-collapse:collapse;width:100%;font-size:.9rem}td{border-bottom:1px solid #ddd;padding:.35rem .4rem;vertical-align:top}.m{color:#666}
</style></head><body><h1>Informe de estado</h1><div class="m">${esc(longDate(today))} · ${esc(rg.title)}</div>
<h2>Para hacer (${upcoming.length})</h2>${rows || '<p class="m">Nada en estos días.</p>'}
${tripsToShow.length ? `<h2>Inspecciones que se pueden juntar</h2><ul>${tripsToShow.map(g => `<li>${g.map(t => `<b>${esc(t.b.code)}</b> (${esc(shortDate(t.date))})`).join(' + ')}</li>`).join('')}</ul>` : ''}
<h2>Pendiente de antes (${overdue.length} en ${late.length} proyectos)</h2>${lateRows ? `<table>${lateRows}</table>` : '<p class="m">Todo al día.</p>'}
${noDate.length ? `<h2>Sin fecha de apertura</h2><ul>${noDate.map(b => `<li><b>${esc(b.code)}</b> ${esc(b.name)}</li>`).join('')}</ul>` : ''}
</body></html>`;
  }
  const copy = async () => { try { await navigator.clipboard.writeText(asText()); toast('Informe copiado: pégalo en WhatsApp, correo o notas'); } catch { toast('No se pudo copiar'); } };
  const save = async () => { if (await backend.saveFile(`Informe de estado ${today}.html`, asPage(), 'html', 'Página (se abre en el navegador y se puede imprimir)')) toast('Informe guardado'); };

  const open = (b: Project) => { closeModal(); openEditor(getData().projects.find(x => x.id === b.id) ?? b); };

  return (
    <div className="sr">
      <div className="ed-top">
        <h2>📊 Informe de estado <small className="muted">· {longDate(today)}</small></h2>
        <div className="ed-tabs">
          {([['week', '7 días'], ['next', 'Próxima semana'], ['two', '14 días']] as [Range, string][]).map(([k, t]) =>
            <button key={k} type="button" className={range === k ? 'on' : ''} onClick={() => setRange(k)}>{t}</button>)}
        </div>
      </div>

      <div className="sr-tiles">
        <div className={`sr-tile ${overdue.length ? 'bad' : 'ok'}`}><b>{overdue.length}</b><span>atrasadas · {late.length} proyectos</span></div>
        <div className="sr-tile"><b>{upcoming.length}</b><span>para {range === 'next' ? 'la próxima semana' : `los próximos ${range === 'two' ? 14 : 7} días`}</span></div>
        <div className="sr-tile"><b>{insp.length}</b><span>inspecciones · {tripsToShow.length} viajes juntos</span></div>
        <div className="sr-tile"><b>{upcoming.filter(t => t.kind === 'regElab' || t.kind === 'regUpload').length}</b><span>tareas de regencia</span></div>
      </div>

      <h3 className="sr-h">📅 Para hacer · {rg.title}</h3>
      {!days.length && <p className="muted sr-empty">Nada programado en estos días. 🎉</p>}
      {days.map(day => (
        <div key={day} className="sr-day">
          <div className="sr-day-h"><b>{WEEKDAYS[fromISO(day).getDay()]} {shortDate(day)}</b><small className="muted">{daysText(daysUntil(day, today))}</small></div>
          {upcoming.filter(t => t.date === day).map(t => (
            <div key={t.key + t.kind} className={`sr-item k-${t.kind}`}>
              <button type="button" className="ck" title="Marcar hecha" onClick={() => done(t)}><Ic n="check" size={13} /></button>
              <span className="sr-what">{what(t)}</span>
              <button type="button" className="sr-proj" onClick={() => open(t.b)}><b className="mono">{t.b.code}</b> {t.b.name}</button>
            </div>
          ))}
        </div>
      ))}

      {tripsToShow.length > 0 && <>
        <h3 className="sr-h">🚗 Inspecciones que se pueden juntar <small className="muted">(a menos de {d.settings.radiusKm || 15} km)</small></h3>
        {tripsToShow.map((g, i) => {
          const far = Math.max(0, ...g.flatMap(a => g.map(c => distanceKm(a.b.location!, c.b.location!))));
          return (
            <div key={i} className="sr-trip">
              {g.map(t => <span key={t.key} className="sr-chip"><b className="mono">{t.b.code}</b> {shortDate(t.date)}</span>)}
              <small className="muted">hasta {kmTxt(far)} entre ellos</small>
              <button type="button" className="dp-link" onClick={() => backend.openMap(routeLink(g.map(t => t.b.location!))).catch(e => toast(String(e)))}>🗺️ Ver ruta</button>
            </div>
          );
        })}
      </>}

      <h3 className="sr-h">⚠️ Pendiente de antes <small className="muted">({overdue.length} en {late.length} proyectos)</small></h3>
      {!late.length && <p className="muted sr-empty">Todo al día. ✓</p>}
      {late.map(p => (
        <div key={p.b.id} className="sr-late">
          <button type="button" className="sr-proj" onClick={() => open(p.b)}><b className="mono">{p.b.code}</b> {p.b.name}</button>
          <span className="sr-late-k">{kindSummary(p.tasks).map(k => <span key={k.k} className={`sr-chip k-${k.k}`}>{k.text}</span>)}</span>
        </div>
      ))}

      {noDate.length > 0 && <>
        <h3 className="sr-h">📅 Sin fecha de apertura <small className="muted">({noDate.length})</small></h3>
        <div className="sr-trip">{noDate.map(b => <button key={b.id} type="button" className="sr-chip" onClick={() => open(b)}><b className="mono">{b.code}</b> {b.name}</button>)}</div>
      </>}

      <div className="modal-actions">
        <button type="button" className="btn" onClick={copy}>📋 Copiar texto</button>
        <button type="button" className="btn" onClick={save}>💾 Guardar (para imprimir)</button>
        <span className="grow" />
        <button type="button" className="btn primary" onClick={closeModal}>Listo</button>
      </div>
    </div>
  );
}
