// ===== Locations: distance, reading coordinates and groups of nearby projects =====
import type { Project } from './types';

export interface Point { lat: number; lng: number }

/** Distance in km (haversine formula). */
export function distanceKm(a: Point, b: Point): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const kmTxt = (km: number) => km < 1 ? `${Math.round(km * 1000)} m` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;

/** Reads coordinates from whatever is pasted: «9.9325, -84.0795», a Google Maps or Waze link. */
export function parseCoordinates(txt: string): Point | null {
  const s = decodeURIComponent(String(txt || '').trim());
  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,                 // google maps: lugar exacto
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,                  // google maps: map center
    /[?&](?:q|query|ll|destination|daddr)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/, // ?q=lat,lng
    /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/ // «9.93, -84.07»
  ];
  for (const p of patterns) {
    const m = p.exec(s);
    if (!m) continue;
    const lat = Number(m[1]), lng = Number(m[2]);
    if (isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat || lng)) return { lat, lng };
  }
  return null;
}

export const mapLink = (p: Point) => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;

/** Google Maps route from the current location through the points in order (max. 10). */
export function routeLink(points: Point[], origin?: Point | null, back = false): string {
  const ll = (p: Point) => `${p.lat},${p.lng}`;
  // Google Maps takes up to 9 stops in between
  const stops = points.slice(0, back && origin ? 9 : 10).map(ll);
  const destination = back && origin ? ll(origin) : stops.pop()!;
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving${origin ? `&origin=${encodeURIComponent(ll(origin))}` : ''}`
    + `&destination=${encodeURIComponent(destination)}${stops.length ? `&waypoints=${encodeURIComponent(stops.join('|'))}` : ''}`;
}

/** Nearest-neighbour order starting from `start` (home), then 2-opt to remove crossings. */
export function planRoute<T extends { b: Project }>(l: T[], start?: Point | null, back = false): T[] {
  const pts = l.filter(x => x.b.location);
  if (pts.length < 2) return pts;
  const remaining = [...pts], out: T[] = [];
  let cur: Point = start ?? remaining[0].b.location!;
  if (!start) out.push(remaining.shift()!);
  while (remaining.length) {
    let k = 0, best = Infinity;
    remaining.forEach((x, i) => { const dd = distanceKm(cur, x.b.location!); if (dd < best) { best = dd; k = i; } });
    const nx = remaining.splice(k, 1)[0]; out.push(nx); cur = nx.b.location!;
  }
  // 2-opt
  const len = (r: T[]) => routeKm(r.map(x => x.b.location!), start, back);
  let improved = true;
  for (let guard = 0; improved && guard < 50; guard++) {
    improved = false;
    for (let i = 0; i < out.length - 1; i++)
      for (let j = i + 1; j < out.length; j++) {
        const cand = [...out.slice(0, i), ...out.slice(i, j + 1).reverse(), ...out.slice(j + 1)];
        if (len(cand) + 1e-9 < len(out)) { out.splice(0, out.length, ...cand); improved = true; }
      }
  }
  return out;
}

/** Straight-line length of a route (km), from `start` and back to it if asked. */
export function routeKm(points: Point[], start?: Point | null, back = false): number {
  const all = [...(start ? [start] : []), ...points, ...(start && back ? [start] : [])];
  let t = 0;
  for (let i = 1; i < all.length; i++) t += distanceKm(all[i - 1], all[i]);
  return t;
}

/** Orders the stops: starts with the first (most urgent) and then always goes to the nearest one. */
export function orderRoute<T extends { b: Project }>(l: T[]): T[] {
  if (l.length < 3) return l;
  const remaining = [...l], out = [remaining.shift()!];
  while (remaining.length) {
    const u = out[out.length - 1].b.location!;
    let k = 0, best = Infinity;
    remaining.forEach((x, i) => { const dd = distanceKm(u, x.b.location!); if (dd < best) { best = dd; k = i; } });
    out.push(remaining.splice(k, 1)[0]);
  }
  return out;
}

/** Groups into «trips» the items whose projects are less than `radiusKm` apart (chained).
 *  Items without a location are kept apart. The input order (urgency) is kept inside each group. */
export function groupNearby<T extends { b: Project }>(l: T[], radiusKm: number): { groups: T[][]; withoutLocation: T[] } {
  const withGps = l.filter(x => x.b.location), withoutLocation = l.filter(x => !x.b.location);
  const parent = withGps.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (let i = 0; i < withGps.length; i++)
    for (let j = i + 1; j < withGps.length; j++)
      if (distanceKm(withGps[i].b.location!, withGps[j].b.location!) <= radiusKm) parent[root(j)] = root(i);
  const map = new Map<number, T[]>();
  withGps.forEach((x, i) => { const r = root(i); map.set(r, [...(map.get(r) ?? []), x]); });
  return { groups: [...map.values()], withoutLocation: withoutLocation };
}
