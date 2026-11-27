import assert from 'node:assert';
import { normalize } from '../src/lib/store';
import { timelineOf, resignedInSetena } from '../src/lib/timeline';
import { applySetena } from '../src/lib/setenaImport';

const d = normalize({ settings: { look: 1 }, projects: [{
  id: 'a', code: 'D1-0170-2020', name: 'VISTA DEL BOSQUE', status: 'open', openedOn: '2024-02-29',
  visits: ['2024-03', '2024-04'], uploads: ['2024-03'], regencias: ['2024-08-29'], setenaStart: '2024-02-29',
  deliveries: {
    'm:2024-03': { visit: '2024-03-28', uploaded: '2024-03-30', files: [],
      notes: 'Llevar casco\nSETENA 28/03/2024: Visita de inspección.\nSe observa avance.\nSETENA 30/03/2024: Fotos adjuntas.' },
    'r:2024-08-29': { letter: '2024-08-20', uploaded: '2024-08-29', received: '2024-09-02', files: [] }
  },
  docs: { '2024-08-29_ab12cd34.pdf': { kind: 'regencia', ira: 'IRA-I-2024', period: 'Agosto 2023 - Enero 2024', placed: true }, 'scan.pdf': { kind: 'notext', placed: false } }
}] });
const t = timelineOf(d.projects[0]);
const find = (title: string) => t.filter(x => x.title === title);

// newest first
for (let i = 1; i < t.length; i++) assert.ok(t[i - 1].date >= t[i].date, 'sorted newest first');
// SETENA entries with their date; a line after an entry belongs to it; the user's own line is the month note
const s = t.filter(x => x.kind === 'setena');
assert.deepEqual(s.map(x => x.date), ['2024-03-30', '2024-03-28']);
assert.equal(s[1].text, 'Visita de inspección.\nSe observa avance.');
assert.equal(find('📝 Nota del mes')[0].text, 'Llevar casco');
// dated tasks are exact; April's visit (ticked in an old version, no date) falls on the opening day, cut to April
assert.deepEqual(find('Inspección').map(x => [x.date, x.exact]), [['2024-04-29', false], ['2024-03-28', true]]);
assert.equal(find('Llenado de bitácora').length, 0, 'the bitácora on the SETENA entry day is shown as that entry');
assert.equal(s[0].tag, '✓ bitácora', 'on the entry of the same day');
// a bitácora ticked in a month with no SETENA entry (e.g. «marcar todo como hecho») is kept and flagged
const b2 = normalize({ projects: [{ id: 'z', code: 'D1-0001-2024', name: 'Z', status: 'open', openedOn: '2024-01-14',
  deliveries: { 'm:2024-05': { visit: '2024-05-14', uploaded: '2024-05-14', files: [] }, 'm:2024-06': { uploaded: '2024-06-14', files: [], notes: 'SETENA 25/06/2024: Avance.' } } }] }).projects[0];
const t2 = timelineOf(b2);
assert.equal(t2.find(x => x.title === 'Llenado de bitácora')?.date, '2024-05-14');
assert.match(t2.find(x => x.title === 'Llenado de bitácora')!.tag!, /marcada en la app/);
assert.equal(t2.filter(x => x.title === 'Llenado de bitácora').length, 1, 'June is proven by the entry of 25/06, another day of the same month');
assert.equal(t2.find(x => x.kind === 'setena')!.tag, '✓ bitácora');
// regencia steps, receipt, the PDF read by the scanner; files without a date in the name are left out
assert.equal(find('Regencia subida a SETENA').length, 0, 'shown as the regencia PDF of that day');
assert.equal(find('Elaboración de regencia')[0].date, '2024-08-20', 'another day: kept');
assert.equal(find('Regencia presentada').length, 0, 'not duplicated when the delivery has its date');
assert.equal(find('Nota de recibido de la regencia')[0].date, '2024-09-02');
assert.equal(find('Informe de regencia IRA-I-2024')[0].text, 'Periodo Agosto 2023 - Enero 2024');
assert.equal(find('Informe de regencia IRA-I-2024')[0].tag, 'PDF · ✓ subida');
assert.ok(!t.some(x => x.title.includes('escaneado')));
assert.equal(t[t.length - 1].kind, 'start');
// v52 look migration: old data switches to light + SETENA blue once, newer data keeps its choice
const old = normalize({ settings: { theme: 'dark', accent: '#4ade80' } }).settings;
assert.deepEqual([old.theme, old.accent, old.look], ['light', '#007dc4', 2]);
// v58: dark mode left with the SETENA blue gets its neon green back; a light-mode blue stays
assert.equal(normalize({ settings: { theme: 'dark', accent: '#007dc4', look: 1 } }).settings.accent, '#4ade80');
assert.equal(normalize({ settings: { theme: 'light', accent: '#007dc4', look: 1 } }).settings.accent, '#007dc4');
assert.equal(normalize({ settings: { theme: 'dark', accent: '#007dc4', look: 2 } }).settings.accent, '#007dc4', 'chosen again after v58: kept');
const kept = normalize({ settings: { theme: 'dark', accent: '#4ade80', look: 1 } }).settings;
assert.deepEqual([kept.theme, kept.accent], ['dark', '#4ade80']);
// photos uploaded to SETENA: one item per entry date; the inspection of that day is shown as those photos
const ph = normalize({ projects: [{ id: 'p', code: 'D1-0002-2024', name: 'P', status: 'closing', openedOn: '2024-01-14', setenaPhotos: { '2024-03-20': 12, '2024-05-02': 1 },
  deliveries: { 'm:2024-03': { visit: '2024-03-20', files: [] } } }] }).projects[0];
