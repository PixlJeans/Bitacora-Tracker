// ===== Lee el texto de un PDF, línea por línea (pdf.js) =====
// Agrupa los fragmentos por su posición vertical para reconstruir las filas de la tabla.
import './polyfills'; // debe ir antes de pdf.js
// Versión "legacy": compatible con el Safari de Macs más antiguos
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { workerSrc } from './pdfWorker';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

interface Frag { str: string; x: number; y: number; h: number }

export async function textoDePdf(data: ArrayBuffer): Promise<string> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const paginas: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const frags: Frag[] = [];
    for (const it of tc.items as any[]) {
      if (typeof it.str !== 'string' || !it.str.trim()) continue;
      const t = it.transform as number[];
      frags.push({ str: it.str, x: t[4], y: t[5], h: Math.abs(t[3]) || 10 });
    }
    // filas: misma línea si la diferencia vertical es menor que media altura de letra
    frags.sort((a, b) => b.y - a.y || a.x - b.x);
    const filas: Frag[][] = [];
    for (const f of frags) {
      const fila = filas.find(r => Math.abs(r[0].y - f.y) < Math.max(3, r[0].h * 0.5));
      if (fila) fila.push(f); else filas.push([f]);
    }
    filas.sort((a, b) => b[0].y - a[0].y);
    paginas.push(filas.map(r => r.sort((a, b) => a.x - b.x).map(f => f.str.trim()).join('  ')).join('\n'));
  }
  return paginas.join('\n\n');
}
