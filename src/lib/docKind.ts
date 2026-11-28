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

export type DocKind = 'regencia' | 'receipt' | 'setena' | 'letter' | 'guarantee' | 'photo' | 'foreign' | 'other' | 'notext';

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
  clientSigned?: string;    // regencia: date the client / developer signed it digitally (YYYY-MM-DD)
  clientName?: string;      // …and who («LAURA UREÑA ALFARO»)
  regenteSigned?: string;   // date the regente signed it
  noSig?: boolean;          // regencia read for its signatures, and none could be read
  sigV?: number;            // version of the signature reader that read it (2 = also from the file's signature fields, v61)
  ocr?: number;             // read with OCR (a scan): version of the OCR reader (1 = v68)
  validFrom?: string;       // garantía: «… DEL 10-07-2024 AL 10-07-2025» (only when written like that)
  validTo?: string;
  uploadedIn?: string;      // a regencia found in ANOTHER project's SETENA bitácora (moved here): that project's code
  misfiled?: boolean;       // …and this project's own bitácora has no copy of it (SETENA may not have it here)
  closingRejected?: boolean; // a SETENA notice saying the closing request was NOT accepted
  movedTo?: string;         // this project's file was another project's regencia: moved to that project's folder
}

/** Folder (inside the month) where each kind goes. `null` = leave it where it is. */
export const KIND_FOLDER: Record<DocKind, string | null> = {
  regencia: 'Regencias', receipt: 'Notas de recibido', setena: 'Comunicados SETENA', letter: 'Cartas',
  guarantee: 'Garantía ambiental', photo: 'Fotos', foreign: 'Documentos', other: 'Documentos', notext: null
};
export const KIND_NAME: Record<DocKind, string> = {
  regencia: 'regencia', receipt: 'nota de recibido', setena: 'comunicado de SETENA', letter: 'carta',
  guarantee: 'garantía ambiental', photo: 'foto en PDF', foreign: 'regencia de otro proyecto', other: 'otro documento', notext: 'escaneado (sin texto)'
};

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[ﬁ]/g, 'fi').replace(/\s+/g, ' ').trim();
const codeKey = (c: string) => c.toUpperCase().replace(/\s/g, '');
/** The guarantee: its documents say so plainly; 93015120210010005107 is the MINAE «Garantías ambientales» account. */
const GUARANTEE = /Garantias?\s+Ambiental(?:es)?|Garantia\s+(?:de\s+cumplimiento|EXP\b)|Carta\s+de\s+valor|(?:En)?trada\s+de\s*.alor|MINAE[-\s]*SECRETARIA\s+TECN|Otros\s*valores|Seguro\s+(?:de\s+)?caucion|93015120210010005107/i;

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
    const per = /Peri[o]do(?: de(?:l)?)?(?: (?:Informe|la))?(?: (?:de )?Regenci(?:a|al))?(?: Ambiental)?\s*:?\s*([A-Za-z]+(?: (?:de(?:l)? )?\d{4})?\s*[-–]\s*[A-Za-z]+(?: (?:de(?:l)? )?\d{4})?|[A-Za-z]+ \d{4})/i.exec(head);
    const info: DocInfo = {
      kind: exp && codeKey(exp) !== codeKey(code) ? 'foreign' : 'regencia',
      final: /Final|Consolidado/i.test(head.slice(0, 120)) || undefined,
      ira: ira ? `IRA-${ira[1].toUpperCase()}-${ira[2]}` : undefined,
      expediente: exp, period: per ? per[1].replace(/\s*[-–]\s*/, ' - ') : undefined,
      project: /Proyecto\s*:\s*(.{3,160}?)\s*(?=Expediente|[A-ZÁÉÍÓÚ][a-záéíóúñ]+(?: [a-záéíóúñ]+)?\s*:)/.exec(text.replace(/\s+/g, ' ').slice(0, 2000))?.[1]?.trim() || undefined,
      ...placeOf(text),
      ...signaturesOf(text)
    };
    return JSON.parse(JSON.stringify(info));
  }
  // ---- written BY SETENA: notices, technical reports ----
  // (also its short replies with a link to its portal: «Le informamos que su solicitud de cierre no ha sido aceptada…»)
  if (/^.{0,80}De:\s*Secretaria Tecnica Nacional Ambiental/i.test(head) || /\bINF-TEC-/i.test(head)
    || (/\b(?:portal|bitacora)\.setena\.go\.cr\b/i.test(head) && /\bLe (?:informamos|solicitamos|comunicamos)\b/i.test(head))) {
    return /solicitud de cierre (?:no ha sido aceptada|fue rechazada|no fue aceptada)|(?:rechaz|deneg)\w* (?:la )?solicitud de cierre/i.test(head) ? { kind: 'setena', closingRejected: true } : { kind: 'setena' };
  }
  // ---- the «Garantía ambiental» (the deposit / bond SETENA holds while the project is active): the bond itself
  // («Entrada de valor», «Carta de valor», «Seguro caución»), the transfer to the MINAE guarantees account, or a
  // letter sending its renewal. Before letters: a letter about the guarantee belongs with the guarantee. ----
  if (GUARANTEE.test(t.slice(0, 4000))) {
    const v = /\bDEL\s+(\d{2})[-/](\d{2})[-/](\d{4})\s+AL\s+(\d{2})[-/](\d{2})[-/](\d{4})\b/i.exec(t);
    const ok = (y: string, m: string, d: string) => +m >= 1 && +m <= 12 && +d >= 1 && +d <= 31 && +y > 2000 && +y < 2100;
    const out: DocInfo = { kind: 'guarantee', expediente: exp };
    if (v && ok(v[3], v[2], v[1]) && ok(v[6], v[5], v[4])) { out.validFrom = `${v[3]}-${v[2]}-${v[1]}`; out.validTo = `${v[6]}-${v[5]}-${v[4]}`; }
    return JSON.parse(JSON.stringify(out));
  }
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

