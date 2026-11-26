import { checkForUpdate } from '../src/lib/search';
import { normalize } from '../src/lib/store';
import assert from 'node:assert';
const d = normalize({ projects: [
  { id: 'a', code: 'D1-0170-2020', name: 'URBANIZACIÓN VISTA DEL BOSQUE', status: 'open' },
  { id: 'b', code: 'D1-0245-2019', name: 'Planta Las Brisas', status: 'closing', notes: 'regente Ana' },
  { id: 'a', code: 'D1-0999-2021', name: 'Id repetido', status: 'new' },
]});
const ids = (q: string) => checkForUpdate(d, q).map(b => b.code);
const cases: [string, string[]][] = [
  ['urbanizacion', ['D1-0170-2020']], ['URBANIZACIÓN', ['D1-0170-2020']], ['vista bosque', ['D1-0170-2020']],
  ['D1-0170-2020', ['D1-0170-2020']], ['d1 170 2020', ['D1-0170-2020']], ['d101702020', ['D1-0170-2020']], ['0170', ['D1-0170-2020']],
  ['D1-170-2020', ['D1-0170-2020']], ['closing', ['D1-0245-2019']], ['solicitud de cierre', ['D1-0245-2019']], ['new', ['D1-0999-2021']],
  ['brisas', ['D1-0245-2019']], ['ana', ['D1-0245-2019']], ['2019', ['D1-0245-2019']], ['d1', ['D1-0170-2020', 'D1-0245-2019', 'D1-0999-2021']],
];
for (const [q, expected] of cases) assert.deepEqual(ids(q), expected, `«${q}» → ${ids(q)}`);
assert.equal(new Set(d.projects.map(b => b.id)).size, 3, 'duplicated ids are fixed');
console.log('search OK:', cases.length, 'cases');
process.exit(0);
