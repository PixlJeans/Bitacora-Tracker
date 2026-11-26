import assert from 'node:assert';
import { normalize } from '../src/lib/store';
import { timelineOf } from '../src/lib/timeline';

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
assert.equal(s[0].tag, '✓ bitácora');
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
assert.deepEqual([old.theme, old.accent, old.look], ['light', '#007dc4', 1]);
const kept = normalize({ settings: { theme: 'dark', accent: '#4ade80', look: 1 } }).settings;
assert.deepEqual([kept.theme, kept.accent], ['dark', '#4ade80']);
console.log('timeline OK:', t.length, 'events');
process.exit(0);
