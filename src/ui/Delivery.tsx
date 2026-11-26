// ===== One delivery: Informe Regencial (monthly) or Regencia (every 6 months) =====
// Adjustable due date · 4 steps with the date each was done (Visit → Photos → Letter → Uploaded to SETENA)
// · space to write the letter to SETENA (a template will fill it later).
// Everything is saved to the data immediately.
import { useEffect, useRef, useState } from 'react';
import type { Project, Step } from '../lib/types';
import { MONTHLY_NAME, SEMIANNUAL_NAME, STEPS } from '../lib/types';
import { monthlyDue, monthlyDueAuto, regenciaDue } from '../lib/schedule';
import { shortDate, longDate, fromISO, monthNameOf, todayISO } from '../lib/dates';
import { editDelivery, deliveryOf, markStep } from '../lib/store';
import { backend } from '../lib/backend';
import { Ic, toast } from './core';
import { SETENA_URL } from './ProjectLog';

const DAY = 864e5;
export const daysUntil = (iso: string, today = todayISO()) => Math.round((fromISO(iso).getTime() - fromISO(today).getTime()) / DAY);
export function daysText(days: number) {
  if (days === 0) return 'hoy';
  if (days === 1) return 'mañana';
  if (days === -1) return 'ayer';
  return days > 0 ? `en ${days} días` : `hace ${-days} días`;
}

export const isMonthly = (key: string) => key.startsWith('m:');
export const deliveryTitle = (key: string) =>
  isMonthly(key) ? `${MONTHLY_NAME} · ${monthNameOf(key.slice(2))}` : `${SEMIANNUAL_NAME} (semestral)`;
export const autoDate = (b: Project, key: string) => isMonthly(key) ? monthlyDueAuto(b, key.slice(2)) : key.slice(2);
export const dueDate = (b: Project, key: string) => isMonthly(key) ? monthlyDue(b, key.slice(2)) : regenciaDue(b, key.slice(2));

/** Mini bar of the 4 steps (for lists). */
export function StepsMini({ b, itemKey: key }: { b: Project; itemKey: string }) {
  const e = deliveryOf(b, key);
  return (
    <span className="steps-mini" title={STEPS.map(p => `${p.name}: ${e[p.id] ? shortDate(e[p.id]!) : 'falta'}`).join(' · ')}>
      {STEPS.map(p => <i key={p.id} className={e[p.id] ? 'on' : ''}>{p.icon}</i>)}
    </span>
  );
}

