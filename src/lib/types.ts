// ===== Bitácora Tracker data model =====
// A project (bitácora) ALWAYS has its code + project name together (they never exist apart).
// Deliveries are AUTOMATIC from the opening date: the user only changes the status.

export type Status = 'open' | 'new' | 'closing' | 'finished';

export const STATUSES: { id: Status; name: string; short: string }[] = [
  { id: 'new', name: 'Nueva', short: 'Nueva' },
  { id: 'open', name: 'Abierta', short: 'Abierta' },
  { id: 'closing', name: 'Solicitud de Cierre', short: 'Sol. cierre' },
  { id: 'finished', name: 'Terminada', short: 'Terminada' }
];
export const statusName = (e: Status) => STATUSES.find(x => x.id === e)?.name ?? e;

/** New and Open: monthly Informe Regencial + Regencia every 6 months, always.
 *  Closing request (Solicitud de Cierre): the project has ALREADY finished (SETENA hasn't updated it yet) → no deliveries, same as Finished. */
export const isActiveProject = (b: { status: Status; archived?: boolean }) => (b.status === 'new' || b.status === 'open') && !b.archived;
export const isFinished = (e: Status) => e === 'closing' || e === 'finished';

/** A file saved in <data folder>/proyectos/<code>/ (path relative to the data folder). */
export interface Attachment {
  id: string;
  name: string;
  path: string;
  thumb: string | null;     // miniatura (fotos)
  type: 'photo' | 'pdf' | 'other';
  takenOn?: string | null;  // date the photo was taken (EXIF) YYYY-MM-DD
  lat?: number | null;     // photo GPS (EXIF)
  lng?: number | null;
  role?: 'receipt';         // the «nota de recibido» SETENA sends back for a Regencia
}

/** Project location (to group nearby visits on the same day). */
export interface ProjectLocation {
  lat: number;
  lng: number;
  text: string;           // optional address / landmark
  source: 'manual' | 'photo';
}

// ===== Deliveries: each Informe Regencial (monthly) and each Regencia (every 6 months) =====
// Key: 'm:YYYY-MM' (monthly) or 'r:YYYY-MM-DD' (semiannual, automatic due date).
// Each step stores the DATE it was done (editable) or null if it is still missing.
export type Step = 'visit' | 'photos' | 'letter' | 'uploaded' | 'received';
// Monthly: INSPECCIÓN (site visit, `visit`) and BITÁCORA (presented to SETENA, `uploaded`).
// Regencia (every 6 months): one check, presented (`uploaded`). Photos and letter are supporting material.
export const STEPS: { id: Step; name: string; icon: string; main: boolean }[] = [
  { id: 'visit', name: 'Inspección', icon: '🚗', main: true },
  { id: 'photos', name: 'Fotos', icon: '📷', main: false },
  { id: 'letter', name: 'Carta', icon: '✉️', main: false },
  { id: 'uploaded', name: 'Bitácora', icon: '📋', main: true },
  { id: 'received', name: 'Nota de recibido', icon: '🧾', main: false }
];
export interface Delivery {
  planned: string | null;  // inspection date moved by hand (null = automatic: the opening day)
  due: string | null;    // due date adjusted by hand (null = automatic)
  visit: string | null;
  photos: string | null;
  letter: string | null;    // date the letter was ready
  uploaded: string | null;   // date it was uploaded to SETENA (= submitted)
  received: string | null; // Regencia: SETENA's «nota de recibido» (date)
  letterText: string;      // the letter for SETENA (a template will fill it later)
  notes?: string;          // notes of that month / Regencia
  files: Attachment[];     // photos and documents (letter, PDF) of this delivery, saved in proyectos/<code>/
}
export const emptyDelivery = (): Delivery => ({ planned: null, due: null, visit: null, photos: null, letter: null, uploaded: null, received: null, letterText: '', files: [] });
export const MONTHLY_NAME = 'Bitácora';
export const SEMIANNUAL_NAME = 'Regencia';

/** A log entry of the project, like in the SETENA portal (Escribir / Adjunto). */
export type EntryType = 'visit' | 'regencia' | 'observation' | 'other';
export const ENTRY_TYPES: { id: EntryType; name: string; icon: string }[] = [
  { id: 'visit', name: 'Visita / inspección', icon: '📷' },
  { id: 'regencia', name: 'Regencia (semestral)', icon: '🗂️' },
  { id: 'observation', name: 'Observación', icon: '👁️' },
  { id: 'other', name: 'Otra anotación', icon: '📝' }
];
export interface LogEntry {
  id: string;
  date: string;            // YYYY-MM-DD
  type: EntryType;
  text: string;
  attachments: Attachment[];
  regencia: string | null;   // due date of the Regencia it covers (if the entry is a Regencia)
  uploaded: boolean;          // already uploaded to SETENA
  uploadedOn: string | null;
  source: 'pc' | 'phone';
  batch?: string;            // photos that arrived together from the phone
  createdOn: string;
}

