// Genera los íconos de Tauri desde scripts/icon.svg (alternativa a `npx tauri icon`).
import sharp from 'sharp';
import fs from 'node:fs';
const svg = fs.readFileSync(new URL('./icon.svg', import.meta.url));
const out = new URL('../src-tauri/icons/', import.meta.url);
fs.mkdirSync(out, { recursive: true });
const png = s => sharp(svg, { density: 384 }).resize(s, s).png().toBuffer();
const w = (n, b) => fs.writeFileSync(new URL(n, out), b);
w('32x32.png', await png(32)); w('128x128.png', await png(128)); w('128x128@2x.png', await png(256)); w('icon.png', await png(512));
// ICO con imágenes PNG
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const imgs = await Promise.all(icoSizes.map(png));
const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(imgs.length, 4);
let off = 6 + 16 * imgs.length; const dir = [];
imgs.forEach((b, i) => { const e = Buffer.alloc(16); const s = icoSizes[i];
  e.writeUInt8(s >= 256 ? 0 : s, 0); e.writeUInt8(s >= 256 ? 0 : s, 1); e.writeUInt8(0, 2); e.writeUInt8(0, 3);
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(b.length, 8); e.writeUInt32LE(off, 12); off += b.length; dir.push(e); });
w('icon.ico', Buffer.concat([head, ...dir, ...imgs]));
// ICNS con PNG (ic07 128, ic08 256, ic09 512, ic10 1024, ic11 32@2x... )
const icns = [['icp4', 16], ['icp5', 32], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]];
const parts = await Promise.all(icns.map(async ([t, s]) => { const b = await png(s); const h = Buffer.alloc(8); h.write(t, 0, 'ascii'); h.writeUInt32BE(b.length + 8, 4); return Buffer.concat([h, b]); }));
const body = Buffer.concat(parts); const ih = Buffer.alloc(8); ih.write('icns', 0, 'ascii'); ih.writeUInt32BE(body.length + 8, 4);
w('icon.icns', Buffer.concat([ih, body]));
console.log('íconos listos');
