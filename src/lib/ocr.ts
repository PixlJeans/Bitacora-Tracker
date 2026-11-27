// ===== Reads SCANNED PDFs (no text inside): OCR of the first page =====
// Some PDFs uploaded to SETENA are photos or scans: a bank transfer screenshot, the guarantee bond, a letter, a
// site photo saved as PDF. pdf.js finds no text in them, so the page is drawn and read with Tesseract (offline:
// the engine and the Spanish data ship inside the app, see vite.config.ts → /tesseract/).
//  · only the printed part of the page is read, enlarged (a small screenshot in the middle of an A4 page);
//  · scans are often upside down / sideways: the page is tried at 0°, 180°, 90° and 270° and the reading with the
//    most real Spanish words wins;
//  · a page that is a dense picture with no words at all = a PHOTO (an inspection photo saved as PDF).
import './polyfills';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { workerSrc } from './pdfWorker';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

export interface OcrResult { text: string; photo: boolean; rotation: number; tries?: string }

const WORDS = /\b(de|la|el|del|los|las|en|por|con|para|proyecto|garantia|setena|fecha|regencia|ambiental)\b/gi;
/** How much a reading looks like real Spanish (OCR of a photo gives letters, but not words). */
export const wordScore = (t: string) => (t.normalize('NFD').replace(/[̀-ͯ]/g, '').match(WORDS) ?? []).length;

let worker: Promise<any> | null = null;
function ocrWorker(): Promise<any> {
  if (!worker) {
    worker = (async () => {
      const { createWorker } = await import('tesseract.js');
      const base = new URL('tesseract/', document.baseURI).href;
      return createWorker('spa', 1, { workerPath: `${base}worker.min.js`, corePath: base, langPath: base, gzip: true, workerBlobURL: false, cacheMethod: 'none' });
    })();
    worker.catch(() => { worker = null; });
  }
  return worker;
}

/** The page drawn about 300 dpi wide, its printed area (bounding box of non-white pixels) and how full it is. */
async function drawPage(data: ArrayBuffer): Promise<{ canvas: HTMLCanvasElement; ink: number }> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  try {
    const page = await doc.getPage(1);
    const v1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(4, 2400 / Math.max(v1.width, 1)) });
    const full = document.createElement('canvas');
    full.width = Math.ceil(vp.width); full.height = Math.ceil(vp.height);
    const ctx = full.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, full.width, full.height);
    await page.render({ canvasContext: ctx, viewport: vp, canvas: full } as any).promise;
    // printed area
    const { data: px } = ctx.getImageData(0, 0, full.width, full.height);
    let x0 = full.width, y0 = full.height, x1 = -1, y1 = -1, dark = 0;
    for (let y = 0; y < full.height; y += 2) for (let x = 0; x < full.width; x += 2) {
      const i = (y * full.width + x) * 4;
      if (px[i] + px[i + 1] + px[i + 2] < 690) { dark++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    const ink = dark / ((full.width / 2) * (full.height / 2));
    if (x1 < 0) return { canvas: full, ink: 0 };
    // crop to it; a small printed area is enlarged to ~2400 px wide (Tesseract reads small text badly)
    const w = x1 - x0 + 1, h = y1 - y0 + 1, k = w < full.width * 0.8 ? Math.min(3, 2400 / w) : 1;
    const out = document.createElement('canvas');
    out.width = Math.round(w * k); out.height = Math.round(h * k);
    const o = out.getContext('2d')!;
    o.fillStyle = '#fff'; o.fillRect(0, 0, out.width, out.height);
    o.drawImage(full, x0, y0, w, h, 0, 0, out.width, out.height);
    return { canvas: out, ink };
  } finally { void doc.destroy(); }
}

function scaled(src: HTMLCanvasElement, maxW: number): HTMLCanvasElement {
  if (src.width <= maxW) return src;
  const c = document.createElement('canvas'), k = maxW / src.width;
  c.width = maxW; c.height = Math.round(src.height * k);
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function rotated(src: HTMLCanvasElement, deg: number): HTMLCanvasElement {
  if (!deg) return src;
  const c = document.createElement('canvas');
  const side = deg % 180 !== 0;
  c.width = side ? src.height : src.width; c.height = side ? src.width : src.height;
  const x = c.getContext('2d')!;
  x.translate(c.width / 2, c.height / 2); x.rotate((deg * Math.PI) / 180); x.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

/** OCR of the first page of a scanned PDF. */
export async function ocrPdf(data: ArrayBuffer): Promise<OcrResult> {
  const { canvas, ink } = await drawPage(data);
  if (ink < 0.002) return { text: '', photo: false, rotation: 0 }; // blank page
  const w = await ocrWorker();
  // 1) which way up: each rotation is read on a smaller copy (fast); the one Tesseract is surest about wins
  const small = scaled(canvas, 1200);
  let deg0 = 0, conf0 = -1;
  const tries: string[] = [];
  for (const deg of [0, 180, 90, 270]) {
    const { data: r } = await w.recognize(rotated(small, deg));
    const conf = Number(r.confidence) || 0;
    tries.push(`${deg}:${Math.round(conf)}`);
    if (conf > conf0) { conf0 = conf; deg0 = deg; }
    if (conf >= 75) break; // clearly readable: no need to turn it
  }
  // 2) a dense picture (ink all over the page) where nothing could be read with confidence: a photo
  if (conf0 < 48 && ink > 0.5) return { text: '', photo: true, rotation: 0, tries: `${tries.join(' ')} ink ${ink.toFixed(2)}` };
  // 3) the real reading, full size, that way up
  const { data: r } = await w.recognize(rotated(canvas, deg0));
  const best: OcrResult = { text: r.text ?? '', photo: false, rotation: deg0 };
  return { ...best, tries: `${tries.join(' ')} ink ${ink.toFixed(2)} ${canvas.width}x${canvas.height}` };
}
