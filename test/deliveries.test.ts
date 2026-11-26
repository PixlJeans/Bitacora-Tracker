// Tests: adjustable dates, sorting by date, EXIF reader and grouping by distance
import assert from 'node:assert';
import { normalize, applyStep, emptyData, fileLogIntoDeliveries } from '../src/lib/store';
import { agenda, completeIn, monthlyDue, regenciaInMonth, nextDue, nextRegencia, computeReminders, inspectionDeadline, sortDate, pendingOf } from '../src/lib/schedule';
import { readExif, commonDate, gpsComun } from '../src/lib/exif';
import { groupNearby, distanceKm, routeLink, parseCoordinates } from '../src/lib/geo';

// ---------- fechas ajustables ----------
const base = { createdOn: '2026-01-15', uploads: [], visits: [], regencias: [] };
const d = normalize({
  projects: [
    { ...base, id: 'a', code: 'D1-0001-2026', name: 'A', status: 'open', openedOn: '2026-01-15',
      location: { lat: 9.93, lng: -84.08 },
      deliveries: { 'm:2026-06': { due: '2026-06-20', letterText: 'Hola' }, 'r:2026-07-15': { due: '2026-07-30' }, 'basura': {} } },
    { ...base, id: 'b', code: 'D1-0002-2026', name: 'B', status: 'open', openedOn: '2026-01-03', location: { lat: 9.95, lng: -84.10 } },
    { ...base, id: 'c', code: 'D1-0003-2026', name: 'C', status: 'open', openedOn: '2026-01-10', location: { lat: 10.63, lng: -85.44 } },
    { ...base, id: 'e', code: 'D1-0004-2026', name: 'E', status: 'new', openedOn: '2026-01-25', location: { lat: 999, lng: 0 } }
  ]
});
const [a, b, c, e] = d.projects;
assert.deepEqual(Object.keys(a.deliveries!), ['m:2026-06', 'r:2026-07-15'], 'invalid keys dropped');
assert.equal(a.deliveries!['m:2026-06'].letterText, 'Hola');
assert.equal(e.location, null, 'impossible coordinates are dropped');
assert.equal(monthlyDue(a, '2026-06'), '2026-06-20', 'adjusted monthly date');
assert.equal(monthlyDue(a, '2026-05'), '2026-05-15', 'the rest stay automatic');
const regInfo = nextRegencia(a, '2026-06-10')!;
assert.equal(regInfo.key, '2026-07-15'); assert.equal(regInfo.due, '2026-07-30'); assert.equal(regInfo.from, '2026-06-30');
assert.equal(regenciaInMonth(a, '2026-07'), '2026-07-15');

// ---------- pasos ----------
applyStep(a, 'm:2026-06', 'visit', '2026-06-12');
assert(a.visits.includes('2026-06') && !completeIn(a, '2026-06'));
applyStep(a, 'm:2026-06', 'uploaded', '2026-06-18');
assert(completeIn(a, '2026-06'), 'visit + upload = complete');
applyStep(a, 'r:2026-07-15', 'uploaded', '2026-07-29');
assert(a.regencias.includes('2026-07-15'));
assert.equal(nextRegencia(a, '2026-06-10')!.key, '2027-01-15');
applyStep(a, 'm:2026-06', 'uploaded', null);
assert(!completeIn(a, '2026-06') && a.deliveries!['m:2026-06'].uploaded === null);

// ---------- priority by date ----------
const today = '2026-06-10';
const ag = agenda(d, today, '2026-07-31');
assert(ag.every((x, i) => i === 0 || sortDate(ag[i - 1]) <= sortDate(x)), 'agenda sorted by inspection / informe date');
assert.equal(ag[0].date, '2026-03-03', 'overdue first (B, day 3, up to 3 months back)');
assert(ag[0].overdue);
assert.equal(nextDue(c, today)!.date, '2026-03-10', 'the most overdue one not done');
// reminders use the adjusted date and the original key
const av = computeReminders(d, new Date(2026, 5, 10, 12).getTime());
const am = av.find(x => x.key === 'm:a:2026-06')!;
assert.equal(new Date(am.at).getDate(), 20);

