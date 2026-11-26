// ===== Extracting projects from the text of a SETENA PDF (or pasted text) =====
// Works line by line and tolerates the most common layouts:
//   · table:      "D1-0170-2020   CONDOMINIO VISTA DEL BOSQUE   Abierta"
//   · arrow:      "D1-0170-2020 → CONDOMINIO VISTA DEL BOSQUE"
//   · sections:   a "Solicitud de Cierre" heading followed by the list of projects
//   · names split over two lines (the next line, without a code, continues the name)
// Each result carries `doubts` when something wasn't clear, to review it in the preview.

import type { Status } from './types';

export interface Extracted {
  code: string;
  name: string;
  status: Status;
  detectedStatus: boolean;
  openedOn: string | null;   // opening date if the PDF has it on the same row
  doubts: string[];
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const pad = (n: number | string) => String(n).padStart(2, '0');

/** First date found in the text: 15/01/2026, 15-01-2026, 2026-01-15 or «15 de enero de 2026». */
export function dateOf(txt: string): string | null {
  let m = /\b(\d{1,2})[/.-](\d{1,2})[/.-]((?:19|20)\d{2})\b/.exec(txt);
  if (m && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m = /\b((?:19|20)\d{2})-(\d{1,2})-(\d{1,2})\b/.exec(txt);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  const t = stripAccentsF(txt).toLowerCase();
  m = /\b(\d{1,2})\s+de\s+([a-z]+)\s+(?:de\s+|del\s+)?((?:19|20)\d{2})\b/.exec(t);
  if (m) { const k = MONTHS.indexOf(m[2] === 'setiembre' ? 'septiembre' : m[2]); if (k >= 0) return `${m[3]}-${pad(k + 1)}-${pad(m[1])}`; }
  return null;
}
const stripAccentsF = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const RE_NUM = /\b([A-Z]{1,3}\d{0,2})\s*[-–—‐]\s*(\d{1,6})\s*[-–—‐]\s*((?:19|20)\d{2})\b/gi;
const RE_STATUS = /solicitud\s+de\s+cierre|sol\.?\s*(?:de\s+)?cierre|en\s+cierre|abiertas?|nuevas?/i;

export function normalizeCode(raw: string): string {
  const m = new RegExp(RE_NUM.source, 'i').exec(raw.trim());
  if (!m) return raw.trim().toUpperCase().replace(/\s+/g, '');
  return `${m[1].toUpperCase()}-${m[2].padStart(4, '0')}-${m[3]}`;
}

export const isValidCode = (n: string) => /^[A-Z]{1,3}\d{0,2}-\d{4,6}-(19|20)\d{2}$/.test(n);

export function statusOf(txt: string): Status | null {
  const m = RE_STATUS.exec(txt);
  if (!m) return null;
  const s = m[0].toLowerCase();
  if (s.includes('cierre')) return 'closing';
  if (s.startsWith('nueva')) return 'new';
  return 'open';
}

const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Cleans the name: separators, stray dates, the status and table headings. */
export function cleanName(s: string): string {
  return s
    .replace(new RegExp(RE_STATUS.source, 'gi'), ' ')
    .replace(/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g, ' ')          // fechas 12/03/2020
    .replace(/\b(?:19|20)\d{2}-\d{1,2}-\d{1,2}\b/g, ' ')           // fechas 2020-03-12
    .replace(/\b\d{1,2}\s+de\s+[a-záéíóú]+\s+(?:de\s+|del\s+)?(?:19|20)\d{2}\b/gi, ' ')
    .replace(/\b(?:fecha\s+(?:de\s+)?)?apertura\b|\bfecha\b/gi, ' ')
    .replace(/[→⇒➔|•·;:\t]+/g, ' ')
    .replace(/^\s*[-–—=>]+\s*/, '')
    .replace(/\s*[-–—]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.]+|[\s,.]+$/g, '')
    .trim();
}

const IS_HEADER = (l: string) => {
  const s = stripAccents(l).toLowerCase();
  return /\b(numero|n[º°o]\.?\s*de\s*bitacora|expediente)\b/.test(s) && /\b(proyecto|nombre|estado)\b/.test(s);
};

const NOISE = (l: string) => {
  const s = stripAccents(l).toLowerCase().trim();
  return !s || /^p(agina|ag\.?)\s*\d+/.test(s) || /^\d+\s*(de|\/)\s*\d+$/.test(s) || /^\d+$/.test(s) ||
    /secretaria tecnica nacional ambiental|setena|ministerio de ambiente|^fecha( de)? (impresion|emision|reporte)/.test(s);
};

export function extractProjects(text: string): Extracted[] {
  const lines = text.replace(/\r/g, '').split('\n').map(l => l.replace(/ /g, ' ').trim());
  const out: Extracted[] = [];
  const seen = new Map<string, Extracted>();
  let section: Status | null = null;
  let last = null as Extracted | null;
  let previous = '';   // loose text from the previous line (name written BEFORE the code)

  for (const line of lines) {
    if (!line || NOISE(line) || IS_HEADER(line)) { if (!line) { last = null; previous = ''; } continue; }
    const matches = [...line.matchAll(new RegExp(RE_NUM.source, 'gi'))];

    if (!matches.length) {
      const status = statusOf(line);
      const words = line.split(/\s+/).length;
      // Section heading: "BITÁCORAS ABIERTAS", "Solicitud de Cierre", "Estado: Nueva"
      if (status && words <= 6 && cleanName(line.replace(/bit[aá]coras?|estado|proyectos?/gi, '')).length <= 3) {
        if (last && !last.detectedStatus && last === out[out.length - 1] && words <= 3 && !/bit[aá]cora/i.test(line)) {
          // status on the line after the project (split cell)
          last.status = status; last.detectedStatus = true; last.doubts = last.doubts.filter(d => !d.startsWith('Estado'));
        } else {
          section = status;
        }
        continue;
      }
      // Name continued on the next line (or the whole name, if the row didn't have it)
      if (last && line.length < 120 && /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(line) && (!last.name || line === line.toUpperCase())) {
        const extra = cleanName(line);
        if (extra) last.name = (last.name + ' ' + extra).trim();
        if (status && !last.detectedStatus) { last.status = status; last.detectedStatus = true; }
        if (!last.openedOn) last.openedOn = dateOf(line);
        previous = '';
      } else {
        previous = line;
      }
      continue;
    }

    matches.forEach((m, i) => {
      const code = `${m[1].toUpperCase()}-${m[2].padStart(4, '0')}-${m[3]}`;
      const init = (m.index ?? 0) + m[0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index ?? line.length : line.length;
      const rest = line.slice(init, end);
      const before = i === 0 ? line.slice(0, m.index) : '';
      const lineStatus = statusOf(rest) ?? statusOf(before);
      const name = cleanName(rest) || cleanName(before) || cleanName(previous);
      const openedOn = dateOf(rest) ?? dateOf(before);
      const doubts: string[] = [];
      if (!name) doubts.push('Sin nombre de proyecto: complétalo');
      if (!lineStatus && !section) doubts.push('Estado no encontrado: se asumió «Abierta»');
      if (!/^D1-/.test(code)) doubts.push('El número no empieza con D1-');

      const prev = seen.get(code);
      if (prev) {               // repeated: fill in whatever is missing
        if (!prev.name && name) prev.name = name;
        if (!prev.openedOn && openedOn) prev.openedOn = openedOn;
        if (!prev.detectedStatus && (lineStatus || section)) { prev.status = (lineStatus || section)!; prev.detectedStatus = true; }
        last = prev;
        return;
      }
      const e: Extracted = {
        code: code, name: name,
        status: lineStatus ?? section ?? 'open',
        detectedStatus: !!(lineStatus || section),
        openedOn: openedOn,
        doubts: doubts
      };
      seen.set(code, e);
      out.push(e);
      last = e;
    });
    previous = '';
  }
  // recompute name doubts (it may have been completed with the next line)
  out.forEach(e => { if (e.name) e.doubts = e.doubts.filter(d => !d.startsWith('Sin nombre')); });
  return out;
}
