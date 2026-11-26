// ===== «Línea de tiempo»: the whole history of a project in one list, like SETENA's page but readable =====
// Newest on top (as in the portal), grouped by month, with filters and search. Data: lib/timeline.ts.
import { useMemo, useState } from 'react';
import type { Project } from '../lib/types';
import { timelineOf, type TlItem, type TlKind } from '../lib/timeline';
import { monthNameOf, shortDate, todayISO } from '../lib/dates';

const KINDS: { id: TlKind | 'all'; n: string }[] = [
  { id: 'all', n: 'Todo' }, { id: 'setena', n: '🌐 SETENA' }, { id: 'visit', n: '🚗 Inspecciones' }, { id: 'bitacora', n: '📋 Bitácora' },
  { id: 'regencia', n: '🗂️ Regencias' }, { id: 'receipt', n: '🧾 Recibidos' }, { id: 'doc', n: '📄 Documentos' }
];
const ICON: Record<TlKind, string> = { setena: '🌐', visit: '🚗', bitacora: '📋', regencia: '🗂️', receipt: '🧾', doc: '📄', start: '🏗️' };

/** 'YYYY-MM' of the month before. */
const prevMonth = (mk: string) => { const [y, m] = mk.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };

const nextMonth = (mk: string) => { const [y, m] = mk.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function Timeline({ b }: { b: Project }) {
  const all = useMemo(() => timelineOf(b), [b]);
  const [kind, setKind] = useState<TlKind | 'all'>('all');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(60);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const counts = useMemo(() => { const c: Record<string, number> = { all: all.length }; for (const x of all) c[x.kind] = (c[x.kind] ?? 0) + 1; return c; }, [all]);
  const shown = all.filter(x => (kind === 'all' || x.kind === kind)
    && (!q.trim() || fold(`${x.title} ${x.text ?? ''} ${x.tag ?? ''}`).includes(fold(q.trim()))));
  const page = shown.slice(0, limit);
  const months: [string, { x: TlItem; i: number }[]][] = [];
  page.forEach((x, i) => { const mk = x.date.slice(0, 7); if (months[months.length - 1]?.[0] !== mk) months.push([mk, []]); months[months.length - 1][1].push({ x, i }); });
  // stretches of months with nothing in SETENA are shown too (full, unfiltered view): that is what the tracker is for
  const full = kind === 'all' && !q.trim();
  type Row = { mk: string; items: { x: TlItem; i: number }[] } | { gap: [string, string]; n: number };
  const rows: Row[] = [];
  const gap = (newer: string, older: string) => { // months strictly between `newer` and `older`
    const from = prevMonth(newer); if (from <= older) return;
    let n = 0, k = from; while (k > older) { n++; k = prevMonth(k); }
    rows.push({ gap: [nextMonth(older), from], n });
  };
  if (full && months.length) gap(nextMonth(todayISO().slice(0, 7)), months[0][0]);
  months.forEach(([mk, items], j) => { if (full && j) gap(months[j - 1][0], mk); rows.push({ mk, items }); });

  return (
    <div className="tl">
      <div className="tl-tools">
        {KINDS.filter(k => k.id === 'all' || counts[k.id]).map(k => (
          <button type="button" key={k.id} className={`fchip ${kind === k.id ? 'on' : ''}`} onClick={() => { setKind(k.id); setLimit(60); setOpen(new Set()); }}>{k.n} <b>{counts[k.id] ?? 0}</b></button>
        ))}
        <span className="grow" />
        <input className="modal-input" placeholder="Buscar en la historia…" value={q} onChange={e => { setQ(e.target.value); setLimit(60); setOpen(new Set()); }} />
      </div>
      {shown.some(x => !x.exact) && <p className="tl-note">≈ = marcada sin guardar la fecha: se muestra el día que tocaba.</p>}
      {!shown.length && <p className="tl-empty">{all.length ? 'Nada coincide con el filtro.' : 'Todavía no hay historia. Marca tareas o usa «📥 Descargar todo de SETENA» para traer las anotaciones.'}</p>}
      {rows.map(r => 'gap' in r ? (
        <div key={'g' + r.gap[0]} className="tl-gap"><span>{r.n === 1 ? monthNameOf(r.gap[0]) : `${monthNameOf(r.gap[0])} – ${monthNameOf(r.gap[1])}`}</span> sin nada registrado (ni en SETENA ni en la app){r.n > 1 ? ` (${r.n} meses)` : ''}</div>
      ) : (
        <section key={r.mk}>
          <div className="tl-month">{monthNameOf(r.mk)}</div>
          <div className="tl-list">
            {r.items.map(({ x, i }) => {
              const long = (x.text ?? '').length > 220 || (x.text ?? '').split('\n').length > 3;
              return (
                <div key={i} className={`tl-item k-${x.kind}`}>
                  <span className="tl-dot">{ICON[x.kind]}</span>
                  <span className={`tl-date ${x.exact ? '' : 'approx'}`} title={x.exact ? undefined : 'Se marcó sin guardar la fecha: se muestra el día que tocaba'}>{x.exact ? '' : '≈ '}{shortDate(x.date)}</span>
                  <div className="tl-body">
                    <b>{x.title}</b>{x.tag && <span className="tl-tag">{x.tag}</span>}
                    {x.text && <p className={long && !open.has(i) ? 'clip' : ''} title={long && !open.has(i) ? 'Clic para ver todo' : undefined}
                      onClick={() => long && setOpen(s => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })}>{x.text}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
      {shown.length > limit && <button type="button" className="btn sm tl-more" onClick={() => setLimit(l => l + 60)}>Ver más ({shown.length - limit} restantes)</button>}
    </div>
  );
}
