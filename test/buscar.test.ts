import { buscar } from '../src/lib/buscar';
import { normalizar } from '../src/lib/store';
import assert from 'node:assert';
const d = normalizar({ bitacoras: [
  { id: 'a', numero: 'D1-0170-2020', nombre: 'URBANIZACIÓN VISTA DEL BOSQUE', estado: 'abierta' },
  { id: 'b', numero: 'D1-0245-2019', nombre: 'Planta Las Brisas', estado: 'cierre', notas: 'regente Ana' },
  { id: 'a', numero: 'D1-0999-2021', nombre: 'Id repetido', estado: 'nueva' },
]});
const ids = (q: string) => buscar(d, q).map(b => b.numero);
const casos: [string, string[]][] = [
  ['urbanizacion', ['D1-0170-2020']], ['URBANIZACIÓN', ['D1-0170-2020']], ['vista bosque', ['D1-0170-2020']],
  ['D1-0170-2020', ['D1-0170-2020']], ['d1 170 2020', ['D1-0170-2020']], ['d101702020', ['D1-0170-2020']], ['0170', ['D1-0170-2020']],
  ['D1-170-2020', ['D1-0170-2020']], ['cierre', ['D1-0245-2019']], ['solicitud de cierre', ['D1-0245-2019']], ['nueva', ['D1-0999-2021']],
  ['brisas', ['D1-0245-2019']], ['ana', ['D1-0245-2019']], ['2019', ['D1-0245-2019']], ['d1', ['D1-0170-2020', 'D1-0245-2019', 'D1-0999-2021']],
];
for (const [q, esp] of casos) assert.deepEqual(ids(q), esp, `«${q}» → ${ids(q)}`);
assert.equal(new Set(d.bitacoras.map(b => b.id)).size, 3, 'ids repetidos se reparan');
console.log('buscador OK:', casos.length, 'casos');
process.exit(0);
