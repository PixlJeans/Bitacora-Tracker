// ===== Modelo de datos de Bitácora Tracker =====
// Una bitácora SIEMPRE lleva número + nombre de proyecto juntos (no existen por separado).

export type Estado = 'abierta' | 'nueva' | 'cierre';

export const ESTADOS: { id: Estado; nombre: string; corto: string }[] = [
  { id: 'abierta', nombre: 'Abierta', corto: 'Abierta' },
  { id: 'nueva', nombre: 'Nueva', corto: 'Nueva' },
  { id: 'cierre', nombre: 'Solicitud de Cierre', corto: 'Sol. cierre' }
];
export const estadoNombre = (e: Estado) => ESTADOS.find(x => x.id === e)?.nombre ?? e;

/** Abierta y Nueva generan recordatorio mensual; Solicitud de Cierre no. */
export const generaMensual = (e: Estado) => e === 'abierta' || e === 'nueva';

/** Color de importancia / urgencia (editable en Ajustes). */
export interface Etiqueta {
  id: string;
  nombre: string;
  color: string; // #rrggbb
}

export interface Bitacora {
  id: string;
  numero: string;        // D1-0170-2020
  nombre: string;        // CONDOMINIO VISTA DEL BOSQUE
  estado: Estado;
  etiquetaId: string;
  diaAviso: number;      // 1..28: día del mes del recordatorio mensual
  fechaInicio: string;   // YYYY-MM-DD: desde cuándo se le da seguimiento
  notas: string;
  registros: string[];   // meses ya registrados: 'YYYY-MM'
  ultimaActualizacion: string | null; // YYYY-MM-DD
  creada: string;        // YYYY-MM-DD
}

/** Una revisión semestral hecha (o en curso). */
export interface Revision {
  id: string;
  periodo: string;       // fecha programada de la revisión (YYYY-MM-DD)
  fecha: string;         // cuándo se cerró (YYYY-MM-DD)
  revisados: string[];   // ids de bitácoras marcadas como revisadas
  notas: string;
  resumen: { abiertas: number; nuevas: number; cierre: number; sinRegistro: number };
}

export interface Pospuesto {
  key: string;           // clave del aviso original
  at: number;            // ms: cuándo volver a avisar
  title: string;
  body: string;
  kind: AvisoKind;
  ref: string;
}

export interface Ajustes {
  horaAviso: string;         // 'HH:MM'
  semestralInicio: string;   // YYYY-MM-DD: primera revisión semestral; luego cada 6 meses
  diaAvisoDefecto: number;
  notificaciones: boolean;
  autoInicio: boolean;
  tema: 'dark' | 'light';
  acento: string;
  tamano: number;            // % de escala de la interfaz
  separadorCsv: ';' | ',';
}

export interface Datos {
  version: 1;
  bitacoras: Bitacora[];
  etiquetas: Etiqueta[];
  revisiones: Revision[];
  pospuestos: Pospuesto[];
  ajustes: Ajustes;
}

export type AvisoKind = 'mensual' | 'semestral' | 'grupo' | 'prueba';

/** Lo que el proceso nativo (Rust) dispara como notificación del sistema. */
export interface Aviso {
  key: string;
  at: number;     // ms epoch: a partir de cuándo avisar
  until: number;  // ms epoch: después de esto ya no se avisa (p.ej. fin de mes)
  title: string;
  body: string;
  kind: AvisoKind;
  ref: string;    // id de bitácora o fecha de la revisión semestral
}

export const ETIQUETAS_BASE: Etiqueta[] = [
  { id: 'urgente', nombre: 'Urgente', color: '#ef4444' },
  { id: 'proximo', nombre: 'Pendiente próximo', color: '#facc15' },
  { id: 'aldia', nombre: 'Al día', color: '#4ade80' }
];
