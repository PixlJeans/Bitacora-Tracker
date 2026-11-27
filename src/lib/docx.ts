// ===== Text of a Word file (.docx) — also when SETENA saved one with a «.pdf» name =====
// A .docx is a ZIP; its text is in word/document.xml. Read with the browser's own inflater (no library).
export const isZip = (b: ArrayBuffer) => { const u = new Uint8Array(b, 0, Math.min(4, b.byteLength)); return u[0] === 0x50 && u[1] === 0x4b && u[2] === 3 && u[3] === 4; };

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new (globalThis as any).DecompressionStream('deflate-raw');
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

/** One file of a ZIP, by name (via the central directory, so sizes are always right). */
async function zipEntry(buf: ArrayBuffer, name: string): Promise<Uint8Array | null> {
  const v = new DataView(buf), u = new Uint8Array(buf);
  let eocd = -1;
  for (let i = u.length - 22; i >= Math.max(0, u.length - 66000); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let n = 0; n < count && p + 46 <= u.length; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) return null;
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nl = v.getUint16(p + 28, true), el = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
    if (dec.decode(u.subarray(p + 46, p + 46 + nl)) === name) {
      const start = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
      const raw = u.subarray(start, start + size);
      return method === 0 ? raw : method === 8 ? inflateRaw(raw) : null;
    }
    p += 46 + nl + el + cl;
  }
  return null;
}

/** Plain text of a .docx (paragraphs on their own lines), or '' if it isn't one. */
export async function docxText(buf: ArrayBuffer): Promise<string> {
  const xml = await zipEntry(buf, 'word/document.xml');
  if (!xml) return '';
  return new TextDecoder().decode(xml)
    .replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, ' ').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}
