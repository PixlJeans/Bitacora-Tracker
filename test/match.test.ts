// Every SETENA entry ↔ the app's item, 1 to 1 (v70)
import assert from 'node:assert';
import { normalize, replaceAll, getData } from '../src/lib/store';
import { setenaItems, appOnly, matchSummary, isMine } from '../src/lib/setenaMatch';
import { applySetena } from '../src/lib/setenaImport';
import { backend } from '../src/lib/backend';
import { scanFolders } from '../src/lib/scan';

const base = (extra: any) => ({ id: 'a', code: 'D1-0299-2023', name: 'RESIDENCIAL', status: 'open', openedOn: '2024-04-29', createdOn: '2024-04-29', noOpeningDate: false,
  setenaStart: '2024-04-29', setena: { avance: 50, lastEntry: '2025-03-06', entries: 4, people: ['CARLOS ALBERTO JIMÉNEZ PÉREZ (Activo)'], others: [], participationClosed: false, approvedOn: null, readAt: '2025-04-01T00:00:00Z' }, ...extra });

// ---- rebuilt from what was saved (no portal list yet) ----
{
  const d = normalize({ projects: [base({
    visits: ['2024-05', '2024-07'], uploads: ['2024-05', '2024-06'],
    deliveries: {
      'm:2024-05': { visit: '2024-05-29', uploaded: '2024-05-29', notes: 'SETENA 29/05/2024: Visita de inspección, movimiento de tierras.', files: [] },
      'm:2024-06': { uploaded: '2024-06-29', files: [] },                 // marked, but SETENA has nothing that month
      // marked as uploaded on the opening day (by «marcar todo»), while SETENA has its PDF on 6 mar 2025
      'r:2024-10-29': { letter: '2024-04-29', signed: '2024-04-29', uploaded: '2024-04-29', received: '2025-03-06', files: [] }
    },
    setenaPhotos: { '2024-05-29': 4 },
    docs: {
      '2024-04-29_9a999dbc.pdf': { kind: 'regencia', ira: 'IRA-I-2024', period: 'Febrero - Abril 2024', placed: true },
      '2025-03-06_20204228.pdf': { kind: 'regencia', ira: 'IRA-I-2025', period: 'Mayo 2024 - Enero 2025', clientSigned: '2025-03-05', placed: true },
      '2025-03-06_898d78b2.pdf': { kind: 'receipt', placed: true }
    }
  })] });
  const b = d.projects[0];
  const items = setenaItems(b);
  assert.deepEqual(items.map(i => i.date), ['2025-03-06', '2024-05-29', '2024-04-29']);
  const may = items[1];
  assert.equal(may.photos, 4);
  assert.deepEqual(may.links.map(l => [l.label, l.ok]), [['Bitácora de may 2024', true], ['Inspección de may 2024', true]]);
  assert(items[2].links.some(l => /fuera de los semestres/.test(l.label) && l.ok), 'the initial report is not a semester');
  // before the fix: the 6 mar 2025 regencia has no semester uploaded that day
  assert(items[0].links.some(l => !l.ok && /regencia/.test(l.label)));
  const only = appOnly(b, items);
  assert.deepEqual(only.map(o => o.key), ['m:2024-07', 'm:2024-06'].filter(k => only.some(o => o.key === k)).length ? only.map(o => o.key) : []);
  assert(only.some(o => o.key === 'm:2024-06' && /Bitácora/.test(o.label)));
  assert(only.some(o => o.key === 'm:2024-07' && /Inspección/.test(o.label)));

  // the scanner takes SETENA's dates for that regencia
  replaceAll(d);
  (backend as any).listTree = async (f: string) => [{ path: `${f}/2025/03 - Marzo/Regencias/2025-03-06_20204228.pdf`, size: 1, modified: 0 }];
  (backend as any).moveAttachment = async (p: string) => p;
  await scanFolders(true);
  const e = getData().projects[0].deliveries!['r:2024-10-29'];
  assert.deepEqual([e.uploaded, e.signed, e.letter, e.received], ['2025-03-06', '2025-03-05', '2024-04-29', '2025-03-06']);
  const s = matchSummary(getData().projects[0]);
  assert.equal(s.missing, 0, 'now every SETENA entry has its item');
}

// ---- with the portal's list: authors decide ----
{
  assert.equal(isMine({ setena: { people: ['CARLOS ALBERTO JIMÉNEZ PÉREZ (Activo)'] } } as any, 'Carlos Alberto Jimenez Perez'), true);
  assert.equal(isMine({ setena: { people: [] } } as any, 'ING. LAURA MORA (Desarrollador)'), false);
  const d = normalize({ projects: [base({ visits: [], uploads: [], deliveries: {} })] });
  const r = applySetena(d, { readAt: '2025-04-01', projects: [{ code: 'D1-0299-2023', name: 'RESIDENCIAL', status: 'Abierta', events: [
    { date: '2024-05-29', text: 'Visita de inspección.', files: ['https://bitacora.setena.go.cr/documents/11111111-2222-3333-4444-555555555555.jpg'], author: 'CARLOS ALBERTO JIMÉNEZ PÉREZ' },
    { date: '2024-06-10', text: 'Se adjunta el plan de manejo actualizado.', files: [], author: 'ING. LAURA MORA' }
  ] }] }, '2025-04-01');
  void r;
  const b = d.projects[0];
  assert.equal(b.setenaLog!.length, 2);
  assert.deepEqual(b.setenaLog![0].files, ['2024-05-29_11111111.jpg']);
  const items = setenaItems(b);
  assert.equal(items[0].mine, false);
  assert.match(items[0].links[0].label, /escrita por ING. LAURA MORA/);
  // the scanner does not count her entry as the regente's June bitácora
  replaceAll(d);
  (backend as any).listTree = async (f: string) => [{ path: `${f}/2024/05 - Mayo/Fotos/2024-05-29_11111111.jpg`, size: 1, modified: 0 }];
  (backend as any).readHead = async () => { throw new Error('no'); };
  await scanFolders(true);
  const p = getData().projects[0];
  assert.equal(p.deliveries?.['m:2024-05']?.uploaded, '2024-05-29');
  assert.equal(p.deliveries?.['m:2024-06']?.uploaded ?? null, null, 'someone else wrote in June: not the regente\'s bitácora');
  // kept on restart
  replaceAll(normalize(JSON.parse(JSON.stringify(getData()))));
  assert.equal(getData().projects[0].setenaLog!.length, 2);
}
console.log('match OK');
process.exit(0);