export function DeliveryCard({ b, itemKey: key, isOpen = false }: { b: Project; itemKey: string; isOpen?: boolean }) {
  const today = todayISO();
  const e = deliveryOf(b, key);
  const due = dueDate(b, key), auto = autoDate(b, key);
  const adjusted = due !== auto;
  const done = isMonthly(key) ? !!(e.visit && e.uploaded) : !!e.uploaded;
  const days = daysUntil(due, today);
  const [showLetter, setShowLetter] = useState(isOpen || !!e.letterText);
  const [editingDate, setEditingDate] = useState(false);

  const step = (p: Step, date: string | null) => {
    markStep(b.id, key, p, date);
    const nameText = STEPS.find(x => x.id === p)!.name;
    toast(date ? `✓ ${b.code}: ${nameText} · ${shortDate(date)}` : `${b.code}: ${nameText} desmarcado`, true);
  };

  return (
    <div className={`delivery ${done ? 'completed' : days < 0 ? 'is-overdue' : ''} ${isMonthly(key) ? 'monthly' : 'semiannual'}`}
      onKeyDown={ev => { if (ev.key === 'Enter' && (ev.target as HTMLElement).tagName === 'INPUT') ev.preventDefault(); }}>
      <div className="ent-h">
        <b>{isMonthly(key) ? '📋' : '🗂️'} {deliveryTitle(key)}</b>
        <span className="grow" />
        {editingDate ? (
          <span className="ent-date-edit">
            <input type="date" className="modal-input sm" value={due} autoFocus
              onChange={ev => { const v = ev.target.value; if (v) { editDelivery(b.id, key, { due: v === auto ? null : v }); toast(`${b.code}: fecha límite ${shortDate(v)}`, true); } }} />
            {adjusted && <button type="button" className="dp-link" onClick={() => { editDelivery(b.id, key, { due: null }); setEditingDate(false); toast(`${b.code}: fecha automática ${shortDate(auto)}`, true); }}>Automática ({shortDate(auto)})</button>}
            <button type="button" className="dp-link" onClick={() => setEditingDate(false)}>Listo</button>
          </span>
        ) : (
          <button type="button" className={`ent-date ${!done && days < 0 ? 'overdue' : ''}`} title="Clic para ajustar la fecha límite" onClick={() => setEditingDate(true)}>
            <Ic n="calendar" size={12} /> {longDate(due)}{adjusted && <small> (ajustada)</small>}
            {!done && <small> · {daysText(days)}</small>}
          </button>
        )}
      </div>

      <div className="ent-steps">
        {STEPS.map(p => {
          const f = e[p.id];
          return (
            <div key={p.id} className={`ent-step ${f ? 'on' : ''}`}>
              <button type="button" className="ent-step-btn" title={f ? 'Clic para desmarcar' : 'Clic para marcarlo hoy'} onClick={() => step(p.id, f ? null : today)}>
                <span className="cb">{f && <Ic n="check" size={12} />}</span>{p.icon} {p.name}
              </button>
              {f ? <input type="date" className="ent-step-date" value={f} title="Fecha en que se hizo (editable)" onChange={ev => ev.target.value && step(p.id, ev.target.value)} />
                : <small className="muted">falta</small>}
            </div>
          );
        })}
      </div>

      <div className="ent-letter">
        <button type="button" className="dp-link" onClick={() => setShowLetter(v => !v)}>✉️ Carta para SETENA {e.letterText ? `(${e.letterText.trim().split(/\s+/).length} palabras)` : '(vacía)'} {showLetter ? '▴' : '▾'}</button>
        {showLetter && <LetterText b={b} itemKey={key} />}
      </div>
    </div>
  );
}

/** Letter text area: saves itself while typing. */
function LetterText({ b, itemKey: key }: { b: Project; itemKey: string }) {
  const e = deliveryOf(b, key);
  const [txt, setTxt] = useState(e.letterText);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef(e.letterText);
  useEffect(() => () => { if (t.current) { clearTimeout(t.current); if (last.current !== e.letterText) editDelivery(b.id, key, { letterText: last.current }, { undo: false }); } }, []); // eslint-disable-line
  const change = (v: string) => {
    setTxt(v); last.current = v;
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => { t.current = null; editDelivery(b.id, key, { letterText: v }, { undo: false }); }, 600);
  };
  return (
    <div className="letter-box">
      <textarea className="modal-input letter" rows={8} value={txt} onChange={ev => change(ev.target.value)}
        placeholder={`Escribe aquí la carta para SETENA de ${b.code} (${b.name}).\nMás adelante este espacio se llenará con la plantilla.`} />
      <div className="letter-actions">
        <small className="muted">Se guarda sola.</small>
        <span className="grow" />
        <button type="button" className="dp-link" disabled={!txt.trim()} onClick={() => navigator.clipboard.writeText(txt).then(() => toast('Carta copiada: pégala en «Escribir» de SETENA'))}>Copiar carta</button>
        <button type="button" className="dp-link" disabled={!txt.trim()} onClick={() => { markStep(b.id, key, 'letter', deliveryOf(b, key).letter ?? todayISO()); toast(`✓ ${b.code}: carta lista`, true); }}>Marcar carta lista</button>
        <button type="button" className="dp-link" onClick={() => backend.openSetena(SETENA_URL).catch(er => toast(String(er)))}>Abrir SETENA</button>
      </div>
    </div>
  );
}
