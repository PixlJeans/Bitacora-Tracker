// ===== Reminder cards inside the app (port of the Cognose reminder cards) =====
// They arrive together with the native system notification. Buttons: mark done · Open · Snooze · Dismiss.
import { useEffect, useState } from 'react';
import type { Reminder, Snoozed } from '../lib/types';
import { backend } from '../lib/backend';
import { markRegencia, markMonth, mutate, useAppData } from '../lib/store';
import { shortDate, monthNameOf } from '../lib/dates';
import { Ic, toast } from './core';
import { openEditor } from './ProjectEditor';

const base = (k: string) => k.split('@')[0];
const monthOf = (a: Reminder) => base(a.key).split(':')[2];
const dueOf = (a: Reminder) => base(a.key).split(':')[2];

export function goToView(v: string) { window.dispatchEvent(new CustomEvent('bt:view', { detail: v })); }

export function ReminderCards() {
  const d = useAppData();   // re-renders when a visit / upload is marked
  const [cards, setCards] = useState<Reminder[]>([]);
  useEffect(() => {
    backend.onReminder(newOnes => setCards(cs => {
      const keys = new Set(cs.map(c => base(c.key)));
      return [...newOnes.filter(n => !keys.has(base(n.key))), ...cs].slice(0, 30);
    }));
  }, []);
  const dismiss = (k: string) => setCards(cs => cs.filter(c => c.key !== k));

  function snooze(a: Reminder, ms: number, txt: string) {
    const p: Snoozed = { key: base(a.key), at: Date.now() + ms, title: a.title, body: a.body, kind: a.kind, ref: a.ref };
    mutate(d => { d.snoozed = [...d.snoozed.filter(x => x.key !== p.key), p]; }, { undo: false });
    dismiss(a.key);
    toast(`Aviso pospuesto ${txt}`);
  }

  const monthly = cards.filter(c => c.kind === 'monthly');
  const regencias = cards.filter(c => c.kind === 'regencia');
  const group = monthly.length > 2, groupRegencias = regencias.length > 2;
  const others = cards.filter(c => !(group && c.kind === 'monthly') && !(groupRegencias && c.kind === 'regencia'));
  const visible = others;
  const withoutKind = (k: string) => setCards(cs => cs.filter(c => c.kind !== k));
  if (!cards.length) return null;

  return (
    <div className="reminders">
      {group && (
        <div className="reminder" style={{ ['--ev' as any]: 'var(--accent)' }}>
          <div className="reminder-head"><Ic n="bell" /><span className="reminder-title">📋 {monthly.length} Informes Regenciales: inspección + informe</span>
            <button className="icon-btn sm" onClick={() => withoutKind('monthly')} title="Descartar"><Ic n="close" /></button></div>
          <div className="reminder-body">{monthly.slice(0, 3).map(m => m.title.split(' · ')[1]).join(' · ')}…</div>
          <div className="reminder-btns">
            <button className="btn primary sm" onClick={() => { goToView('month'); withoutKind('monthly'); }}>Ver mes actual</button>
            <button className="btn ghost sm" onClick={() => withoutKind('monthly')}>Descartar</button>
          </div>
        </div>
      )}
      {groupRegencias && (
        <div className="reminder" style={{ ['--ev' as any]: '#a78bfa' }}>
          <div className="reminder-head"><Ic n="review" /><span className="reminder-title">🗂️ {regencias.length} Regencias por entregar</span>
            <button className="icon-btn sm" onClick={() => withoutKind('regencia')} title="Descartar"><Ic n="close" /></button></div>
          <div className="reminder-body">{regencias.slice(0, 3).map(m => m.title.split(' · ')[1]).join(' · ')}…</div>
          <div className="reminder-btns">
            <button className="btn primary sm" onClick={() => { goToView('regencias'); withoutKind('regencia'); }}>Ver Regencias</button>
            <button className="btn ghost sm" onClick={() => withoutKind('regencia')}>Descartar</button>
          </div>
        </div>
      )}
      {visible.map(a => {
        const b = d.projects.find(x => x.id === a.ref) ?? null;
        const color = b ? d.labels.find(e => e.id === b.labelId)?.color : undefined;
        return (
          <div key={a.key} className="reminder" style={{ ['--ev' as any]: color || 'var(--accent)' }}>
            <div className="reminder-head"><Ic n={a.kind === 'regencia' ? 'review' : 'bell'} /><span className="reminder-title">{a.title}</span>
              <button className="icon-btn sm" onClick={() => dismiss(a.key)} title="Descartar"><Ic n="close" /></button></div>
            <div className="reminder-body">{a.body}</div>
            <div className="reminder-btns">
              {a.kind === 'monthly' && b && <>
                {!b.visits.includes(monthOf(a)) && <button className="btn primary sm" onClick={() => { markMonth(b.id, monthOf(a), 'visit'); toast(`✓ ${b.code}: inspección de ${monthNameOf(monthOf(a))}`, true); if (b.uploads.includes(monthOf(a))) dismiss(a.key); }}>Inspección ✓</button>}
                {!b.uploads.includes(monthOf(a)) && <button className="btn primary sm" onClick={() => { markMonth(b.id, monthOf(a), 'upload'); toast(`✓ ${b.code}: Informe Regencial de ${monthNameOf(monthOf(a))} presentado`, true); if (b.visits.includes(monthOf(a))) dismiss(a.key); }}>Informe ✓</button>}
                <button className="btn sm" onClick={() => { dismiss(a.key); openEditor(b); }}>Abrir</button>
              </>}
              {a.kind === 'regencia' && b && <>
                <button className="btn primary sm" onClick={() => { markRegencia(b.id, dueOf(a)); dismiss(a.key); toast(`✓ ${b.code}: Regencia del ${shortDate(dueOf(a))} presentada`, true); }}>Presentada ✓</button>
                <button className="btn sm" onClick={() => { dismiss(a.key); goToView('regencias'); }}>Ver Regencias</button>
              </>}
              {a.kind !== 'test' && <>
                <button className="btn sm" onClick={() => snooze(a, 3600e3, '1 hora')}>+1 h</button>
                <button className="btn sm" onClick={() => snooze(a, 864e5, 'hasta mañana')}>Mañana</button>
              </>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
