// ===== Project tab «🌐 SETENA»: every SETENA entry next to what the app tracks for it, 1 to 1 (v70) =====
import { useMemo, useState } from 'react';
import type { Project } from '../lib/types';
import { setenaItems, appOnly } from '../lib/setenaMatch';
import { mutate, deliveryOf } from '../lib/store';
import { toast } from './core';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const d3 = (iso: string) => `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;

/** Removes a mark the app has but SETENA doesn't show (the user decides; one item or all). */
function unmark(b: Project, keys: { key: string; label: string }[]) {
  mutate(d => {
    const x = d.projects.find(y => y.id === b.id);
    if (!x) return;
    for (const { key, label } of keys) {
      const e = deliveryOf(x, key);
      x.deliveries = x.deliveries ?? {};
      if (key.startsWith('m:')) {
        const mk = key.slice(2);
        if (/^Bitácora/.test(label)) { x.uploads = x.uploads.filter(m => m !== mk); x.deliveries[key] = { ...e, uploaded: null }; }
        else { x.visits = x.visits.filter(m => m !== mk); x.deliveries[key] = { ...e, visit: null }; }
      } else {
        x.regencias = x.regencias.filter(r => r !== key.slice(2));
        x.deliveries[key] = { ...e, uploaded: null, received: null };
      }
    }
  });
  toast(keys.length === 1 ? 'Marca quitada' : `${keys.length} marcas quitadas`, true);
}

export function SetenaMatch({ b }: { b: Project }) {
  const items = useMemo(() => setenaItems(b), [b]);
  const only = useMemo(() => appOnly(b, items), [b, items]);
  const [all, setAll] = useState(false);
  const [q, setQ] = useState('');
  const links = items.flatMap(i => i.links), bad = links.filter(l => !l.ok).length;
  const shown = items.filter(i => !q || `${i.text} ${i.docs.map(x => x.label).join(' ')} ${i.author}`.toLowerCase().includes(q.toLowerCase()));
  const list = all || q ? shown : shown.slice(0, 25);
  const exact = items.some(i => i.exact);
  return (
    <div className="sm">
      <div className="sm-sum">
        <span><b>{items.length}</b> anotaciones en SETENA</span>
        <span className={bad ? 'bad' : 'good'}>{bad ? `⚠️ ${bad} sin su pareja en la app` : '✓ todas tienen su pareja en la app'}</span>
        <span className={only.length ? 'bad' : 'good'}>{only.length ? `⚠️ ${only.length} marcada(s) solo en la app` : '✓ nada marcado solo en la app'}</span>
        {!exact && items.length > 0 && <small className="muted">Armado con lo guardado (notas, fotos y PDF por fecha). Con «📥 Descargar todo de SETENA» queda exacto: quién escribió cada anotación y sus archivos.</small>}
      </div>

      {only.length > 0 && (
        <section className="sm-only">
          <h4>Marcado en la app, pero SETENA no lo tiene</h4>
          <p className="muted sm">Puede ser algo hecho y todavía sin subir, o una marca de más. Si no se hizo en SETENA, quítala.</p>
          {only.map(o => (
            <div key={o.key + o.label} className="sm-only-row">
              <span>{o.label}</span>
              <button type="button" className="btn sm" onClick={() => unmark(b, [o])}>Quitar marca</button>
            </div>
          ))}
          {only.length > 1 && <button type="button" className="btn sm danger" onClick={() => unmark(b, only)}>Quitar las {only.length} marcas</button>}
        </section>
      )}

      <input className="sm-q" placeholder="Buscar en las anotaciones…" value={q} onChange={e => setQ(e.target.value)} />
      <div className="pd-scroll"><table className="pd-table sm-table">
        <thead><tr><th>Fecha</th><th>Anotación en SETENA</th><th>En la app</th></tr></thead>
        <tbody>
          {list.map((i, n) => (
            <tr key={`${i.date}-${n}`} className={i.links.some(l => !l.ok) ? 'sm-bad' : ''}>
              <td className="pd-d"><b>{d3(i.date)}</b>{i.author && <small className="sm-who">{i.mine ? 'Regente' : i.author}</small>}</td>
              <td className="sm-what">
                {i.text && <div className="sm-text">{i.text}</div>}
                <div className="sm-chips">
                  {i.photos > 0 && <span className="chip">📷 {i.photos} foto{i.photos === 1 ? '' : 's'}</span>}
                  {i.docs.map(x => <span key={x.name} className="chip" title={x.name}>📄 {x.label}</span>)}
                  {!i.text && !i.photos && !i.docs.length && <span className="muted">(sin texto ni archivos)</span>}
                </div>
              </td>
              <td className="sm-links">{i.links.map((l, k) => <div key={k} className={l.ok ? 'ok' : 'no'}>{l.ok ? '✓' : '✗'} {l.label}</div>)}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {!all && !q && shown.length > 25 && <button type="button" className="dp-link" onClick={() => setAll(true)}>Ver las {shown.length}</button>}
      {!items.length && <p className="muted sm">Sin anotaciones de SETENA guardadas todavía (📥 Descargar todo de SETENA).</p>}
    </div>
  );
}
