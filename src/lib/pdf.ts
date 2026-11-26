// ===== Reads the text of a PDF, line by line (pdf.js) =====
// Groups the fragments by vertical position to rebuild the table rows.
import './polyfills'; // must come before pdf.js
// "legacy" build: works with the Safari of older Macs
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { workerSrc } from './pdfWorker';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

interface Frag { str: string; x: number; y: number; h: number }

export async function textFromPdf(data: ArrayBuffer, maxPages = Infinity): Promise<string> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const fragments: Frag[] = [];
    for (const it of tc.items as any[]) {
      if (typeof it.str !== 'string' || !it.str.trim()) continue;
      const t = it.transform as number[];
      fragments.push({ str: it.str, x: t[4], y: t[5], h: Math.abs(t[3]) || 10 });
    }
    // rows: same line if the vertical difference is less than half the text height
    fragments.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: Frag[][] = [];
    for (const f of fragments) {
      const row = rows.find(r => Math.abs(r[0].y - f.y) < Math.max(3, r[0].h * 0.5));
      if (row) row.push(f); else rows.push([f]);
    }
    rows.sort((a, b) => b[0].y - a[0].y);
    pages.push(rows.map(r => r.sort((a, b) => a.x - b.x).map(f => f.str.trim()).join('  ')).join('\n'));
  }
  void doc.destroy();
  return pages.join('\n\n');
}
