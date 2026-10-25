// Vite copia el worker de pdf.js al build y devuelve su URL.
// Se usa la versión "legacy" de pdf.js: incluye polyfills para Safari antiguo (Macs sin macOS 14.4+).
// @ts-ignore - sufijo ?url de Vite
import url from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
export const workerSrc: string = url;
