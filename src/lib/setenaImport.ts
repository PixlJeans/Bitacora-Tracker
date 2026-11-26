// ===== Everything from the SETENA bitácora portal, without guessing =====
// The «Descargar de SETENA» window reads every bitácora (active and closed) and each entry: date, text and files.
// Here it is copied as it is, by the DATE of each entry:
//  · every file → Proyectos/<Código - Nombre>/<Año>/<MM - Mes>/SETENA/  (named with that date);
//  · every entry's text → that month's notes («SETENA 12/09/2023: …»);
//  · a bitácora that isn't in the app is created (with no opening date, to be filled in);
//  · the status is copied from SETENA (Nueva / Abierta / Solicitud de Cierre; closed → Terminada).
// Nothing is checked and no file is classified: that stays in your hands.
// Running it again only adds what is new (files already on disk are skipped, notes aren't repeated).
import type { AppData, Project, Status } from './types';
import { emptyDelivery } from './types';
import { todayISO, uid } from './dates';
import { monthFolderOf } from './folders';

export interface SetenaEvent { date: string; text: string; files: string[] }
export interface SetenaProject { code: string; name: string; status: string; closed?: boolean; events: SetenaEvent[] }
export interface SetenaManifest { projects: SetenaProject[]; readAt?: string }
export interface Download { url: string; folder: string; name: string }

const ddmmyyyy = (iso: string) => `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

function statusOf(p: SetenaProject): Status {
  if (p.closed) return 'finished';
  const s = p.status.toLowerCase();
  if (s.includes('nueva')) return 'new';
  if (s.includes('cierre')) return 'closing';
  if (s.includes('cerrad') || s.includes('termin')) return 'finished';
  return 'open';
}

/** File name on disk: «2023-08-28_76aad41f.jpg» (the long SETENA id shortened), or the original name. */
export function fileName(url: string, date: string): string {
  const last = decodeURIComponent(url.split('/').pop() || 'archivo');
  const ext = (last.match(/\.([a-z0-9]{2,5})$/i)?.[1] || 'dat').toLowerCase();
  const guid = last.match(/^([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return guid ? `${date}_${guid[1]}.${ext}` : `${date}_${last}`;
}

/** Applies the portal's data to `d` (inside a mutate). Returns the files to download and a summary. */
export function applySetena(d: AppData, m: SetenaManifest, today = todayISO()) {
  const downloads: Download[] = [];
  const seen = new Set<string>();
  let created = 0, notes = 0, statuses = 0;

  for (const sp of m.projects) {
    const code = sp.code.trim().toUpperCase();
    const events = [...(sp.events || [])].filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.date)).sort((a, c) => a.date.localeCompare(c.date));
    let b = d.projects.find(x => x.code.toUpperCase() === code);
    if (!b) {
      b = {
        id: uid(), code, name: sp.name || code, status: statusOf(sp), labelId: d.labels.find(l => l.id === 'pending')?.id ?? d.labels[0]?.id ?? '',
        openedOn: today, notes: '', uploads: [], visits: [], regencias: [], archived: false, archivedOn: null, entries: [],
        location: null, deliveries: {}, lastUpdated: null, createdOn: today, noOpeningDate: true
      } as Project;
      d.projects.push(b);
      created++;
    } else {
      const st = statusOf(sp);
      if (b.status !== st && !b.archived) { b.status = st; statuses++; }
    }
    for (const e of events) {
      const ym = e.date.slice(0, 7);
      // the entry's text, in that month's notes
      if (e.text) {
        b.deliveries = b.deliveries ?? {};
        const k = `m:${ym}`;
        const dl = b.deliveries[k] ?? (b.deliveries[k] = emptyDelivery());
        if (!(dl.notes ?? '').includes(e.text.slice(0, 60))) {
          dl.notes = [dl.notes, `SETENA ${ddmmyyyy(e.date)}: ${e.text}`].filter(Boolean).join('\n');
          notes++;
        }
      }
      // its files, in that month's SETENA folder
      for (const url of e.files) {
        if (!/^https:\/\/bitacora\.setena\.go\.cr\/documents\//i.test(url) || seen.has(url)) continue;
        seen.add(url);
        downloads.push({ url, folder: monthFolderOf(b, ym, 'SETENA'), name: fileName(url, e.date) });
      }
    }
  }
  const summary = [created && `${created} bitácora(s) nuevas`, statuses && `${statuses} estado(s) actualizados`, notes && `${notes} notas`].filter(Boolean).join(' · ');
  return { downloads, summary };
}
