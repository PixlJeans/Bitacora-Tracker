// ===== Everything from the SETENA bitácora portal, matched to each project =====
// The «Descargar de SETENA» window reads every bitácora (active and closed) and each event: date, text and
// files. Here that is matched to the app's projects:
//  · a project that isn't in the app is created; one without opening date takes its first event's date;
//  · the SETENA status is copied (Nueva / Abierta / Solicitud de Cierre / cerradas → Terminada);
//  · an event in a month = that month's «Llenado de bitácora» done (on the event date);
//  · photos → that month's Fotos folder, and that month's Inspección done;
//  · report PDFs (Tramitación) near a Regencia → that Regencia's folder, «elaborada» and «subida»;
//    other PDFs → the month's Documentos folder; closing PDFs → Cierre;
//  · the event text → that month's notes («SETENA 12/09/2023: …»).
// Nothing is checked twice and files already on disk are skipped, so it can be run again any time.
import type { AppData, Project, Status } from './types';
import { emptyDelivery } from './types';
import { applyStep } from './store';
import { dueInMonth, inspectionDate, regenciaDueDates, regenciaDue } from './schedule';
import { addDays, addMonths, todayISO, uid } from './dates';
import { deliveryFolder, monthFolderOf, projectFolder } from './folders';

export interface SetenaEvent { date: string; text: string; files: string[] }
export interface SetenaProject { code: string; name: string; status: string; closed?: boolean; events: SetenaEvent[] }
export interface SetenaManifest { projects: SetenaProject[]; readAt?: string }
export interface Download { url: string; folder: string; name: string }

const IMG = /\.(jpe?g|png|gif|webp|heic)$/i;
const DAY = 864e5;
const days = (a: string, b: string) => Math.abs(new Date(a + 'T12:00').getTime() - new Date(b + 'T12:00').getTime()) / DAY;
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

/** Monthly key of something done on `date`: that month's, if the project has one then. */
function monthKey(b: Project, date: string): string | null {
  const ym = date.slice(0, 7);
  return dueInMonth(b, ym) ? `m:${ym}` : null;
}

/** Applies the portal's data to `d` (inside a mutate). Returns the files to download and a summary. */
export function applySetena(d: AppData, m: SetenaManifest, today = todayISO()) {
  const downloads: Download[] = [];
  const seen = new Set<string>();
  let created = 0, bitacoras = 0, inspections = 0, regencias = 0, notes = 0, statuses = 0;

  for (const sp of m.projects) {
    const code = sp.code.trim().toUpperCase();
    const events = [...(sp.events || [])].filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.date)).sort((a, c) => a.date.localeCompare(c.date));
    const first = events[0]?.date ?? null;
    let b = d.projects.find(x => x.code.toUpperCase() === code);
    if (!b) {
      b = {
        id: uid(), code, name: sp.name || code, status: statusOf(sp), labelId: d.labels.find(l => l.id === 'pending')?.id ?? d.labels[0]?.id ?? '',
        openedOn: first ?? today, notes: '', uploads: [], visits: [], regencias: [], archived: false, archivedOn: null, entries: [],
        location: null, deliveries: {}, lastUpdated: null, createdOn: today, noOpeningDate: !first
      } as Project;
      d.projects.push(b);
      created++;
    } else {
      if (b.noOpeningDate && first) { b.openedOn = first; b.noOpeningDate = false; }
      const st = statusOf(sp);
      if (b.status !== st && !b.archived) { b.status = st; statuses++; }
    }
    // A finished/closing project still keeps its history: dueInMonth needs it to count as active meanwhile
    const realStatus = b.status;
    if (b.status === 'closing' || b.status === 'finished') b.status = 'open';
    const key = (k: string) => { b!.deliveries = b!.deliveries ?? {}; return b!.deliveries[k] ?? (b!.deliveries[k] = emptyDelivery()); };
    const regs = regenciaDueDates(b, b.openedOn, addMonths(today, 6));

    for (const e of events) {
      const ym = e.date.slice(0, 7);
      const mk = monthKey(b, e.date);
      // Llenado de bitácora
      if (mk && !key(mk).uploaded) { applyStep(b, mk, 'uploaded', e.date); bitacoras++; }
      // Text → the month's notes
      if (e.text && mk) {
        const line = `SETENA ${ddmmyyyy(e.date)}: ${e.text}`;
        const dl = key(mk);
        if (!(dl.notes ?? '').includes(e.text.slice(0, 60))) { dl.notes = [dl.notes, line].filter(Boolean).join('\n'); notes++; }
      }
      for (const url of e.files) {
        if (!/^https:\/\/bitacora\.setena\.go\.cr\/documents\//i.test(url) || seen.has(url)) continue;
        seen.add(url);
        const name = fileName(url, e.date);
        if (IMG.test(url)) {
          // the inspection of that month (it may have been moved), its Fotos folder
          const ik = mk;
          downloads.push({ url, folder: ik && inspectionDate(b, ik.slice(2)).slice(0, 7) === ym ? deliveryFolder(b, ik) : monthFolderOf(b, ym, 'Fotos'), name });
          if (ik && !key(ik).visit) { applyStep(b, ik, 'visit', e.date); applyStep(b, ik, 'photos', e.date); inspections++; }
        } else if (first && e.date <= addDays(first, 31) && !regs.some(r => regenciaDue(b!, r) <= e.date) && /\.(pdf|docx?)$/i.test(url)) {
          // a document in the first month of the bitácora: the Carta de Inicio de obras
          downloads.push({ url, folder: deliveryFolder(b, 's:start'), name });
          if (!key('s:start').uploaded) applyStep(b, 's:start', 'uploaded', e.date);
        } else if (/\/cierre\//i.test(url)) {
          downloads.push({ url, folder: `${projectFolder(b)}/Cierre`, name });
        } else {
          // a report near a Regencia's date (±4 months) is that Regencia
          const near = regs.map(r => ({ r, dd: days(regenciaDue(b!, r), e.date) })).filter(x => x.dd <= 122).sort((a, c) => a.dd - c.dd)[0];
          if (near && /\.(pdf|docx?)$/i.test(url)) {
            const rk = `r:${near.r}`;
            downloads.push({ url, folder: deliveryFolder(b, rk), name });
            const dl = key(rk);
            if (!dl.uploaded) { applyStep(b, rk, 'letter', dl.letter ?? e.date); applyStep(b, rk, 'uploaded', e.date); regencias++; }
          } else downloads.push({ url, folder: monthFolderOf(b, ym, 'Documentos'), name });
        }
      }
    }
    b.status = realStatus;
  }
  const summary = [created && `${created} bitácora(s) nuevas`, statuses && `${statuses} estado(s) actualizados`, bitacoras && `${bitacoras} bitácoras`,
    inspections && `${inspections} inspecciones`, regencias && `${regencias} regencias`, notes && `${notes} notas`].filter(Boolean).join(' · ');
  return { downloads, summary };
}
