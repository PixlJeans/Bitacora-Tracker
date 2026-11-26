// ===== Minimal EXIF reader (no dependencies) =====
// Gets from a JPEG photo the DATE it was taken and its GPS (if the phone saved it).
// It must be read from the ORIGINAL file: shrinking the photo with canvas drops the EXIF data.
// (iPhone HEIC photos can't be read; when shared, the iPhone usually converts them to JPEG.)

export interface PhotoInfo {
  date: string | null;   // YYYY-MM-DD
  time: string | null;    // HH:MM
  lat: number | null;
  lng: number | null;
}

const EMPTY: PhotoInfo = { date: null, time: null, lat: null, lng: null };

export function readExif(buf: ArrayBuffer): PhotoInfo {
  try {
    const v = new DataView(buf);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return { ...EMPTY };
    let p = 2;
    while (p + 4 <= v.byteLength) {
      const marker = v.getUint16(p);
      if ((marker & 0xff00) !== 0xff00) break;
      const length2 = v.getUint16(p + 2);
      if (marker === 0xffe1 && v.getUint32(p + 4) === 0x45786966 /* 'Exif' */) return tiff(v, p + 10);
      if (marker === 0xffda) break; // image data starts: no more metadata
      p += 2 + length2;
    }
  } catch { /* archivo raro: sin datos */ }
  return { ...EMPTY };
}

function tiff(v: DataView, t: number): PhotoInfo {
  const le = v.getUint16(t) === 0x4949;
  const u16 = (o: number) => v.getUint16(t + o, le);
  const u32 = (o: number) => v.getUint32(t + o, le);
  if (u16(2) !== 42) return { ...EMPTY };

  /** Reads an IFD directory → map tag → {type, n, off(value or pointer)} */
  const ifd = (off: number) => {
    const m = new Map<number, { type: number; n: number; val: number; pos: number }>();
    if (!off || t + off + 2 > v.byteLength) return m;
    const k = u16(off);
    for (let i = 0; i < k; i++) {
      const e = off + 2 + i * 12;
      if (t + e + 12 > v.byteLength) break;
      m.set(u16(e), { type: u16(e + 2), n: u32(e + 4), val: u32(e + 8), pos: e + 8 });
    }
    return m;
  };
  const text = (x?: { n: number; val: number; pos: number }) => {
    if (!x) return '';
    const o = x.n > 4 ? x.val : x.pos;
    let s = '';
    for (let i = 0; i < x.n && t + o + i < v.byteLength; i++) { const c = v.getUint8(t + o + i); if (!c) break; s += String.fromCharCode(c); }
    return s;
  };
  const rationals = (x?: { n: number; val: number }) => {
    if (!x) return null;
    const out: number[] = [];
    for (let i = 0; i < x.n; i++) { const d = u32(x.val + i * 8 + 4); out.push(d ? u32(x.val + i * 8) / d : 0); }
    return out;
  };

  const ifd0 = ifd(u32(4));
  const exif = ifd(ifd0.get(0x8769)?.val ?? 0);
  const gps = ifd(ifd0.get(0x8825)?.val ?? 0);

  const res: PhotoInfo = { ...EMPTY };
  const dt = text(exif.get(0x9003)) || text(exif.get(0x9004)) || text(ifd0.get(0x0132));
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/.exec(dt);
  if (m && m[1] !== '0000') { res.date = `${m[1]}-${m[2]}-${m[3]}`; res.time = `${m[4]}:${m[5]}`; }

  const gLat = rationals(gps.get(2)), gLng = rationals(gps.get(4));
  if (gLat && gLng && gLat.length >= 3 && gLng.length >= 3) {
    const degrees = (a: number[]) => a[0] + a[1] / 60 + a[2] / 3600;
    let lat = degrees(gLat), lng = degrees(gLng);
    if (text(gps.get(1)).toUpperCase() === 'S') lat = -lat;
    if (text(gps.get(3)).toUpperCase() === 'W') lng = -lng;
    if ((lat || lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) { res.lat = +lat.toFixed(6); res.lng = +lng.toFixed(6); }
  }
  return res;
}

/** Reads the data of a browser File (JPEG only; anything else returns empty). */
export async function photoInfo(f: Blob): Promise<PhotoInfo> {
  if (f.type && !/jpe?g/i.test(f.type)) return { ...EMPTY };
  try { return readExif(await f.slice(0, 256 * 1024).arrayBuffer()); } catch { return { ...EMPTY }; }
}

/** Most repeated date among several photos (the visit date). */
export function commonDate(l: PhotoInfo[]): string | null {
  const n = new Map<string, number>();
  l.forEach(x => x.date && n.set(x.date, (n.get(x.date) ?? 0) + 1));
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

/** Midpoint of the photos with GPS. */
export function gpsComun(l: PhotoInfo[]): { lat: number; lng: number } | null {
  const c = l.filter(x => x.lat !== null && x.lng !== null);
  if (!c.length) return null;
  return { lat: +(c.reduce((s, x) => s + x.lat!, 0) / c.length).toFixed(6), lng: +(c.reduce((s, x) => s + x.lng!, 0) / c.length).toFixed(6) };
}
