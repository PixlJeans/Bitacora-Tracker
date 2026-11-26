// ===== Everything from the SETENA bitácora portal, without guessing =====
// The «Descargar de SETENA» window reads every bitácora (active and closed) and each entry: date, text and files.
// Here it is copied as it is, by the DATE of each entry:
//  · every file → Proyectos/<Código - Nombre>/<Año>/<MM - Mes>/Fotos (photos) or …/Regencias (PDF / Word),
//    named with that date; without opening date: …/<MM - Mes>/SETENA;
//  · when one day has several entries with documents, the first one is the regencia and the later ones are
//    SETENA's receipt → …/Notas de recibido (also moved there if it was already downloaded into Regencias);
//  · every entry's text → that month's notes («SETENA 12/09/2023: …»);
//  · the start of the project = its first SETENA entry (the bottom of its page): it fills the opening date of
//    projects that don't have one (a date you entered is never changed);
//  · a bitácora that isn't in the app is created with that date;
//  · the status is copied from SETENA (Nueva / Abierta / Solicitud de Cierre; closed → Terminada).
// Running it again only adds what is new (files already on disk are skipped, notes aren't repeated).
import type { AppData, Project, Status } from './types';
import { emptyDelivery } from './types';
import { todayISO, uid } from './dates';
import { isImage, monthFolderOf, setenaTarget } from './folders';

export interface SetenaEvent { date: string; time?: number | null; text: string; files: string[]; author?: string; id?: string | null }
export interface SetenaProject {
  code: string; name: string; status: string; closed?: boolean; url?: string; events: SetenaEvent[];
  avance?: number | null; people?: string[]; participationClosed?: boolean;
}
export interface SetenaRequest { code: string; state: string; date: string }
export interface SetenaManifest { projects: SetenaProject[]; requests?: SetenaRequest[]; readAt?: string }
export interface Download { url: string; folder: string; name: string }
export interface Move { from: string; folder: string }

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
  const moves: Move[] = [];
  const seen = new Set<string>();
  let created = 0, notes = 0, statuses = 0, dates = 0;

  for (const sp of m.projects) {
    const code = sp.code.trim().toUpperCase();
    // oldest first; within a day by the hour (the page lists the newest on top, so without an hour: reversed page order)
    const events = [...(sp.events || [])].map((e, i) => ({ ...e, order: -i })).filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.date))
      .sort((a, c) => a.date.localeCompare(c.date) || ((a.time ?? null) !== null && (c.time ?? null) !== null ? a.time! - c.time! : a.order - c.order));
    const withDocs = (e: SetenaEvent) => e.files.some(u => !isImage(u));
    const firstDocOfDay = new Map<string, SetenaEvent>();
    for (const e of events) if (withDocs(e) && !firstDocOfDay.has(e.date)) firstDocOfDay.set(e.date, e);
    const start = events[0]?.date ?? null;
    let b = d.projects.find(x => x.code.toUpperCase() === code);
    if (!b) {
      b = {
        id: uid(), code, name: sp.name || code, status: statusOf(sp), labelId: d.labels.find(l => l.id === 'pending')?.id ?? d.labels[0]?.id ?? '',
        openedOn: start ?? today, notes: '', uploads: [], visits: [], regencias: [], archived: false, archivedOn: null, entries: [],
        location: null, deliveries: {}, lastUpdated: null, createdOn: today, noOpeningDate: !start
      } as Project;
      d.projects.push(b);
      created++;
    } else {
      if (b.noOpeningDate && start) { b.openedOn = start; b.noOpeningDate = false; dates++; }
      const st = statusOf(sp);
      if (b.status !== st && !b.archived) { b.status = st; statuses++; }
    }
    if (start) b.setenaStart = start;
    // the page's summary: progress, newest entry, people, approval of the request
    const me = (sp.people ?? [])[0]?.replace(/\s*\(.*$/, '').trim().toUpperCase();
    const approved = (m.requests ?? []).filter(r => r.code.trim().toUpperCase() === code && /aprobad/i.test(r.state))
      .map(r => /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(r.date)).filter(Boolean)
      .map(x => `${x![3]}-${x![2].padStart(2, '0')}-${x![1].padStart(2, '0')}`).sort();
    b.setena = {
      avance: typeof sp.avance === 'number' ? sp.avance : null,
      lastEntry: events.length ? events[events.length - 1].date : null,
      entries: events.length,
      people: (sp.people ?? []).slice(0, 20),
      others: [...new Set(events.map(e => (e.author ?? '').trim()).filter(a => a && a.toUpperCase() !== me))].slice(0, 20),
      participationClosed: !!sp.participationClosed,
      approvedOn: approved[approved.length - 1] ?? null,
      readAt: m.readAt ?? today
    };
    if (sp.url) { const u = new URL(sp.url.replace(/&amp;/g, '&'), 'https://bitacora.setena.go.cr/').href; if (u.startsWith('https://bitacora.setena.go.cr/')) b.setenaUrl = u; }
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
        const name = fileName(url, e.date);
        // a document after the day's first one with documents = SETENA's receipt of that regencia
        const receipt = !isImage(name) && firstDocOfDay.get(e.date) !== e;
        const folder = setenaTarget(b, ym, name, receipt);
        downloads.push({ url, folder, name });
        if (receipt && folder.endsWith('/Notas de recibido')) moves.push({ from: `${monthFolderOf(b, ym, 'Regencias')}/${name}`, folder });
      }
    }
  }
  const summary = [created && `${created} bitácora(s) nuevas`, dates && `${dates} fecha(s) de inicio`, statuses && `${statuses} estado(s) actualizados`, notes && `${notes} notas`].filter(Boolean).join(' · ');
  return { downloads, moves, summary };
}
