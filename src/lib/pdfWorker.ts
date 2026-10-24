// Vite copia el worker de pdf.js al build y devuelve su URL.
// @ts-ignore - sufijo ?url de Vite
import url from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
export const workerSrc: string = url;
