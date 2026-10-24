import { calcularAvisos, pendientesDelMes, proximaSemestral, resumen } from '../src/lib/avisos';
import { normalizar } from '../src/lib/store';
import assert from 'node:assert';
const now = new Date(2026, 9, 23, 10, 0).getTime(); // 23 oct 2026 10:00
const d = normalizar({
  bitacoras: [
    { id: 'a', numero: 'D1-0170-2020', nombre: 'VISTA DEL BOSQUE', estado: 'abierta', diaAviso: 5, fechaInicio: '2026-01-01', registros: [] },
    { id: 'b', numero: 'D1-0245-2019', nombre: 'LAS BRISAS', estado: 'cierre', diaAviso: 5, fechaInicio: '2026-01-01', registros: [] },
    { id: 'c', numero: 'D1-0412-2022', nombre: 'LOS ROBLES', estado: 'nueva', diaAviso: 28, fechaInicio: '2026-10-23', registros: [] },
    { id: 'e', numero: 'D1-0533-2023', nombre: 'SOLAR', estado: 'abierta', diaAviso: 2, fechaInicio: '2026-01-01', registros: ['2026-10'] },
  ],
  ajustes: { semestralInicio: '2026-07-15', horaAviso: '08:00' }
});
const av = calcularAvisos(d, now);
const keys = av.map(a => a.key);
// mensual: abierta y nueva sí; cierre no
assert(keys.includes('m:a:2026-10'), 'a debe tener aviso de octubre (vencido, se dispara al abrir)');
assert(!keys.some(k => k.startsWith('m:b:')), 'Solicitud de cierre NO genera aviso mensual');
assert(keys.includes('m:c:2026-10'), 'c: día 28 ≥ inicio 23 oct');
assert(!keys.includes('m:e:2026-10') && keys.includes('m:e:2026-11'), 'e: octubre registrado → empieza en noviembre');
assert.equal(av.filter(a => a.key.startsWith('m:a:')).length, 12, '12 meses programados');
// semestral
assert(keys.includes('s:2027-01-15'), 'semestral siguiente');
assert(!keys.includes('s:2026-07-15'), 'la de julio ya venció su ventana de 30 días');
const sem = av.find(a => a.key === 's:2027-01-15')!;
assert(sem.body.includes('1 en solicitud de cierre'), 'el resumen semestral incluye las de cierre: ' + sem.body);
// días cortos
const feb = av.find(a => a.key === 'm:c:2027-02')!;
assert.equal(new Date(feb.at).getDate(), 28);
assert.equal(new Date(feb.at).getHours(), 8);
console.log('pendientes:', pendientesDelMes(d, '2026-10-23').map(b => b.numero));
console.log('resumen:', resumen(d, '2026-10-23'));
console.log('semestral:', proximaSemestral(d, '2026-10-23'));
console.log('OK —', av.length, 'avisos');
process.exit(0);
