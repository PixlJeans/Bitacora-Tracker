// ===== Modelo de datos de Bitácora Tracker =====
// Una bitácora SIEMPRE lleva número + nombre de proyecto juntos (no existen por separado).
// Las revisiones son AUTOMÁTICAS a partir de la fecha de apertura: el usuario solo cambia el estado.

export type Estado = 'abierta' | 'nueva' | 'cierre' | 'terminada';

export const ESTADOS: { id: Estado; nombre: string; corto: string }[] = [
  { id: 'nueva', nombre: 'Nueva', corto: 'Nueva' },
  { id: 'abierta', nombre: 'Abierta', corto: 'Abierta' },
  { id: 'cierre', nombre: 'Solicitud de Cierre', corto: 'Sol. cierre' },
  { id: 'terminada', nombre: 'Terminada', corto: 'Terminada' }
];
export const estadoNombre = (e: Estado) => ESTADOS.find(x => x.id === e)?.nombre ?? e;

/** Nueva, Abierta y Solicitud de Cierre: revisión mensual + informe cada 6 meses, siempre.
 *  Terminada: ya no genera revisiones (y se puede archivar). */
export const estaActiva = (b: { estado: Estado; archivada?: boolean }) => b.estado !== 'terminada' && !b.archivada;

/** Avance de la bitácora: Pendiente (rojo) · En proceso (amarillo) · Listo (verde). Nombres y colores editables. */
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
  etiquetaId: string;    // avance
  apertura: string;      // YYYY-MM-DD: base de TODAS las revisiones (mensual el mismo día; informe cada 6 meses)
  notas: string;
  registros: string[];   // meses con bitácora llenada: 'YYYY-MM'
  inspecciones: string[];// meses con inspección hecha: 'YYYY-MM'
  informes: string[];    // informes regenciales entregados: fecha de vencimiento 'YYYY-MM-DD'
  archivada: boolean;
  archivadaEl: string | null;
  ultimaActualizacion: string | null;
  creada: string;        // YYYY-MM-DD (alta en la app)
}

/** Un resumen general guardado. */
export interface Revision {
  id: string;
  periodo: string;
  fecha: string;
  revisados: string[];
  notas: string;
  resumen: { abiertas: number; nuevas: number; cierre: number; sinRegistro: number };
}

export interface Pospuesto {
  key: string;
  at: number;
  title: string;
  body: string;
  kind: AvisoKind;
  ref: string;
}

export interface Ajustes {
  horaAviso: string;         // 'HH:MM'
  notificaciones: boolean;
  autoInicio: boolean;
  tema: 'dark' | 'light';
  acento: string;
  tamano: number;
  separadorCsv: ';' | ',';
  tutorialVisto: boolean;
}

/** Una fila del PDF dentro de una importación revisada una por una. */
export interface FilaImportacion {
  numero: string;
  nombre: string;
  estado: Estado;
  apertura: string;
  etiquetaId: string;
  dudas: string[];
  existenteId: string | null;
  resultado: 'pendiente' | 'importada' | 'omitida';
}

/** Importación en curso: se guarda en los datos para poder PAUSARLA y seguir otro día. */
export interface SesionImportacion {
  archivo: string;
  inicio: string;
  i: number;
  filas: FilaImportacion[];
}

export interface Datos {
  version: 3;
  importacion: SesionImportacion | null;
  bitacoras: Bitacora[];
  etiquetas: Etiqueta[];
  revisiones: Revision[];
  pospuestos: Pospuesto[];
  ajustes: Ajustes;
}

export type AvisoKind = 'mensual' | 'informe' | 'semestral' | 'grupo' | 'prueba';

/** Lo que el proceso nativo (Rust) dispara como notificación del sistema. */
export interface Aviso {
  key: string;
  at: number;
  until: number;
  title: string;
  body: string;
  kind: AvisoKind;
  ref: string;
}

export const ETIQUETAS_BASE: Etiqueta[] = [
  { id: 'pendiente', nombre: 'Pendiente', color: '#ef4444' },
  { id: 'proceso', nombre: 'En proceso', color: '#facc15' },
  { id: 'listo', nombre: 'Listo', color: '#4ade80' }
];
