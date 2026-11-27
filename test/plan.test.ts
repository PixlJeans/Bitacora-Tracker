import assert from 'node:assert';
import { planDays, planWeek } from '../src/lib/plan';

// days: Monday–Friday from today on; on a weekend, the days left; a past week, its Monday–Friday
assert.deepEqual(planDays('2026-11-23', '2026-11-25'), ['2026-11-25', '2026-11-26', '2026-11-27']);
assert.deepEqual(planDays('2026-11-23', '2026-11-28'), ['2026-11-28', '2026-11-29'], 'Saturday: the weekend left');
assert.deepEqual(planDays('2026-11-30', '2026-11-27'), ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04'], 'next week');
assert.deepEqual(planDays('2026-11-16', '2026-11-27'), ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'], 'a past week');

const P = (id: string, lat: number, lng: number | null) => ({ id, code: id, location: lng === null ? null : { lat, lng, text: '', source: 'photo' } }) as any;
const S = (id: string, lat: number, lng: number | null, date: string) => ({ b: P(id, lat, lng), date });
const days = ['2026-11-30', '2026-12-01', '2026-12-02'];
// Cartago cluster (3), Heredia cluster (2), one in Liberia, one without location, one already on Tuesday
const stops = [
  S('C1', 9.86, -83.92, '2026-10-04'), S('C2', 9.87, -83.91, '2026-11-04'), S('C3', 9.84, -83.96, '2026-11-09'),
  S('H1', 10.00, -84.12, '2026-10-19'), S('H2', 10.01, -84.10, '2026-11-19'),
  S('L1', 10.63, -85.44, '2026-11-02'), S('X', 0, null, '2026-11-01'), S('T', 9.93, -84.08, '2026-12-01')];
const r = planWeek(stops, days, 15);
const ids = (d: string) => r.days.find(x => x.day === d)?.stops.map(s => s.b.id).sort() ?? [];
assert.deepEqual(r.withoutLocation.map(s => s.b.id), ['X']);
assert.deepEqual(ids('2026-12-01').includes('T'), true, 'a stop due / scheduled that day keeps it');
assert.deepEqual(ids('2026-11-30'), ['C1', 'C2', 'C3'], 'the most urgent trip (since Oct 4) on the first free day, nearby projects together');
assert.ok(ids('2026-12-02').includes('H1') && ids('2026-12-02').includes('H2'), 'Heredia trip together on the emptiest day');
assert.equal(r.days.reduce((n, x) => n + x.stops.length, 0), 7, 'every stop with a location planned once');
// a big group is split so no day gets more than maxPerDay
const many = Array.from({ length: 9 }, (_, i) => S('M' + i, 9.9 + i * 0.005, -84.0, `2026-11-0${i + 1}`));
const r2 = planWeek(many, days, 15, 4);
assert.ok(r2.days.every(x => x.stops.length <= 4) && r2.days.reduce((n, x) => n + x.stops.length, 0) === 9, JSON.stringify(r2.days.map(x => x.stops.length)));
// more than fits in the days left (Friday): 6 on Friday, the rest waits for next week's plan
const r3 = planWeek(many, ['2026-11-27'], 15, 6);
assert.equal(r3.days[0].stops.length, 6); assert.equal(r3.overflow.length, 3);
assert.deepEqual(r3.days[0].stops.map(s => s.b.id).sort(), ['M0', 'M1', 'M2', 'M3', 'M4', 'M5'], 'the most urgent go first');
console.log('plan OK');
process.exit(0);
