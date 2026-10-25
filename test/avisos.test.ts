import { calcularAvisos, estadoMes, fechaMensual, pendientesDelMes, proximoInforme, resumen, tocaEnMes } from '../src/lib/avisos';
import { normalizar } from '../src/lib/store';
import assert from 'node:assert';

// Abre 15 ene 2026 → mensual el 15 de cada mes; informe 15 jul 2026 (avisos desde 15 jun)
const base = { creada: '2026-01-15', registros: [], inspecciones: [], informes: [] };
const d = normalizar({
  bitacoras: [
    { ...base, id: 'a', numero: 'D1-0170-2026', nombre: 'VISTA DEL BOSQUE', estado: 'abierta', apertura: '2026-01-15' },
    { ...base, id: 'b', numero: 'D1-0245-2019', nombre: 'LAS BRISAS', estado: 'cierre', apertura: '2026-01-15' },
    { ...base, id: 'c', numero: 'D1-0412-2020', nombre: 'LOS ROBLES', estado: 'terminada', apertura: '2026-01-15' },
    { ...base, id: 'e', numero: 'D1-0500-2026', nombre: 'FIN DE MES', estado: 'nueva', apertura: '2026-01-31' },
    { ...base, id: 'f', numero: 'D1-0600-2026', nombre: 'ARCHIVADA', estado: 'abierta', apertura: '2026-01-15', archivada: true },
  ],
  bloques: [{ id: 'x' }], ajustes: { horaAviso: '07:30', diaAvisoDefecto: 5 }
});
assert(!('bloques' in d), 'ya no hay bloques');
const [a, bC, c, e, f] = d.bitacoras;
// mensual: mismo día de la apertura, desde el mes siguiente
assert.equal(tocaEnMes(a, '2026-01'), false, 'el mes de apertura no tiene revisión');
assert.equal(fechaMensual(a, '2026-02'), '2026-02-15');
assert.equal(fechaMensual(e, '2026-02'), '2026-02-28', 'día 31 → fin de febrero');
assert(tocaEnMes(bC, '2026-03'), 'Solicitud de cierre SÍ tiene revisión mensual');
assert(!tocaEnMes(c, '2026-03') && !tocaEnMes(f, '2026-03'), 'terminada y archivada no');
// informe regencial
assert.equal(proximoInforme(a, '2026-06-10')!.vence, '2026-07-15');
assert.equal(proximoInforme(a, '2026-06-10')!.desde, '2026-06-15');
assert.equal(proximoInforme(c, '2026-06-10'), null);
const t = new Date(2026, 5, 10, 12).getTime();
const av = calcularAvisos(d, t);
assert(av.some(x => x.key === 'm:a:2026-06') && av.some(x => x.key === 'm:b:2026-06'));
assert(!av.some(x => x.ref === 'c' || x.ref === 'f'), 'sin avisos para terminada/archivada');
const m = av.find(x => x.key === 'm:a:2026-06')!;
assert.equal(new Date(m.at).getDate(), 15); assert.equal(new Date(m.at).getHours(), 7);
assert.equal(new Date(av.find(x => x.key.startsWith('i:a:2026-07-15'))!.at).toDateString(), new Date(2026, 5, 15).toDateString());
// estado de los meses (mini-calendario)
a.registros.push('2026-04'); a.inspecciones.push('2026-04'); a.registros.push('2026-05');
assert.equal(estadoMes(a, '2026-01', '2026-06-20'), 'fuera');
assert.equal(estadoMes(a, '2026-03', '2026-06-20'), 'vencido');
assert.equal(estadoMes(a, '2026-04', '2026-06-20'), 'hecho');
assert.equal(estadoMes(a, '2026-05', '2026-06-20'), 'parcial');
assert.equal(estadoMes(a, '2026-06', '2026-06-10'), 'hoy');
assert.equal(estadoMes(a, '2026-06', '2026-06-20'), 'vencido');
assert.equal(estadoMes(a, '2026-08', '2026-06-20'), 'futuro');
console.log('pendientes 20 jun:', pendientesDelMes(d, '2026-06-20').map(b => b.numero));
console.log(resumen(d, '2026-06-20'));
console.log('OK');
process.exit(0);
