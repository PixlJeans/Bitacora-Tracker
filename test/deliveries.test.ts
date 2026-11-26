// Tests: adjustable dates, sorting by date, EXIF reader and grouping by distance
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { applySetena } from '../src/lib/setenaImport';
import { quietInSetena } from '../src/lib/setenaInfo';
import { deliveryFolder, folderOf } from '../src/lib/folders';
import { normalize, applyStep, emptyData, fileLogIntoDeliveries, replaceAll, getData, markStep, mutate } from '../src/lib/store';
import { emptyDelivery } from '../src/lib/types';
import { backend } from '../src/lib/backend';
import { scanFolders } from '../src/lib/scan';
import { docReader } from '../src/lib/docSort';
import { placeOf } from '../src/lib/docKind';
import { crtm05ToLatLng, crtmFromText } from '../src/lib/geo';
import { classifyDoc } from '../src/lib/docKind';
// the PDFs of the scanner tests are regencias of their own project
docReader.text = async (p: string) => `Informe de Regencia Ambiental IRA-I-2026 Proyecto: X Expediente Administrativo: ${/(D\d-\d+-\d{4})/.exec(p)?.[1]}-SETENA Periodo de Regencia Enero - Junio 2026`;
import { monthlyKeysDueIn, openingFrom, hasSchedule, agenda, completeIn, monthlyDue, regenciaInMonth, nextDue, nextRegencia, computeReminders, reportTasks, sortDate, pendingOf, inspectionDate, taskColumns, pendingBefore } from '../src/lib/schedule';
import { readExif, commonDate, gpsComun } from '../src/lib/exif';
import { groupNearby, distanceKm, routeLink, parseCoordinates, planRoute, routeKm } from '../src/lib/geo';

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
assert.equal(ag[0].date, '2026-05-03', 'overdue first (B, day 3; v52: from last month, older months are history)');
assert(ag[0].overdue);
assert.equal(nextDue(c, today)!.date, '2026-05-10', 'the most overdue one not done (from last month)');
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
assert.equal(cols.inspection.next!.date, '2026-10-15', 'v52: older months are history, last month is the oldest pending');
assert.equal(cols.bitacora.behind, 2, 'Oct + Nov 2026 behind');
assert.equal(cols.regencia.next!.date, '2026-07-15', 'the latest regencia due; older ones are history');
insp.deliveries = { 'm:2026-12': { planned: '2027-01-03', due: null, visit: null, photos: null, letter: null, uploaded: null, letterText: '', files: [] } };
assert.equal(inspectionDate(insp, '2026-12'), '2027-01-03', 'inspection moved to another month');
assert.deepEqual(monthlyKeysDueIn(insp, '2027-01', true), ['2026-12', '2027-01'], 'calendar shows it in January');
const rem = computeReminders({ ...emptyData(), projects: [insp] }, new Date(2026, 11, 20, 12).getTime());
assert(rem.some(r => r.key.startsWith('v:i:2026-12:2027-01-03')), 'reminder follows the moved inspection');
// catch up: what is still pending before November 2026 (v52: only October; older months are history) checked with its own date
const before = pendingBefore(insp, '2026-11-01', '2026-11-25');
assert.equal(before.filter(t => t.step === 'visit').length, 1);
assert.equal(before.filter(t => t.key.startsWith('r:')).length, 1, 'Jul 26 (the latest regencia due)');
for (const t of before) applyStep(insp, t.key, t.step, t.date);
assert.equal(taskColumns(insp, '2026-11-25').bitacora.next!.date, '2026-11-15', 'only November left');
assert.equal(insp.deliveries['m:2026-10']!.uploaded, '2026-10-15', 'done on its own date');
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
  const pr = normalize({ projects: [{ id: 'f', code: 'D1-0170-2020', name: 'CONDOMINIO: VISTA DEL BOSQUE', status: 'open', openedOn: '2020-01-15', createdOn: '2020-01-15', noOpeningDate: false,
    deliveries: { 'r:2026-07-15': { due: '2026-08-02' }, 'm:2026-12': { planned: '2027-01-03' } } }] }).projects[0];
  assert.equal(deliveryFolder(pr, 'm:2026-11'), 'Proyectos/D1-0170-2020 - CONDOMINIO- VISTA DEL BOSQUE/2026/11 - Noviembre/Fotos');
  assert.equal(deliveryFolder(pr, 'r:2027-01-15'), 'Proyectos/D1-0170-2020 - CONDOMINIO- VISTA DEL BOSQUE/2027/01 - Enero/Regencias');
  assert.equal(deliveryFolder(pr, 's:start'), 'Proyectos/D1-0170-2020 - CONDOMINIO- VISTA DEL BOSQUE/Inicio de obras');
  assert.equal(deliveryFolder(pr, 'r:2026-07-15'), 'Proyectos/D1-0170-2020 - CONDOMINIO- VISTA DEL BOSQUE/2026/08 - Agosto/Regencias', 'moved Regencia → its new month');
  assert.equal(deliveryFolder(pr, 'm:2026-12'), 'Proyectos/D1-0170-2020 - CONDOMINIO- VISTA DEL BOSQUE/2027/01 - Enero/Fotos', 'moved inspection → its new month');
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
  assert.equal(r.overdue.filter(t => t.kind === 'bitacora').length, 1, 'Oct only (v52: Jun … Sep are history)');
  assert.deepEqual(r.noDate.map(b => b.id), ['z']);
}
// ---- routes ----
{
  const P = (id: string, lat: number, lng: number) => ({ b: { id, location: { lat, lng } } as any });
  const home = { lat: 0, lng: 0 };
  const r = planRoute([P('far', 0, 3), P('near', 0, 1), P('mid', 0, 2)], home, true);
  assert.deepEqual(r.map(x => x.b.id), ['near', 'mid', 'far'], 'nearest first from home');
  const u = routeLink(r.map(x => x.b.location), home, true);
  assert(u.includes('origin=0%2C0') && u.includes('destination=0%2C0') && u.includes('waypoints=0%2C1%7C0%2C2%7C0%2C3'), u);
  const u2 = routeLink([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }], home, false);
  assert(u2.includes('destination=2%2C2') && u2.includes('waypoints=1%2C1'), u2);
  assert(Math.abs(routeKm([{ lat: 0, lng: 1 }], home, true) - 2 * distanceKm(home, { lat: 0, lng: 1 })) < 1e-9);
}
// ---- folders scanned by hand ----
{
  const dd = normalize({ projects: [{ id: 's1', code: 'D1-0001-2025', name: 'SCAN', status: 'open', openedOn: '2025-01-10', createdOn: '2025-01-10', noOpeningDate: false,
    deliveries: { 'm:2026-10': { planned: '2026-11-03' } } }] });
  replaceAll(dd);
  const root = 'Proyectos/D1-0001-2025 - SCAN';
  const photo = jpegWithExif('2026:11:04 09:00:00', [9, 56, 1.2], 'N', [84, 4, 30], 'W');
  const b64 = Buffer.from(new Uint8Array(photo)).toString('base64');
  (backend as any).listTree = async () => [
    { path: `${root}/2026/11 - Noviembre/Fotos/a.jpg`, size: 10, modified: 0 },       // the moved October inspection (now Nov 3)
    { path: `${root}/2026/09 - Septiembre/Fotos/b.jpg`, size: 10, modified: 0 },      // September
    { path: `${root}/2026/07 - Julio/Regencias/regencia.docx`, size: 10, modified: 0 },
    { path: `${root}/Inicio de obras/inicio.pdf`, size: 10, modified: 0 }
  ];
  (backend as any).readHead = async () => b64;
  const msg = await scanFolders(true);
  const p = getData().projects[0];
  assert(msg.includes('2 inspección'), msg);
  assert.equal(p.deliveries!['m:2026-10'].visit, '2026-11-04', 'moved inspection found in November, photo date');
  assert.equal(p.deliveries!['m:2026-09'].visit, '2026-09-10', 'photo far from the month → inspection date');
  assert(p.deliveries!['r:2026-07-10'].uploaded && p.deliveries!['r:2026-07-10'].letter, 'regencia document');
  assert(p.deliveries!['s:start'].uploaded, 'inicio de obras');
  assert(p.location && Math.abs(p.location.lat - 9.9337) < 0.001, 'location from GPS');
}
// ---- Friday summary ----
{
  const dd = normalize({ projects: [{ id: 'w1', code: 'D1-0001-2026', name: 'W', status: 'open', openedOn: '2026-01-01', createdOn: '2026-01-01', noOpeningDate: false }] });
  const rem = computeReminders(dd, new Date(2026, 10, 25, 10).getTime()).filter(r => r.kind === 'weekly');   // Wed Nov 25
  assert.equal(rem.length, 2);
  assert.equal(rem[0].key, 'w:2026-11-27', 'this Friday');
  assert(rem[0].title.includes('1 inspección'), rem[0].title);   // Tue Dec 1
}
// ---- SETENA portal → projects ----
{
  const raw = JSON.parse(readFileSync(new URL('./fixtures/setena-sample.json', import.meta.url), 'utf8').replaceAll('~/', 'https://bitacora.setena.go.cr/documents/'));
  const dd = normalize({ projects: [
    { id: 'v', code: 'D1-0170-2020', name: 'CONDOMINIO VISTA DEL BOSQUE', status: 'open', openedOn: '2026-11-25', createdOn: '2026-11-25' },   // imported without date
    { id: 'a', code: 'D1-0550-2020', name: 'Condominio Almazara', status: 'open', openedOn: '2021-03-02', createdOn: '2026-11-20', noOpeningDate: false }
  ] });
  const r = applySetena(dd, raw, '2026-11-26');
  const v = dd.projects.find(p => p.code === 'D1-0170-2020')!;
  assert.equal(v.noOpeningDate, false); assert.equal(v.openedOn, '2022-01-14', 'start = first SETENA entry (bottom of the page)');
  assert.equal(v.setenaStart, '2022-01-14');
  assert.equal(v.setenaUrl, 'https://bitacora.setena.go.cr/BitacoraDigital/PrimerIngresoBitacora/245?estado=2&IdProyecto=D1-0170-2020');
  assert.equal(dd.projects.find(p => p.code === 'D1-0550-2020')!.openedOn, '2021-03-02', 'a date already there is not changed');
  assert(v.deliveries!['m:2023-08'].notes!.includes('SETENA 28/08/2023: El proyecto'), 'text → notes of that month');
  assert.equal(v.deliveries!['m:2023-08'].visit, null, 'nothing checked');
  assert.equal(v.deliveries!['m:2023-08'].uploaded, null, 'nothing checked');
  const nw = dd.projects.find(p => p.code === 'D1-0607-2026')!;
  assert(nw && !nw.noOpeningDate && nw.openedOn === '2026-11-09', 'new project created with its SETENA start');
  assert.equal(dd.projects.find(p => p.code === 'D1-0550-2020')!.status, 'closing', 'status from SETENA');
  const f = (n: string) => r.downloads.find(x => x.name.includes(n))!;
  assert.equal(f('76aad41f').folder, 'Proyectos/D1-0170-2020 - CONDOMINIO VISTA DEL BOSQUE/2023/08 - Agosto/Fotos');
  assert.equal(f('76aad41f').name, '2023-08-28_76aad41f.jpg');
  assert.equal(f('553a394a').folder, 'Proyectos/D1-0170-2020 - CONDOMINIO VISTA DEL BOSQUE/2024/02 - Febrero/Regencias', 'documents always go to their month\'s Regencias');
  assert.equal(f('473fa0af').folder, 'Proyectos/D1-0607-2026 - AMPLIACION DE BODEGA/2026/11 - Noviembre/Regencias');
  assert.equal(f('solicitudcierre').folder, 'Proyectos/D1-0550-2020 - Condominio Almazara/2026/04 - Abril/SETENA');
  assert.equal(r.downloads.length, 7);
  // running it again changes nothing
  const before = JSON.stringify(dd);
  applySetena(dd, raw, '2026-11-26');
  assert.equal(JSON.stringify(dd), before, 'idempotent');
}
// ---- same day, two entries with documents: the first is the regencia, the later one SETENA's receipt ----
{
  const dd = normalize({ projects: [{ id: 'rc', code: 'D1-0009-2023', name: 'REC', status: 'open', openedOn: '2023-08-14', createdOn: '2023-08-14', noOpeningDate: false }] });
  const doc = (h: string) => `https://bitacora.setena.go.cr/documents/D1-0009-2023/Tramitacion/${h}-1111-2222-3333-444444444444_2024_2_29.pdf`;
  const man = { projects: [{ code: 'D1-0009-2023', name: 'REC', status: 'Abierta', url: '/x', events: [
    { date: '2024-02-29', time: 19 * 3600 + 45 * 60 + 30, text: '', files: [doc('aaaaaaaa')] },   // 7:45:30 p.m (top of the page)
    { date: '2024-02-29', time: 19 * 3600 + 44 * 60 + 29, text: '', files: [doc('bbbbbbbb')] },   // 7:44:29 p.m
    { date: '2024-03-10', text: '', files: [doc('cccccccc')] },                                    // alone: regencia
    { date: '2024-04-02', text: 'top', files: [doc('dddddddd')] },                                 // no hour: page order
    { date: '2024-04-02', text: 'bottom', files: [doc('eeeeeeee')] }
  ] }] };
  const r = applySetena(dd, man as any, '2026-11-26');
  const at = (h: string) => r.downloads.find(x => x.name.includes(h))!.folder.split('/').pop();
  assert.equal(at('bbbbbbbb'), 'Regencias', 'earlier entry = regencia');
  assert.equal(at('aaaaaaaa'), 'Notas de recibido', 'later entry the same day = receipt');
  assert.equal(at('cccccccc'), 'Regencias');
  assert.equal(at('eeeeeeee'), 'Regencias', 'bottom of the page = earlier');
  assert.equal(at('dddddddd'), 'Notas de recibido');
  assert.deepEqual(r.moves.map(m => m.from.split('/').slice(-2).join('/')), ['Regencias/2024-02-29_aaaaaaaa.pdf', 'Regencias/2024-04-02_dddddddd.pdf']);
  // the page's summary
  const man2 = { readAt: '2026-11-26T20:00:00Z', requests: [{ code: 'D1-0009-2023', state: 'Rechazada', date: '01/06/2023 10:00 a.m.' }, { code: 'D1-0009-2023', state: 'Aprobada', date: '10/08/2023 09:00 a.m.' }],
    projects: [{ ...man.projects[0], avance: 55, participationClosed: false, people: ['CARLOS JIMÉNEZ (Activo)', 'FANNY BRENES (Renuncia)'],
      events: man.projects[0].events.map((e, i) => ({ ...e, author: i === 0 ? 'CARLOS AGUILAR' : 'CARLOS JIMÉNEZ' })) }] };
  applySetena(dd, man2 as any, '2026-11-26');
  const si = dd.projects[0].setena!;
  assert.equal(si.avance, 55);
  assert.equal(si.lastEntry, '2024-04-02');
  assert.equal(si.entries, 5);
  assert.equal(si.approvedOn, '2023-08-10', 'approved request, not the rejected one');
  assert.deepEqual(si.others, ['CARLOS AGUILAR'], 'other authors, not me');
  const q = quietInSetena({ ...dd, projects: dd.projects.map(p => ({ ...p, status: 'open' as const })) } as any, '2026-11-26');
  assert.equal(q.length, 1, 'no entry since April 2024 → listed');
  assert.equal(normalize(JSON.parse(JSON.stringify(dd))).projects[0].setena!.avance, 55, 'survives saving');
}
// ---- location from photos downloaded from SETENA (nothing checked) ----
{
  const dd = normalize({ projects: [{ id: 's2', code: 'D1-0002-2025', name: 'GPS', status: 'open', openedOn: '2025-01-10', createdOn: '2025-01-10', noOpeningDate: false }] });
  replaceAll(dd);
  const photo = jpegWithExif('2026:11:04 09:00:00', [9, 56, 1.2], 'N', [84, 4, 30], 'W');
  const b64 = Buffer.from(new Uint8Array(photo)).toString('base64');
  (backend as any).listTree = async () => [
    { path: 'Proyectos/D1-0002-2025 - GPS/2026/11 - Noviembre/SETENA/2026-11-04_abcdef01.jpg', size: 10, modified: 0 },
    { path: 'Proyectos/D1-0002-2025 - GPS/2026/07 - Julio/Regencias/2026-07-22_def01234.pdf', size: 10, modified: 0 },  // Regencia due Jul 10 → same month
    { path: 'Proyectos/D1-0002-2025 - GPS/2026/02 - Febrero/Regencias/2026-02-27_0a1b2c3d.pdf', size: 10, modified: 0 } // Regencia due Jan 10 → the closest one
  ];
  getData().projects[0].deliveries = { 'm:2026-03': { ...emptyDelivery(), notes: 'SETENA 05/03/2026: Avance de obra' } } as any;
  (backend as any).readHead = async () => b64;
  const msg = await scanFolders(true);
  const p = getData().projects[0];
  assert(p.location && Math.abs(p.location.lng + 84.075) < 0.001, 'location from SETENA photo GPS');
  assert.equal(p.deliveries?.['m:2026-11']?.visit, '2026-11-04', 'SETENA photos → that month\'s inspection, on the entry date');
  assert.equal(p.deliveries?.['m:2026-11']?.uploaded, '2026-11-04', 'SETENA entry → that month\'s bitácora');
  assert(msg.includes('ubicación'), msg);
  assert.equal(p.deliveries?.['r:2026-07-10']?.uploaded, '2026-07-22', 'PDF in the Regencia\'s month');
  assert.equal(p.deliveries?.['r:2026-01-10']?.uploaded, '2026-02-27', 'PDF in another month → closest Regencia');
  assert.equal(p.deliveries?.['m:2026-03']?.uploaded, '2026-03-05', 'text-only SETENA entry → bitácora');
}
// ---- SETENA files sorted by the month of their entry ----
{
  const dd = normalize({ projects: [{ id: 's3', code: 'D1-0003-2025', name: 'SORT', status: 'open', openedOn: '2025-01-10', createdOn: '2025-01-10', noOpeningDate: false }] });
  replaceAll(dd);
  const root = 'Proyectos/D1-0003-2025 - SORT';
  let tree = [
    { path: `${root}/2026/07 - Julio/SETENA/2026-07-22_aaaaaaaa.pdf`, size: 1, modified: 0 },     // Regencia due Jul 10 → Regencias
    { path: `${root}/2026/02 - Febrero/SETENA/2026-02-27_bbbbbbbb.pdf`, size: 1, modified: 0 },  // no Regencia that month → still Regencias (not checked)
    { path: `${root}/2026/02 - Febrero/SETENA/2026-02-27_cccccccc.jpg`, size: 1, modified: 0 },  // photo → Fotos
    { path: `${root}/2026/03 - Marzo/Documentos/2026-03-05_dddddddd.pdf`, size: 1, modified: 0 },  // old Documentos → Regencias
    { path: `${root}/2026/03 - Marzo/Documentos/mi carta.pdf`, size: 1, modified: 0 }             // the user's own file: untouched
  ];
  const moves: string[] = [];
  (backend as any).listTree = async () => tree;
  (backend as any).moveAttachment = async (path: string, folder: string) => {
    moves.push(`${path.split('/').pop()} → ${folder.slice(root.length + 1)}`);
    tree = tree.map(t => t.path === path ? { ...t, path: `${folder}/${path.split('/').pop()}` } : t);
    return `${folder}/${path.split('/').pop()}`;
  };
  (backend as any).readHead = async () => '';
  await scanFolders(true);
  assert.deepEqual([...moves].sort(), ['2026-02-27_bbbbbbbb.pdf → 2026/02 - Febrero/Regencias', '2026-02-27_cccccccc.jpg → 2026/02 - Febrero/Fotos', '2026-03-05_dddddddd.pdf → 2026/03 - Marzo/Regencias', '2026-07-22_aaaaaaaa.pdf → 2026/07 - Julio/Regencias']);
  const p = getData().projects[0];
  assert.equal(p.deliveries?.['r:2026-07-10']?.uploaded, '2026-07-22', 'regencia checked after sorting');
  assert.equal(p.deliveries?.['m:2026-02']?.visit, '2026-02-27', 'inspection checked after sorting');
  assert.equal(p.deliveries?.['m:2026-02']?.uploaded, '2026-02-27', 'bitácora checked');
  assert.equal(p.deliveries?.['r:2026-07-10']?.letter, '2026-07-22', 'uploaded ⇒ elaborated');
  // documents in other months go to the closest Regencia (Jan 10): the one nearest its due date, and it moves there
  assert.equal(p.deliveries?.['r:2026-01-10']?.uploaded, '2026-02-27', 'closest regencia checked');
  assert.equal(p.deliveries?.['r:2026-01-10']?.due, '2026-02-27', 'regencia moved to the month of its document');
  assert.equal(p.deliveries?.['r:2025-07-10']?.uploaded ?? null, null, 'a regencia without documents stays unchecked');
  // a nota de recibido in its folder checks «Nota de recibido» of the closest Regencia
  tree = [...tree, { path: `${root}/2025/08 - Agosto/Notas de recibido/recibido.pdf`, size: 1, modified: 0 }];
  await scanFolders(true);
  const q = getData().projects[0].deliveries!['r:2025-07-10'];
  assert.equal(q.received, '2025-08-15');
  assert(q.uploaded && q.letter, 'receipt ⇒ uploaded and elaborated');
  // checking «Subir regencia» by hand also checks «Elaboración»
  markStep(p.id, 'r:2027-01-10', 'uploaded', '2027-01-12');
  assert.equal(getData().projects[0].deliveries!['r:2027-01-10'].letter, '2027-01-12');
}
// ---- what a SETENA PDF is, from its own first page (texts as pdf.js reads the real ones) ----
{
  const reg = classifyDoc('Informe de Regencia Ambiental IRA-I-2024 Proyecto: CONDOMINIO VISTA DEL BOSQUE Propietario: Urbanizadora HJH del Este S.A. Expediente Administrativo: D1-0170-2020-SETENA CARLOS JIMENEZ PEREZ (FIRMA) Periodo de Informe Regencial: Agosto 2023 - Enero 2024 Firmado', 'D1-0170-2020');
  assert.deepEqual(reg, { kind: 'regencia', ira: 'IRA-I-2024', expediente: 'D1-0170-2020', period: 'Agosto 2023 - Enero 2024', project: 'CONDOMINIO VISTA DEL BOSQUE', noPlace: true });
  assert.equal(fin_project(), 'PUENTE LA GRAN VÍA');
  function fin_project() { return classifyDoc('Informe Final Consolidado de Regencia Ambiental IRA-II-2025 Proyecto: PUENTE LA GRAN VÍA Propietario: LAURA UREÑA ALFARO Expediente Administrativo: D1-0848-2022-SETENA', 'D1-0848-2022').project; }
  const fin = classifyDoc('Informe Final Consolidado de Regencia Ambiental IRA-II-2025 Proyecto: PUENTE LA GRAN VÍA Propietario: LAURA UREÑA ALFARO Expediente Administrativo: D1-0848-2022-SETENA Periodo de la Regencia Febrero 2025 - Julio 2025', 'D1-0848-2022');
  assert.equal(fin.kind, 'regencia'); assert.equal(fin.final, true); assert.equal(fin.period, 'Febrero 2025 - Julio 2025');
  assert.equal(classifyDoc('Informe de Regencia Ambiental IRA-I-2022 Proyecto: CONDOMINIO ALMAZARA Expediente Administrativo: D1-0550-2020-SETENA Periodo de Regencia Abril - Mayo del 2022', 'D1-0170-2020').kind, 'foreign', 'another project\'s regencia');
  const rec = classifyDoc('29/2/24, 19:30 Correspondencia 02271-2024 Ministerio de Ambiente y Energía Secretaría Técnica Nacional Ambiental Código: ST-SIG-F-0000 Impreso por: Usuario Externo Formulario Recepción de Correspondencia Tipo Fecha de Ingreso Asunto: Informe de Regencia Ambiental IRA-I-2024', 'D1-0170-2020');
  assert.deepEqual(rec, { kind: 'receipt', number: '02271-2024' }, 'a receipt quotes the regencia but is a receipt');
  assert.equal(classifyDoc('Conﬁrmación de Ingreso de Correspondencia Detalle de la correspondencia registrada Información Interna Secuencia Expediente Fecha de Ingreso 04965-2024 D1-13049-2014 22/05/2024', 'D1-13049-2014').kind, 'receipt');
  assert.equal(classifyDoc('Powered by TCPDF (www.tcpdf.org) Documento de evaluación ambiental Otro Secretaría Técnica Nacional (SETENA), Costa Rica. Número de expediente D1-0206-2022 Tipo de trámite TRAMITE EN LINEA', 'D1-0206-2022').kind, 'receipt');
  assert.equal(classifyDoc('Página 1 de 2 De: Secretaría Técnica Nacional Ambiental (SETENA) — Departamento de Auditoría y Seguimiento Para: Desarrolladores y Responsables Ambientales Asunto: Seguimiento apertura formal de bitácoras', 'D1-0607-2026').kind, 'setena');
  assert.equal(classifyDoc('INF-TEC-DT-ASA-0339-2023 23 de junio de 2023 Asunto: Cierre de etapa única Desarrollador y Regente Ambiental a Notificar CONSTRUINMUEBLE del Este', 'D1-0550-2020').kind, 'setena');
  assert.equal(classifyDoc('Cartago, 07 de agosto del 2024. CS-81-2024-07-08 Señores Secretaría Técnica Nacional Ambiental Ministerio del Ambiente & Energía ATENCIÓN: DEPARTAMENTO DE GARANTÍAS AMBIENTALES REFERENCIA: Exp. D1-0848-2022', 'D1-0848-2022').kind, 'letter');
  assert.equal(classifyDoc('  \n ', 'D1-0848-2022').kind, 'notext');
}
// ---- the scanner moves each SETENA PDF to the folder of what it is, and undoes a check it caused ----
{
  const dd = normalize({ projects: [{ id: 'k1', code: 'D1-0007-2025', name: 'KIND', status: 'open', openedOn: '2025-05-10', createdOn: '2025-05-10', noOpeningDate: false,
    deliveries: { 'r:2026-11-10': { ...emptyDelivery(), letter: '2026-11-09', uploaded: '2026-11-09', due: '2026-11-09' } } }] });
  replaceAll(dd);
  const root = 'Proyectos/D1-0007-2025 - KIND';
  let tree = [
    { path: `${root}/2026/11 - Noviembre/Regencias/2026-11-09_0ddc7be7.pdf`, size: 1, modified: 0 },   // SETENA notice, taken as a regencia
    { path: `${root}/2026/07 - Julio/Regencias/2026-07-02_11111111.pdf`, size: 1, modified: 0 },       // a receipt
    { path: `${root}/2026/07 - Julio/Regencias/2026-07-01_22222222.pdf`, size: 1, modified: 0 }        // the regencia
  ];
  const texts: Record<string, string> = {
    '0ddc7be7': 'De: Secretaría Técnica Nacional Ambiental (SETENA) — Departamento de Auditoría y Seguimiento Para: Desarrolladores',
    '11111111': 'Correspondencia 07001-2026 Formulario Recepción de Correspondencia Asunto: Informe de Regencia Ambiental IRA-I-2026',
    '22222222': 'Informe de Regencia Ambiental IRA-I-2026 Proyecto: KIND Expediente Administrativo: D1-0007-2025-SETENA Periodo de Regencia Enero - Junio 2026'
  };
  const before = docReader.text;
  docReader.text = async (p: string) => texts[/_([0-9a-f]{8})\.pdf$/.exec(p)![1]];
  const moves: string[] = [];
  (backend as any).listTree = async () => tree;
  (backend as any).moveAttachment = async (path: string, folder: string) => {
    moves.push(`${path.split('/').pop()} → ${folder.split('/').slice(-1)[0]}`);
    tree = tree.map(t => t.path === path ? { ...t, path: `${folder}/${path.split('/').pop()}` } : t);
    return `${folder}/${path.split('/').pop()}`;
  };
  const msg = await scanFolders(true);
  assert.deepEqual(moves.sort(), ['2026-07-02_11111111.pdf → Notas de recibido', '2026-11-09_0ddc7be7.pdf → Comunicados SETENA']);
  const p = getData().projects[0];
  assert.equal(p.docs!['2026-07-01_22222222.pdf'].ira, 'IRA-I-2026');
  assert.equal(p.deliveries!['r:2026-11-10'].uploaded, null, 'the notice no longer counts as the November regencia');
  assert.equal(p.deliveries!['r:2026-11-10'].due, null, 'back to its own date');
  assert.equal(p.deliveries!['r:2026-05-10'].uploaded, '2026-07-01', 'the real regencia is checked');
  assert.equal(p.deliveries!['r:2026-05-10'].received, '2026-07-02', 'and its receipt');
  assert(msg.includes('3 PDF de SETENA leídos'), msg);
  // read once: nothing is read or moved again
  moves.length = 0;
  await scanFolders(true);
  assert.equal(moves.length, 0);
  // a name that is really a SETENA error is fixed from its regencia's cover (read again just for that), and the
  // folder follows (adopt), the PDF's other data is kept
  const adopts: string[] = [];
  (backend as any).adoptProjectFolder = async (code: string, folder: string) => { adopts.push(`${code}|${folder}`); return 0; };
  // (its regencia was read before names were taken from covers)
  mutate(dd2 => { dd2.projects[0].name = 'Problema al consultar información The remote server'; delete dd2.projects[0].docs!['2026-07-01_22222222.pdf'].project; });
  texts['22222222'] = 'Informe de Regencia Ambiental IRA-I-2026 Proyecto: CONDOMINIO LOTE I Expediente Administrativo: D1-0007-2025-SETENA Fase: Constructiva Periodo de Regencia Enero - Junio 2026';
  const msg2 = await scanFolders(true);
  const p2 = getData().projects[0];
  assert.equal(p2.name, 'CONDOMINIO LOTE I');
  assert.equal(p2.docs!['2026-07-01_22222222.pdf'].project, 'CONDOMINIO LOTE I');
  assert.equal(p2.docs!['2026-07-01_22222222.pdf'].ira, 'IRA-I-2026');
  assert(adopts.includes('D1-0007-2025|Proyectos/D1-0007-2025 - CONDOMINIO LOTE I'), adopts.join());
  assert(msg2.includes('nombre corregido'), msg2);
  await scanFolders(true);
  assert.equal(getData().projects[0].name, 'CONDOMINIO LOTE I', 'a good name is never changed again');
  docReader.text = before;
}
// ---- where a project is, from its regencia («Ubicación del Proyecto»; CRTM05 checked against a photo's GPS) ----
{
  const v = placeOf('Ubicación del Proyecto Provincia: Cartago Cantón: Cartago Distrito: Oriental Coordenadas: Latitud: 1.090.745,261, Longitud 510 054,024 Hoja cartográfica: Tejar 1:10000');
  assert.equal(v.place, 'Cartago, Cartago, Oriental');
  assert(Math.abs(v.lat! - 9.864553) < 0.001 && Math.abs(v.lng! + 83.908403) < 0.001, 'within ~25 m of the photos of D1-0170-2020: ' + JSON.stringify(v));
  const t = placeOf('Provincia: Cartago Cantón: El Guarco Distrito: Tejar No. Plano Catastrado: C-23681-2022 Coordenadas: Long 504036.866 / Lat. 1088322.602 Propietario');
  assert.equal(t.place, 'Cartago, El Guarco, Tejar'); assert(Math.abs(t.lat! - 9.8425) < 0.001);
  assert.deepEqual(crtmFromText('Coordenadas Geográficas: 1088387.4704 Lat / 504367.9293 Long (CRTM05)'), crtm05ToLatLng(504367.9293, 1088387.4704), 'order does not matter');
  assert.deepEqual(placeOf('Informe sin ubicación'), { noPlace: true });
}
console.log('moved / no-date OK');
process.exit(0); // store.ts leaves an hourly timer running