/** Project progress: Pendiente (red) · En proceso (yellow) · Listo (green). Names and colors are editable. */
export interface Label {
  id: string;
  name: string;
  color: string; // #rrggbb
}

/** Summary of a project's page in the SETENA portal. */
export interface SetenaInfo {
  avance: number | null;        // the progress % of the consultant's participation (slider on the page)
  lastEntry: string | null;     // date of the newest entry
  entries: number;              // how many entries
  people: string[];             // participants, «NOMBRE (Activo)» / «NOMBRE (Renuncia)»
  others: string[];             // other people who wrote entries (developer, another consultant…)
  participationClosed: boolean; // «Participación Cerrada»
  approvedOn: string | null;    // date SETENA approved the bitácora request (Solicitudes)
  readAt: string;               // when it was read
}

export interface Project {
  id: string;
  code: string;        // D1-0170-2020
  name: string;        // CONDOMINIO VISTA DEL BOSQUE
  status: Status;
  labelId: string;    // avance
  openedOn: string;      // YYYY-MM-DD: base of ALL deliveries (monthly on the same day; Regencia every 6 months)
  notes: string;
  uploads: string[];   // months with the Informe Regencial uploaded: 'YYYY-MM'
  visits: string[];// months with the visit done: 'YYYY-MM'
  regencias: string[];    // Regencias submitted: automatic due date 'YYYY-MM-DD'
  archived: boolean;
  archivedOn: string | null;
  entries: LogEntry[];
  location?: ProjectLocation | null;
  deliveries?: Record<string, Delivery>;
  lastUpdated: string | null;
  createdOn: string;        // YYYY-MM-DD (added to the app)
  noOpeningDate?: boolean;  // the opening date is unknown (not in the PDF): no deliveries until it is set
  setenaStart?: string;     // date of the first entry in the SETENA bitácora (the bottom of its page)
  setenaUrl?: string;       // its page in the SETENA portal
  setena?: SetenaInfo;      // what its SETENA page says (read with «Descargar todo de SETENA»)
}

/** A saved overall review. */
export interface Review {
  id: string;
  period: string;
  date: string;
  reviewed: string[];
  notes: string;
  summary: { open: number; new: number; closing: number; notUploaded: number };
}

export interface Snoozed {
  key: string;
  at: number;
  title: string;
  body: string;
  kind: ReminderKind;
  ref: string;
}

export interface Settings {
  reminderTime: string;         // 'HH:MM'
  notifications: boolean;
  autoStart: boolean;
  theme: 'dark' | 'light' | 'system';
  accent: string;
  textSize: number;
  csvSeparator: ';' | ',';
  tutorialSeen: boolean;
  radiusKm: number;           // distance to group nearby projects on the same day
  home: { lat: number; lng: number; text: string } | null;  // where the routes start (and end)
  roundTrip: boolean;         // the route goes back to the start point
}

/** A PDF row inside an import reviewed one by one. */
export interface ImportRow {
  code: string;
  name: string;
  status: Status;
  openedOn: string;
  labelId: string;
  doubts: string[];
  existingId: string | null;
  result: 'pending' | 'imported' | 'skipped';
  noDate?: boolean;   // the PDF did not have the opening date
}

/** Import in progress: stored in the data so it can be PAUSED and resumed another day. */
export interface ImportSession {
  file: string;
  startedOn: string;
  i: number;
  rows: ImportRow[];
}

export interface AppData {
  version: 4;
  importSession: ImportSession | null;
  projects: Project[];
  labels: Label[];
  reviews: Review[];
  snoozed: Snoozed[];
  settings: Settings;
}

export type ReminderKind = 'monthly' | 'regencia' | 'semiannual' | 'group' | 'test' | 'visit' | 'weekly';

/** What the native process (Rust) fires as a system notification. */
export interface Reminder {
  key: string;
  at: number;
  until: number;
  title: string;
  body: string;
  kind: ReminderKind;
  ref: string;
}

export const DEFAULT_LABELS: Label[] = [
  { id: 'pending', name: 'Pendiente', color: '#ef4444' },
  { id: 'inProgress', name: 'En proceso', color: '#facc15' },
  { id: 'done', name: 'Listo', color: '#4ade80' }
];