const tp = timelineOf(ph);
assert.deepEqual(tp.filter(x => x.kind === 'visit').map(x => [x.date, x.title, x.tag]), [['2024-05-02', '📷 1 foto en SETENA', 'fotos'], ['2024-03-20', '📷 12 fotos en SETENA', '✓ inspección']]);
// the client's signature: from the PDF (with who signed); the check of the same day is not repeated
const sg = normalize({ projects: [{ id: 's', code: 'D1-0003-2024', name: 'S', status: 'open', openedOn: '2024-03-12',
  deliveries: { 'r:2024-09-12': { signed: '2024-09-12', uploaded: '2024-11-11', files: [] } },
  docs: { '2024-11-11_12a34bb7.pdf': { kind: 'regencia', period: 'Septiembre 2024', clientSigned: '2024-09-12', clientName: 'LAURA URENA ALFARO', placed: true } } }] }).projects[0];
const ts = timelineOf(sg).filter(x => x.title.startsWith('🖊️'));
assert.deepEqual(ts.map(x => [x.date, x.title]), [['2024-09-12', '🖊️ Firmada por el cliente (LAURA URENA ALFARO)']]);
// everything read from a PDF survives saving and loading
const keptSg = normalize(JSON.parse(JSON.stringify({ projects: [sg] }))).projects[0].docs!['2024-11-11_12a34bb7.pdf'];
assert.equal(keptSg.clientSigned, "2024-09-12"); assert.equal(keptSg.clientName, "LAURA URENA ALFARO");
const kept2 = normalize({ projects: [{ id: 'k', code: 'D1-0004-2024', name: 'K', status: 'open', openedOn: '2024-01-01', docs: { 'a.pdf': { kind: 'regencia', project: 'LOTE I', place: 'Cartago, El Guarco, Tejar', lat: 9.84, lng: -83.96, noSig: true, placed: true } } }] }).projects[0].docs!['a.pdf'];
assert.deepEqual([kept2.project, kept2.place, kept2.lat, kept2.lng, kept2.noSig], ['LOTE I', 'Cartago, El Guarco, Tejar', 9.84, -83.96, true]);
// the same regencia uploaded twice the same day: one item, ×2
const dup = normalize({ projects: [{ id: 'd', code: 'D1-0005-2020', name: 'D', status: 'closing', openedOn: '2020-11-23',
  docs: { '2023-06-16_aaaa1111.pdf': { kind: 'regencia', ira: 'IRA-I-2023', final: true, period: 'Diciembre 2022 - Mayo 2023', placed: true }, '2023-06-16_bbbb2222.pdf': { kind: 'regencia', ira: 'IRA-I-2023', final: true, period: 'Diciembre 2022 - Mayo 2023', placed: true } } }] }).projects[0];
const td = timelineOf(dup).filter(x => x.title.startsWith('Informe'));
assert.equal(td.length, 1); assert.equal(td[0].count, 2);
// «Renuncia»: the last SETENA entry says the regente resigned → that state (once); SETENA's «Abierta» doesn't undo it
const rz = normalize({ projects: [{ id: 'r', code: 'D1-0170-2020', name: 'CONDOMINIO VISTA DEL BOSQUE', status: 'open', openedOn: '2022-01-14',
  deliveries: { 'm:2023-08': { files: [], notes: 'SETENA 28/08/2023: El proyecto cuenta con toda la infraestructura construida' },
    'm:2024-02': { files: [], notes: 'SETENA 29/02/2024: Se procede a presentar informe de Regencia Ambiental I-2024. Se presenta nota de Renuncia' } } }] });
assert.equal(resignedInSetena(rz.projects[0]), true);
rz.projects[0].status = 'resigned'; rz.projects[0].resignChecked = true;
assert.equal(resignedInSetena(rz.projects[0]), false, 'only once');
const back = normalize(JSON.parse(JSON.stringify(rz)));
assert.deepEqual([back.projects[0].status, back.projects[0].resignChecked], ['resigned', true], 'kept when saved');
back.projects[0].status = 'open';
assert.equal(resignedInSetena(back.projects[0]), false, 'changed back to Abierta by hand: not moved again');
back.projects[0].status = 'resigned';
applySetena(back, { projects: [{ code: 'D1-0170-2020', name: 'CONDOMINIO VISTA DEL BOSQUE', status: 'Abierta', closed: false, events: [] }] } as any, '2026-11-27');
assert.equal(back.projects[0].status, 'resigned', 'SETENA still says «Abierta»: Renuncia stays');
applySetena(back, { projects: [{ code: 'D1-0170-2020', name: 'CONDOMINIO VISTA DEL BOSQUE', status: 'Cerrada', closed: true, events: [] }] } as any, '2026-11-27');
assert.equal(back.projects[0].status, 'finished', 'SETENA closes it: Terminada');
// an entry that only mentions «renuncia» earlier, not the last one: no change
const rz2 = normalize({ projects: [{ id: 'q', code: 'D1-0001-2021', name: 'Q', status: 'open', openedOn: '2021-01-01',
  deliveries: { 'm:2023-01': { files: [], notes: 'SETENA 10/01/2023: Se presenta nota de renuncia del maestro de obras' }, 'm:2023-05': { files: [], notes: 'SETENA 10/05/2023: Avance normal.' } } }] });
assert.equal(resignedInSetena(rz2.projects[0]), false);
console.log('timeline OK:', t.length, 'events');
process.exit(0);
