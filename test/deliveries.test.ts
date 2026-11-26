// Tests: adjustable dates, sorting by date, EXIF reader and grouping by distance
import assert from 'node:assert';
import { deliveryFolder, folderOf } from '../src/lib/folders';
import { normalize, applyStep, emptyData, fileLogIntoDeliveries } from '../src/lib/store';
import { monthlyKeysDueIn, openingFrom, hasSchedule, agenda, completeIn, monthlyDue, regenciaInMonth, nextDue, nextRegencia, computeReminders, reportTasks, sortDate, pendingOf, inspectionDate, taskColumns, pendingBefore } from '../src/lib/schedule';
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
assert(ag.every((x, i) => i === 0 || sortDate(ag[i - 1]) <= sortDate(x)), 'agenda sorted by date');
assert.equal(ag[0].date, '2026-02-03', 'overdue first (B, day 3, every month since the opening)');
assert(ag[0].overdue);
assert.equal(nextDue(c, today)!.date, '2026-02-10', 'the most overdue one not done');
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

// ---------- Inspección · Bitácora · Regencia: all on the opening day, each movable ----------
const insp = normalize({ projects: [{ id: 'i', code: 'D1-0009-2025', name: 'I', status: 'open', openedOn: '2025-01-15', createdOn: '2026-11-01' }] }).projects[0];
assert.equal(inspectionDate(insp, '2026-12'), '2026-12-15', 'inspection on the opening day');
const cols = taskColumns(insp, '2026-11-25');
assert.equal(cols.inspection.next!.date, '2025-02-15', 'old months count too (from the opening)');
assert.equal(cols.bitacora.behind, 22, 'Feb 2025 … Nov 2026 behind');
assert.equal(cols.regencia.next!.date, '2025-07-15');
insp.deliveries = { 'm:2026-12': { planned: '2027-01-03', due: null, visit: null, photos: null, letter: null, uploaded: null, letterText: '', files: [] } };
assert.equal(inspectionDate(insp, '2026-12'), '2027-01-03', 'inspection moved to another month');
assert.deepEqual(monthlyKeysDueIn(insp, '2027-01', true), ['2026-12', '2027-01'], 'calendar shows it in January');
const rem = computeReminders({ ...emptyData(), projects: [insp] }, new Date(2026, 11, 20, 12).getTime());
assert(rem.some(r => r.key.startsWith('v:i:2026-12:2027-01-03')), 'reminder follows the moved inspection');
// catch up: everything before November 2026 checked with its own date
const before = pendingBefore(insp, '2026-11-01');
assert.equal(before.filter(t => t.step === 'visit').length, 21);
assert.equal(before.filter(t => t.key.startsWith('r:')).length, 3, 'Jul 25, Jan 26, Jul 26');
for (const t of before) applyStep(insp, t.key, t.step, t.date);
assert.equal(taskColumns(insp, '2026-11-25').bitacora.next!.date, '2026-11-15', 'only November left');
assert.equal(insp.deliveries['m:2025-03']!.uploaded, '2025-03-15', 'done on its own date');
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
// ---- Informe moved to another month; unknown opening date ----
{
  const dd = normalize({ projects: [
    { id: 'm', code: 'D1-0001-2025', name: 'MOVIDO', status: 'open', openedOn: '2025-11-10', createdOn: '2026-11-01', uploads: [], visits: [], regencias: [],
      deliveries: { 'm:2026-12': { due: '2027-01-04' } } },
    { id: 'n', code: 'D1-0002-2025', name: 'SIN FECHA', status: 'open', openedOn: '2026-11-25', createdOn: '2026-11-25', uploads: [], visits: [], regencias: [] }
  ] });
  const [m, n] = dd.projects;
  assert.deepEqual(monthlyKeysDueIn(m, '2026-12'), [], 'December informe moved out');
  assert.deepEqual(monthlyKeysDueIn(m, '2027-01'), ['2026-12', '2027-01'], 'January shows both');
  assert.equal(monthlyKeysDueIn(m, '2027-03').length, 1, 'future months have an informe');
  assert.equal(n.noOpeningDate, true, 'imported with the import day as opening → unknown');
  assert.equal(hasSchedule(n), false);
  assert.equal(nextDue(n, '2026-11-25'), null, 'no made-up deliveries');
  assert.equal(m.noOpeningDate, false);
  // next informe Dec 10 2026, next regencia May 10 2027 → opened on the 10th, regencias in May/Nov
  const o = openingFrom('2026-12-10', '2027-05-10', 'D1-0001-2025', '2026-11-25');
  assert.equal(o.slice(8), '10'); assert(['05', '11'].includes(o.slice(5, 7)) && o.startsWith('2025'), o);
  const rm = computeReminders({ ...dd, projects: [m] } as any, new Date('2026-12-20T12:00:00').getTime()).find(r => r.key === 'm:m:2026-12');
  assert(rm && new Date(rm.at).toISOString().startsWith('2027-01-0'), 'reminder follows the moved date');
}
// ---- photos only in the Inspección; the Inicio de obras letter ----
{
  const ph = (id: string, takenOn: string) => ({ id, name: id + '.jpg', path: 'p/' + id, type: 'photo', takenOn });
  const dd = normalize({ projects: [{ id: 'p', code: 'D1-0003-2025', name: 'P', status: 'open', openedOn: '2025-01-15', createdOn: '2025-01-15', uploads: [], visits: [], regencias: [], noOpeningDate: false,
    deliveries: { 'r:2025-07-15': { files: [ph('f1', '2025-07-10'), { id: 'w', name: 'regencia.docx', path: 'p/w', type: 'other' }] }, 's:start': { uploaded: '2025-01-20', files: [{ id: 's', name: 'inicio.pdf', path: 'p/s', type: 'pdf' }] } } }] });
  const p = dd.projects[0];
  assert.equal(p.deliveries!['s:start'].files.length, 1, 'start letter kept');
  assert.deepEqual(p.regencias, [], 'start letter is not a regencia');
  assert.equal(fileLogIntoDeliveries(dd), 1);
  assert.deepEqual(p.deliveries!['r:2025-07-15'].files.map(f => f.id), ['w'], 'only the Word document stays in the Regencia');
  assert.equal(p.deliveries!['m:2025-07'].files[0].id, 'f1', 'the photo goes to July\'s inspection');
}
// ---- folders on disk ----
{
  const pr = { code: 'D1-0170-2020', name: 'CONDOMINIO: VISTA DEL BOSQUE' };
  assert.equal(deliveryFolder(pr, 'm:2026-11'), 'Proyectos/D1-0170-2020 - CONDOMINIO- VISTA DEL BOSQUE/2026/11 - Noviembre/Fotos');
  assert.equal(deliveryFolder(pr, 'r:2027-01-15'), 'Proyectos/D1-0170-2020 - CONDOMINIO- VISTA DEL BOSQUE/2027/01 - Enero/Regencias');
  assert.equal(deliveryFolder(pr, 's:start'), 'Proyectos/D1-0170-2020 - CONDOMINIO- VISTA DEL BOSQUE/Inicio de obras');
  assert.equal(folderOf('a/b/c.jpg'), 'a/b');
}
// ---- Informe de estado ----
{
  const dd = normalize({ projects: [
    { id: 'q', code: 'D1-0004-2026', name: 'Q', status: 'open', openedOn: '2026-05-28', createdOn: '2026-05-28', uploads: [], visits: [], regencias: [], noOpeningDate: false },
    { id: 'z', code: 'D1-0005-2026', name: 'Z', status: 'open', openedOn: '2026-11-26', createdOn: '2026-11-26', uploads: [], visits: [], regencias: [] }
  ] });
  const r = reportTasks(dd, '2026-11-26', '2026-12-02');
  assert.deepEqual(r.upcoming.map(t => t.kind), ['inspection', 'bitacora', 'regElab', 'regUpload'], 'Nov 28: inspection, bitácora and the Regencia');
  assert.equal(r.overdue.filter(t => t.kind === 'bitacora').length, 5, 'Jun … Oct');
  assert.deepEqual(r.noDate.map(b => b.id), ['z']);
}
console.log('moved / no-date OK');
process.exit(0); // store.ts leaves an hourly timer running