// ---------- EXIF ----------
function jpegWithExif(date: string, lat: number[], latRef: string, lng: number[], lngRef: string) {
  const tiff: number[] = [];
  const w16 = (v: number) => tiff.push(v & 255, (v >> 8) & 255);
  const w32 = (v: number) => tiff.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
  // cabecera II*  + IFD0 en 8
  tiff.push(0x49, 0x49); w16(42); w32(8);
  // IFD0: 2 entradas (ExifIFD 0x8769, GPS 0x8825) → 2+24+4 = 30 bytes → termina en 38
  const exifOff = 38, gpsOff = exifOff + 2 + 12 + 4; // ExifIFD: 1 entrada → 18 bytes → 56
  w16(2);
  w16(0x8769); w16(4); w32(1); w32(exifOff);
  w16(0x8825); w16(4); w32(1); w32(gpsOff);
  w32(0);
  // ExifIFD with DateTimeOriginal (ASCII, 20 bytes) pointing to data after the GPS IFD
  const gpsLen = 2 + 4 * 12 + 4; // 54
  const dtOff = gpsOff + gpsLen;
  const latOff = dtOff + 20, lngOff = latOff + 24;
  w16(1); w16(0x9003); w16(2); w32(20); w32(dtOff); w32(0);
  // GPS IFD
  w16(4);
  w16(1); w16(2); w32(2); tiff.push(latRef.charCodeAt(0), 0, 0, 0);
  w16(2); w16(5); w32(3); w32(latOff);
  w16(3); w16(2); w32(2); tiff.push(lngRef.charCodeAt(0), 0, 0, 0);
  w16(4); w16(5); w32(3); w32(lngOff);
  w32(0);
  for (const ch of (date + '\0').padEnd(20, '\0')) tiff.push(ch.charCodeAt(0));
  for (const x of [...lat, ...lng]) { w32(Math.round(x * 100)); w32(100); }
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = app1.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...app1, 0xff, 0xd9]).buffer;
}
const x = readExif(jpegWithExif('2026:11:20 09:41:07', [9, 56, 1.2], 'N', [84, 4, 30], 'W'));
assert.equal(x.date, '2026-11-20'); assert.equal(x.time, '09:41');
assert(Math.abs(x.lat! - 9.933667) < 1e-4 && Math.abs(x.lng! + 84.075) < 1e-4, JSON.stringify(x));
assert.deepEqual(readExif(new Uint8Array([1, 2, 3, 4]).buffer), { date: null, time: null, lat: null, lng: null });
assert.equal(commonDate([x, x, { ...x, date: '2026-11-19' }]), '2026-11-20');
assert(gpsComun([x])!.lat === x.lat);

// ---------- ubicaciones ----------
assert.deepEqual(parseCoordinates('9.9325, -84.0795'), { lat: 9.9325, lng: -84.0795 });
assert.deepEqual(parseCoordinates('https://www.google.com/maps/place/X/@9.93,-84.07,17z/data=!3d9.9331!4d-84.0712'), { lat: 9.9331, lng: -84.0712 });
assert.deepEqual(parseCoordinates('https://maps.google.com/?q=10.5,-85.1'), { lat: 10.5, lng: -85.1 });
assert.equal(parseCoordinates('Condominio Vista del Bosque'), null);
assert(Math.abs(distanceKm({ lat: 9.93, lng: -84.08 }, { lat: 9.95, lng: -84.10 }) - 3.1) < 0.3);
const g = groupNearby([a, b, c, e].map(bb => ({ b: bb })), 15);
assert.equal(g.groups.length, 2, 'A and B together, C (Guanacaste) apart');
assert.equal(g.withoutLocation.length, 1);
assert(routeLink([{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }]).includes('waypoints=1%2C2'));