/** The regente of this app (Ing. Carlos Alberto Jiménez Pérez): his signature is not the client's. */
const REGENTE = /JIM[EÉ]NEZ\s+(?:JIM[EÉ]NEZ\s+)?P[EÉ]REZ/i;

/** Digital signatures of a regencia («Firmado digitalmente por NOMBRE (FIRMA) Fecha: 2026.02.27 …»). The PDF text
 *  comes jumbled (names repeated, split around «(FIRMA)»), so each «Fecha:» is paired with the «(FIRMA)» just
 *  before it: the regente's (Jiménez Pérez) or the client's (anyone else). The client's earliest date is kept. */
export function signaturesOf(text: string): Pick<DocInfo, 'clientSigned' | 'clientName' | 'regenteSigned' | 'noSig' | 'sigV'> {
  const flat = text.normalize('NFC').replace(/\s+/g, ' ');
  const out: Pick<DocInfo, 'clientSigned' | 'clientName' | 'regenteSigned' | 'noSig' | 'sigV'> = {};
  let from = 0;
  for (const m of flat.matchAll(/Fecha:\s*(\d{4})\.(\d{2})\.(\d{2})/g)) {
    const seg = flat.slice(from, m.index!);
    from = m.index! + m[0].length;
    const at = seg.lastIndexOf('(FIRMA)');
    if (at < 0) continue;
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    const tail = seg.slice(Math.max(0, at - 70), seg.length);
    if (REGENTE.test(tail)) { if (!out.regenteSigned || date < out.regenteSigned) out.regenteSigned = date; continue; }
    if (out.clientSigned && out.clientSigned <= date) continue;
    // the name: capital words right before «(FIRMA)», repeated words removed
    const words = (/((?:[A-ZÁÉÍÓÚÑÜ]{2,}\s+){1,8})\(FIRMA\)\s*$/.exec(seg.slice(0, at + 7))?.[1] ?? '').trim().split(/\s+/)
      .filter(w => !/^(FIRMADO|DIGITALMENTE|POR|FECHA)$/.test(w));
    const name = words.filter((w, i) => words.indexOf(w) === i).join(' ');
    out.clientSigned = date;
    if (name) out.clientName = name;
  }
  // the other stamp of Costa Rica's digital signature: «NAME (FIRMA) PERSONA FISICA, CPF-… Fecha declarada: 07/11/2023»
  for (const m of flat.matchAll(/((?:[A-ZÁÉÍÓÚÑÜ]{2,}\s+){1,8})\(FIRMA\)\s*PERSONA (?:FISICA|FÍSICA|JURIDICA|JURÍDICA)[^]{0,60}?Fecha declarada:\s*(\d{2})\/(\d{2})\/(\d{4})/g)) {
    const date = `${m[4]}-${m[3]}-${m[2]}`, name = m[1].trim().split(/\s+/).filter((w, i, a) => a.indexOf(w) === i).join(' ');
    if (REGENTE.test(name)) { if (!out.regenteSigned || date < out.regenteSigned) out.regenteSigned = date; continue; }
    if (!out.clientSigned || date < out.clientSigned) { out.clientSigned = date; out.clientName = name; }
  }
  out.sigV = 3;
  if (!out.clientSigned && !out.regenteSigned) out.noSig = true;
  return out;
}
