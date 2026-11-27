// ===== Closing a project («Solicitud de Cierre») =====
// What JeanP's dad explained (2026-11-27):
//  1. To close a project the regente makes a FINAL regencia («Informe Final Consolidado»): the same steps as any
//     regencia (Elaboración → Firma del cliente → Subir → Nota de recibido). It goes with the «Solicitud de Cierre».
//  2. SETENA approves the closing request.
//  3. Only then the «Garantía ambiental» (a check the state asks for while the project is active) is returned to
//     the owner: «Devolución de garantía ambiental».
// Steps 1 come from the project's PDFs (no guessing: a regencia PDF whose cover says Final / Consolidado). Steps 2
// and 3 are checked by hand; step 2 is also set when SETENA itself closes the project (setenaImport).
import type { Project, Closure, ClosureStep } from './types';

export const CLOSURE_STEPS: { id: ClosureStep; name: string; icon: string }[] = [
  { id: 'letter', name: 'Informe final: elaboración', icon: '✉️' },
  { id: 'signed', name: 'Firma del cliente', icon: '🖊️' },
  { id: 'uploaded', name: 'Informe final subido a SETENA', icon: '📤' },
  { id: 'received', name: 'Nota de recibido', icon: '🧾' },
  { id: 'approved', name: 'Cierre aprobado por SETENA', icon: '✅' },
  { id: 'guarantee', name: 'Garantía ambiental devuelta al propietario', icon: '💵' }
];

const dateOf = (file: string) => /^(\d{4}-\d{2}-\d{2})_/.exec(file)?.[1] ?? null;
const min = (a: string | null, c: string | null) => (!a ? c : !c ? a : a < c ? a : c);

/** Closure steps read from the project's PDFs. */
export function closureFromDocs(b: Project): Partial<Record<ClosureStep, string>> {
  let uploaded: string | null = null, signed: string | null = null;
  for (const [file, x] of Object.entries(b.docs ?? {})) {
    if (x.kind !== 'regencia' || !x.final) continue;
    uploaded = min(uploaded, dateOf(file));
    if (x.clientSigned) signed = min(signed, x.clientSigned);
  }
  if (!uploaded) return {};
  if (signed && signed > uploaded) signed = uploaded;
  let received: string | null = null;
  for (const [file, x] of Object.entries(b.docs ?? {})) {
    const d = dateOf(file);
    if (x.kind === 'receipt' && d && d >= uploaded && d <= addDaysISO(uploaded, 45)) received = min(received, d);
  }
  const out: Partial<Record<ClosureStep, string>> = { letter: signed ?? uploaded, uploaded };
  if (signed) out.signed = signed;
  if (received) out.received = received;
  return out;
}

function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** All closure steps: what was checked by hand wins (null = unchecked by hand), then the PDFs. */
export function closureOf(b: Project): Record<ClosureStep, string | null> {
  const auto = closureFromDocs(b), own: Closure = b.closure ?? {};
  const out = {} as Record<ClosureStep, string | null>;
  for (const s of CLOSURE_STEPS) out[s.id] = s.id in own ? own[s.id] ?? null : auto[s.id] ?? null;
  return out;
}

/** The project is in the closing process: Solicitud de Cierre, or Terminada while the guarantee is still out. */
export function inClosure(b: Project): boolean {
  if (b.archived) return false;
  if (b.status === 'closing') return true;
  return b.status === 'finished' && !!b.closure && !closureOf(b).guarantee;
}

export const closureComplete = (b: Project) => !!closureOf(b).guarantee;

/** What is missing next to close it (null when the guarantee is back). */
export function closureNext(b: Project): { step: ClosureStep; text: string; wait?: boolean } | null {
  const c = closureOf(b);
  if (!c.uploaded) return { step: c.signed ? 'uploaded' : c.letter ? 'signed' : 'letter',
    text: c.signed ? 'Subir el informe final de regencia a SETENA' : c.letter ? 'Informe final: falta la firma del cliente' : 'Hacer el informe final de regencia (para cerrar)' };
  if (!c.approved) return { step: 'approved', text: 'Esperando que SETENA apruebe el cierre', wait: true };
  if (!c.guarantee) return { step: 'guarantee', text: 'Devolución de la garantía ambiental al propietario' };
  return null;
}

// ===== The guarantee and SETENA's answers, read from the project's documents (v68) =====
const fileDate = (n: string) => /^(\d{4}-\d{2}-\d{2})_/.exec(n)?.[1] ?? '';

/** The guarantee documents of a project (bond, transfer, renewal letter), newest first, and the latest validity read. */
export function guaranteeOf(b: Project): { docs: { name: string; date: string; validTo?: string }[]; validTo: string | null } {
  const docs = Object.entries(b.docs ?? {}).filter(([, x]) => x.kind === 'guarantee')
    .map(([name, x]) => ({ name, date: fileDate(name), validTo: x.validTo })).sort((a, c) => c.date.localeCompare(a.date));
  const withTo = docs.filter(x => x.validTo).sort((a, c) => c.validTo!.localeCompare(a.validTo!))[0];
  return { docs, validTo: withTo?.validTo ?? null };
}

export interface FileAlert { b: Project; date: string; text: string; kind: 'misfiled' | 'closingRejected' }
/** Things the documents show that need doing: a regencia uploaded in another project's bitácora (and missing in its
 *  own), a closing request SETENA did not accept (newest document of the project about it). */
export function fileAlerts(projects: Project[]): FileAlert[] {
  const out: FileAlert[] = [];
  for (const b of projects) {
    if (b.archived) continue;
    for (const [name, x] of Object.entries(b.docs ?? {})) {
      if (x.kind === 'regencia' && x.misfiled && x.uploadedIn)
        out.push({ b, date: fileDate(name), kind: 'misfiled', text: `La regencia${x.ira ? ' ' + x.ira : ''}${x.period ? ` (${x.period})` : ''} se subió en la bitácora de ${x.uploadedIn}, no en la de este proyecto` });
    }
    const rej = Object.entries(b.docs ?? {}).filter(([, x]) => x.closingRejected).map(([n]) => fileDate(n)).sort().pop();
    // not after the project was closed / a later closing step is known
    if (rej && b.status !== 'finished' && !(b.closure?.approved && b.closure.approved >= rej))
      out.push({ b, date: rej, kind: 'closingRejected', text: 'SETENA no aceptó la solicitud de cierre: hay que presentarla formalmente (portal de correspondencia de SETENA)' });
  }
  return out.sort((a, c) => c.date.localeCompare(a.date));
}
