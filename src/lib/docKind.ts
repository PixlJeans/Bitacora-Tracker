// ===== What a PDF from SETENA is, read from its own first page (no guessing by date or order) =====
// Seen in the real bitácoras:
//  · «Informe (Final Consolidado) de Regencia Ambiental IRA-I-2024 … Expediente Administrativo: D1-0170-2020 …
//     Periodo de Informe Regencial: Agosto 2023 - Enero 2024»                               → regencia
//  · «Formulario Recepción de Correspondencia», «Confirmación de Ingreso de Correspondencia»,
//    «Correspondencia 02271-2024», the online filing sheet («TRAMITE EN LINEA»)             → nota de recibido
//  · «De: Secretaría Técnica Nacional Ambiental (SETENA)…», «INF-TEC-…» (technical report)   → comunicado de SETENA
//  · «Cartago, 07 de agosto del 2024 … Señores Secretaría Técnica Nacional Ambiental»       → carta del regente
//  · a regencia whose expediente is ANOTHER project's                                       → otro proyecto
//  · scans without text (transfers, guarantees, signed letters)                             → sin texto (not moved)
import { crtmFromText } from './geo';

export type DocKind = 'regencia' | 'receipt' | 'setena' | 'letter' | 'foreign' | 'other' | 'notext';

export interface DocInfo {
  kind: DocKind;
  final?: boolean;          // «Informe Final Consolidado» (closing regencia)
  ira?: string;             // «IRA-I-2024»
  expediente?: string;      // «D1-0170-2020» (as written in the document)
  period?: string;          // «Agosto 2023 - Enero 2024»
  number?: string;          // correspondence number «02271-2024»
  project?: string;         // regencia: the project's name as written on its cover («Proyecto: …»)
  place?: string;           // regencia: «Cartago, El Guarco, Tejar» (Provincia / Cantón / Distrito)
  lat?: number;             // regencia: its «Coordenadas» (CRTM05) converted to latitude / longitude
  lng?: number;
  noPlace?: boolean;        // regencia read for its place, and it has none
}

/** Folder (inside the month) where each kind goes. `null` = leave it where it is. */
export const KIND_FOLDER: Record<DocKind, string | null> = {
  regencia: 'Regencias', receipt: 'Notas de recibido', setena: 'Comunicados SETENA', letter: 'Cartas',
  foreign: 'Documentos', other: 'Documentos', notext: null
};
export const KIND_NAME: Record<DocKind, string> = {
  regencia: 'regencia', receipt: 'nota de recibido', setena: 'comunicado de SETENA', letter: 'carta',
  foreign: 'regencia de otro proyecto', other: 'otro documento', notext: 'escaneado (sin texto)'
};

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[ﬁ]/g, 'fi').replace(/\s+/g, ' ').trim();
const codeKey = (c: string) => c.toUpperCase().replace(/\s/g, '');

/** Classifies a document by the text of its first page(s). `code` = the project it was found in. */
export function classifyDoc(text: string, code: string): DocInfo {
  const t = norm(text);
  if (t.replace(/[^A-Za-z]/g, '').length < 40) return { kind: 'notext' };
  const head = t.slice(0, 1500);
  const exp = /Expediente(?: Administrativo)?\s*:?\s*(D\d-\d{3,6}-\d{4})/i.exec(head)?.[1]
    ?? /\b(D\d-\d{3,6}-\d{4})\b/.exec(head)?.[1];
  // ---- SETENA's receipt of something filed (first: it quotes what it received) ----
  if (/Recepcion de Correspondencia|Ingreso de Correspondencia|TRAMITE EN LINEA|Correspondencia \d{4,5}-\d{4}/i.test(head)) {
    const n = /(?:Correspondencia|Secuencia)[^\d]{0,80}?(\d{4,5}-\d{4})/i.exec(head)?.[1] ?? /\b(\d{5}-\d{4})\b/.exec(head)?.[1];
    return JSON.parse(JSON.stringify({ kind: 'receipt', number: n, expediente: exp }));
  }
  // ---- regencia report ----
  // (a receipt also quotes «Informe de Regencia Ambiental IRA-…» as its subject, so the title must OPEN the page)
  if (/^.{0,250}?Informe (?:(?:Final|Consolidado|de|Semestral)\s+){0,3}(?:de\s+)?Regencia Ambiental/i.test(head)) {
    const ira = /\bIRA\s*-\s*([IVX]+)\s*-\s*(\d{4})\b/.exec(head);
    const per = /Peri[o]do(?: de(?:l)?)?(?: (?:Informe|la))?(?: (?:de )?Regenci(?:a|al))?\s*:?\s*([A-Za-z]+(?: (?:de(?:l)? )?\d{4})?\s*[-–]\s*[A-Za-z]+(?: (?:de(?:l)? )?\d{4})?|[A-Za-z]+ \d{4})/i.exec(head);
    const info: DocInfo = {
      kind: exp && codeKey(exp) !== codeKey(code) ? 'foreign' : 'regencia',
      final: /Final|Consolidado/i.test(head.slice(0, 120)) || undefined,
      ira: ira ? `IRA-${ira[1].toUpperCase()}-${ira[2]}` : undefined,
      expediente: exp, period: per ? per[1].replace(/\s*[-–]\s*/, ' - ') : undefined,
      project: /Proyecto\s*:\s*(.{3,160}?)\s*(?=Expediente|[A-ZÁÉÍÓÚ][a-záéíóúñ]+(?: [a-záéíóúñ]+)?\s*:)/.exec(text.replace(/\s+/g, ' ').slice(0, 2000))?.[1]?.trim() || undefined,
      ...placeOf(text)
    };
    return JSON.parse(JSON.stringify(info));
  }
  // ---- written BY SETENA: notices, technical reports ----
  if (/^.{0,80}De:\s*Secretaria Tecnica Nacional Ambiental/i.test(head) || /\bINF-TEC-/i.test(head)) return { kind: 'setena' };
  // ---- letters TO SETENA ----
  if (/Senores\s*(?:de la\s*)?Secretaria Tecnica Nacional Ambiental/i.test(head)) return exp ? { kind: 'letter', expediente: exp } : { kind: 'letter' };
  return { kind: 'other' };
}

/** «Ubicación del Proyecto» of a regencia: Provincia / Cantón / Distrito and its CRTM05 «Coordenadas». */
export function placeOf(text: string): Pick<DocInfo, 'place' | 'lat' | 'lng' | 'noPlace'> {
  const flat = text.replace(/\s+/g, ' ');
  const stop = '(?=\\s+(?:No\\.|Coordenadas|Hoja|Direcci|[ÁA]rea|Plano|Finca|Propietario)|$)';
  const pv = new RegExp(`Provincia\\s*:\\s*(.{2,25}?)\\s+Cant[oó]n\\s*:\\s*(.{2,30}?)\\s+Distrito\\s*:\\s*(.{2,30}?)${stop}`).exec(flat);
  const c = /Coordenadas[^:]{0,20}:?(.{0,110})/i.exec(flat);
  const ll = c ? crtmFromText(c[1]) : null;
  const out: Pick<DocInfo, 'place' | 'lat' | 'lng' | 'noPlace'> = {};
  if (pv) out.place = `${pv[1]}, ${pv[2]}, ${pv[3]}`.trim();
  if (ll) { out.lat = ll.lat; out.lng = ll.lng; }
  if (!pv && !ll) out.noPlace = true;
  return out;
}
