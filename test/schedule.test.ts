import { computeReminders, monthState, monthlyDue, pendingThisMonth, nextRegencia, summary, dueInMonth } from '../src/lib/schedule';
import { normalize } from '../src/lib/store';
import assert from 'node:assert';

// Opened Jan 15 2026 → monthly on the 15th of each month; Regencia Jul 15 2026 (reminders from Jun 15)
const base = { createdOn: '2026-01-15', uploads: [], visits: [], regencias: [], noOpeningDate: false };
const d = normalize({
  projects: [
    { ...base, id: 'a', code: 'D1-0170-2026', name: 'VISTA DEL BOSQUE', status: 'open', openedOn: '2026-01-15' },
    { ...base, id: 'b', code: 'D1-0245-2019', name: 'LAS BRISAS', status: 'closing', openedOn: '2026-01-15' },
    { ...base, id: 'c', code: 'D1-0412-2020', name: 'LOS ROBLES', status: 'finished', openedOn: '2026-01-15' },
    { ...base, id: 'e', code: 'D1-0500-2026', name: 'FIN DE MES', status: 'new', openedOn: '2026-01-31' },
    { ...base, id: 'f', code: 'D1-0600-2026', name: 'ARCHIVADA', status: 'open', openedOn: '2026-01-15', archived: true },
  ],
  blocks: [{ id: 'x' }], settings: { reminderTime: '07:30', defaultReminderDay: 5 }
});
assert(!('bloques' in d), 'time blocks are gone');
const [a, bC, c, e, f] = d.projects;
// monthly: same day as the opening, from the following month
assert.equal(dueInMonth(a, '2026-01'), false, 'the opening month has no Informe Regencial');
assert.equal(monthlyDue(a, '2026-02'), '2026-02-15');
assert.equal(monthlyDue(e, '2026-02'), '2026-02-28', 'day 31 → end of February');
assert(!dueInMonth(bC, '2026-03'), 'closing request = finished: no monthly delivery');
assert(!dueInMonth(c, '2026-03') && !dueInMonth(f, '2026-03'), 'finished and archived: none');
// informe regencial
assert.equal(nextRegencia(a, '2026-06-10')!.due, '2026-07-15');
assert.equal(nextRegencia(a, '2026-06-10')!.from, '2026-06-15');
assert.equal(nextRegencia(c, '2026-06-10'), null);
const t = new Date(2026, 5, 10, 12).getTime();
const av = computeReminders(d, t);
assert(av.some(x => x.key === 'm:a:2026-06') && !av.some(x => x.ref === 'b'));
assert(!av.some(x => x.ref === 'c' || x.ref === 'f'), 'no reminders for finished/archived');
const m = av.find(x => x.key === 'm:a:2026-06')!;
assert.equal(new Date(m.at).getDate(), 15); assert.equal(new Date(m.at).getHours(), 7);
assert.equal(new Date(av.find(x => x.key.startsWith('i:a:2026-07-15'))!.at).toDateString(), new Date(2026, 5, 15).toDateString());
// month states (calendar)
a.uploads.push('2026-04'); a.visits.push('2026-04'); a.uploads.push('2026-05');
assert.equal(monthState(a, '2026-01', '2026-06-20'), 'outside');
assert.equal(monthState(a, '2026-03', '2026-06-20'), 'overdue');
assert.equal(monthState(a, '2026-04', '2026-06-20'), 'done');
assert.equal(monthState(a, '2026-05', '2026-06-20'), 'partial');
assert.equal(monthState(a, '2026-06', '2026-06-10'), 'today');
assert.equal(monthState(a, '2026-06', '2026-06-20'), 'overdue');
assert.equal(monthState(a, '2026-08', '2026-06-20'), 'future');
console.log('pending on Jun 20:', pendingThisMonth(d, '2026-06-20').map(b => b.code));
console.log(summary(d, '2026-06-20'));
console.log('OK');
process.exit(0);