// ---------- inspection: at least 7 days before the informe ----------
assert.equal(inspectionDeadline('2026-12-15'), '2026-12-08');
const insp = normalize({ projects: [{ id: 'i', code: 'D1-0009-2026', name: 'I', status: 'open', openedOn: '2026-01-15', createdOn: '2026-11-01' }] }).projects[0];
const pend = pendingOf(insp, '2026-11-25', '2027-01-31');
const dec = pend.find(x => x.key === 'm:2026-12')!;
assert.equal(sortDate(dec), '2026-12-08', 'pending inspection sorts by its deadline');
insp.deliveries = { 'm:2026-12': { ...dec.b.deliveries?.['m:2026-12'], planned: '2026-12-03', due: null, visit: null, photos: null, letter: null, uploaded: null, letterText: '', files: [] } };
assert.equal(sortDate(pendingOf(insp, '2026-11-25', '2027-01-31').find(x => x.key === 'm:2026-12')!), '2026-12-03', 'scheduled inspection sorts by its day');
const rem = computeReminders({ ...emptyData(), projects: [insp] }, new Date(2026, 10, 25, 12).getTime());
assert(rem.some(r => r.key.startsWith('v:i:m:2026-12:2026-12-03')), 'reminder for the scheduled inspection');
const insp2 = normalize({ projects: [{ id: 'j', code: 'D1-0010-2026', name: 'J', status: 'open', openedOn: '2026-01-15', createdOn: '2026-11-01' }] }).projects[0];
const rem2 = computeReminders({ ...emptyData(), projects: [insp2] }, new Date(2026, 10, 25, 12).getTime());
const n = rem2.find(r => r.key === 'n:j:2026-12')!;
assert.equal(new Date(n.at).getDate(), 8, 'unscheduled inspection reminder 7 days before');
// ---------- photos from the general log go into their month ----------
const lg = normalize({ projects: [{ id: 'l', code: 'D1-0011-2026', name: 'L', status: 'open', openedOn: '2026-01-15', createdOn: '2026-01-15',
  entries: [
    { id: 'e1', date: '2026-11-10', type: 'visit', text: '', attachments: [
      { id: 'a1', name: 'f1.jpg', path: 'proyectos/x/f1.jpg', type: 'photo', takenOn: '2026-11-10' },     // before Nov 15 → November
      { id: 'a2', name: 'f2.jpg', path: 'proyectos/x/f2.jpg', type: 'photo', takenOn: '2026-11-20' } ] }, // after Nov 15 → December
    { id: 'e2', date: '2026-07-01', type: 'regencia', regencia: '2026-07-15', text: 'Regencia', attachments: [{ id: 'a3', name: 'r.pdf', path: 'proyectos/x/r.pdf', type: 'pdf' }] },
    { id: 'e3', date: '2026-08-01', type: 'observation', text: 'Obs SETENA', attachments: [{ id: 'a4', name: 'o.pdf', path: 'proyectos/x/o.pdf', type: 'pdf' }] }
  ] }] });
const moved = fileLogIntoDeliveries(lg);
const L = lg.projects[0];
assert.equal(moved, 3);
assert.deepEqual(L.deliveries!['m:2026-11'].files.map(f => f.name), ['f1.jpg']);
assert.deepEqual(L.deliveries!['m:2026-12'].files.map(f => f.name), ['f2.jpg']);
assert.equal(L.deliveries!['m:2026-12'].photos, '2026-11-20');
assert.deepEqual(L.deliveries!['r:2026-07-15'].files.map(f => f.name), ['r.pdf']);
assert.deepEqual(L.entries.map(e => e.id), ['e2', 'e3'], 'empty photo-only entry removed, notes and observations kept');
assert.equal(L.entries[1].attachments.length, 1, 'observation keeps its file');
assert.equal(fileLogIntoDeliveries(lg), 0, 'running again moves nothing');
console.log('deliveries OK');
process.exit(0); // store.ts leaves an hourly timer running
