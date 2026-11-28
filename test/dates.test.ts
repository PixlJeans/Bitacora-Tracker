// The project's dates as a list (v69): each regencia with its real dates; pending ones with their due date.
import assert from 'node:assert';
import { normalize, replaceAll, getData } from '../src/lib/store';
import { regenciaRows, monthRows, nextDates } from '../src/lib/projectDates';
import { backend } from '../src/lib/backend';
import { scanFolders } from '../src/lib/scan';

const today = '2026-11-27';
const d = normalize({ projects: [{
  id: 'a', code: 'D1-0950-2023', name: 'CERRITOS', status: 'open', openedOn: '2025-11-14', createdOn: '2025-11-14', noOpeningDate: false,
  visits: ['2026-10'], uploads: ['2026-10'],
  deliveries: {
    'm:2026-10': { visit: '2026-10-22', uploaded: '2026-10-22', files: [] },
    // left by an older version from the initial report (signed 11 dic 25, uploaded 15 dic 25)
    'r:2026-05-14': { letter: '2025-12-11', signed: '2025-12-11', files: [] },
    'r:2026-11-14': { due: '2026-12-14', files: [] }
  },
  docs: {
    '2025-12-15_aaaa1111.pdf': { kind: 'regencia', ira: 'IRA-I-2025', period: 'Noviembre - Diciembre del 2025', clientSigned: '2025-12-11', placed: true },
    '2026-07-23_68abcf2c.pdf': { kind: 'regencia', ira: 'IRA-I-2026', period: 'Enero - Junio 2026', uploadedIn: 'D1-0211-2023', misfiled: true, placed: true }
  }
}] });
const b = d.projects[0];
const rows = regenciaRows(b, today);
assert.deepEqual(rows.map(r => [r.key, r.state, r.uploaded ?? r.due]), [
  ['2027-05-14', 'future', '2027-05-14'],
  ['2026-11-14', 'soon', '2026-12-14'],
  ['2026-05-14', 'late', '2026-05-14'],
  [null, 'done', '2025-12-15']
]);
assert.match(rows[2].note!, /bitácora de D1-0211-2023/, 'the misfiled one is pointed out on its semester');
assert.equal(rows[2].ira, 'IRA-I-2026');
assert.match(rows[3].note!, /fuera de los semestres/);
const m = monthRows(b, today, 3);
assert.deepEqual(m.map(x => [x.mk, x.state]), [['2026-12', 'soon'], ['2026-11', 'late'], ['2026-10', 'done'], ['2026-09', 'history']]);
assert.equal(m[2].visit, '2026-10-22');
const n = nextDates(b, today);
assert.equal(n.insp, '2026-11-14'); assert.equal(n.reg?.key, '2026-05-14');

// the scanner clears the Elaboración / Firma that came from the initial report
replaceAll(d);
(backend as any).listTree = async (f: string) => [{ path: `${f}/2025/12 - Diciembre/Regencias/2025-12-15_aaaa1111.pdf`, size: 1, modified: 0 }].filter(x => x.path.includes('D1-0950'));
(backend as any).moveAttachment = async (p: string) => p;
await scanFolders(true);
const e = getData().projects[0].deliveries!['r:2026-05-14'];
assert.equal(e.letter, null); assert.equal(e.signed ?? null, null);
console.log('dates OK');
process.exit(0);
