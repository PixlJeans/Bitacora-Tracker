// ===== One delivery: Informe Regencial (monthly) or Regencia (every 6 months) =====
// Two checks: INSPECCIÓN (site visit, schedulable, at least 7 days before) and INFORME (presented to SETENA,
// adjustable due date) · photos and documents · the letter (a template will fill it later).
// · photos and documents (letter, PDF) for SETENA · space to write the letter (a template will fill it later).
// Everything is saved to the data immediately.
import { useEffect, useRef, useState } from 'react';
import type { Project, Step } from '../lib/types';
import { MONTHLY_NAME, SEMIANNUAL_NAME, STEPS } from '../lib/types';
import { inspectionDeadline, monthlyDue, monthlyDueAuto, regenciaDue } from '../lib/schedule';
import { shortDate, longDate, fromISO, monthNameOf, todayISO } from '../lib/dates';
import { addDeliveryFiles, editDelivery, deliveryOf, markStep, removeDeliveryFile } from '../lib/store';
import { backend } from '../lib/backend';
import { Ic, toast } from './core';
import { SETENA_URL, Thumb, saveAttachments } from './ProjectLog';

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

/** Mini bar of the two checks (Inspección · Informe) for lists. */
export function StepsMini({ b, itemKey: key }: { b: Project; itemKey: string }) {
  const e = deliveryOf(b, key);
  const nFiles = e.files?.length ?? 0;
  return (
    <span className="steps-mini" title={STEPS.map(p => `${p.name}: ${e[p.id] ? shortDate(e[p.id]!) : 'falta'}`).join(' · ') + (nFiles ? ` · ${nFiles} archivo(s)` : '')}>
      {STEPS.filter(p => p.main).map(p => <i key={p.id} className={e[p.id] ? 'on' : ''}>{p.icon}</i>)}
    </span>
  );
}

export function DeliveryCard({ b, itemKey: key, isOpen = false }: { b: Project; itemKey: string; isOpen?: boolean }) {
  const today = todayISO();
  const e = deliveryOf(b, key);
  const due = dueDate(b, key), auto = autoDate(b, key);
  const adjusted = due !== auto;
  const inspBy = inspectionDeadline(due);
  const done = isMonthly(key) ? !!(e.visit && e.uploaded) : !!e.uploaded;
  const days = daysUntil(due, today);
  const [showLetter, setShowLetter] = useState(!e.uploaded);
  const [editingDate, setEditingDateRaw] = useState(false);
  const [draft, setDraft] = useState('');
  const setEditingDate = (on: boolean) => { setDraft(due); setEditingDateRaw(on); };
  /** Moves the informe / regencia to another date — any month. The calendar follows it to its new month. */
  const moveTo = (v: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
    editDelivery(b.id, key, { due: v === auto ? null : v });
    setEditingDateRaw(false);
    const other = v.slice(0, 7) !== due.slice(0, 7);
    toast(`${b.code}: ${isMonthly(key) ? 'informe' : 'regencia'} ${v === auto ? 'en su fecha automática' : 'movido'} al ${longDate(v)}`, true);
    if (other) window.dispatchEvent(new CustomEvent('bt-goto-month', { detail: v.slice(0, 7) }));
  };
  const lateVisit = !!e.planned && e.planned > inspBy;

  const step = (p: Step, date: string | null) => {
    markStep(b.id, key, p, date);
    const nameText = STEPS.find(x => x.id === p)!.name;
    toast(date ? `✓ ${b.code}: ${nameText} · ${shortDate(date)}` : `${b.code}: ${nameText} desmarcado`, true);
  };
  const check = (p: Step) => (
    <button type="button" className={`ent-check ${e[p] ? 'on' : ''}`} title={e[p] ? 'Clic para desmarcar' : 'Clic para marcarlo hecho hoy'} onClick={() => step(p, e[p] ? null : today)}>
      <span className="cb">{e[p] && <Ic n="check" size={12} />}</span>
    </button>
  );
  const doneOn = (p: Step) => e[p] && <>
    <small className="muted">hecha el</small>
    <input type="date" className="ent-step-date" value={e[p]!} title="Fecha en que se hizo (editable)" onChange={ev => ev.target.value && step(p, ev.target.value)} />
  </>;

  return (
    <div className={`delivery ${done ? 'completed' : days < 0 ? 'is-overdue' : ''} ${isMonthly(key) ? 'monthly' : 'semiannual'}`}
      onKeyDown={ev => { if (ev.key === 'Enter' && (ev.target as HTMLElement).tagName === 'INPUT') ev.preventDefault(); }}>
      <div className="ent-h">
        <b>{isMonthly(key) ? '📋' : '🗂️'} {deliveryTitle(key)}</b>
      </div>

      <div className="ent-cols">
        {/* LEFT · Inspección (site visit, at least 7 days before) + its photos */}
        <section className={`ent-block ${e.visit ? 'on' : today > inspBy ? 'late' : ''}`}>
          <div className="ent-row">
            {check('visit')}
            <b>🚗 Inspección</b>
          </div>
          <div className="ent-row sub">
            {e.visit ? doneOn('visit')
              : <small className={today > inspBy ? 'red-t' : 'muted'}>a más tardar el <b>{longDate(inspBy)}</b> · {daysText(daysUntil(inspBy, today))}</small>}
          </div>
          {!e.visit && (
            <div className="ent-row sub">
              <span>Programada</span>
              <input type="date" className="modal-input sm" value={e.planned ?? ''} title="Día en que piensas ir (se puede mover cuando quieras)"
                onChange={ev => { const v = ev.target.value || null; editDelivery(b.id, key, { planned: v }); toast(v ? `${b.code}: inspección programada ${longDate(v)}` : `${b.code}: inspección sin programar`, true); }} />
              {e.planned && <button type="button" className="dp-link" onClick={() => { editDelivery(b.id, key, { planned: null }); toast(`${b.code}: inspección sin programar`, true); }}>quitar</button>}
            </div>
          )}
          {lateVisit && !e.visit && <div className="ent-warn">⚠️ Debe ser al menos 7 días antes del informe: a más tardar el {shortDate(inspBy)}.</div>}
          <DeliveryFiles b={b} itemKey={key} kind="photos" />
        </section>

        {/* RIGHT · Informe presented to SETENA + letter and documents */}
        <section className={`ent-block ${e.uploaded ? 'on' : days < 0 ? 'late' : ''}`}>
          <div className="ent-row">
            {check('uploaded')}
            <b>📤 Informe a SETENA</b>
          </div>
          <div className="ent-row sub">
            {e.uploaded ? doneOn('uploaded') : editingDate ? (
              <span className="ent-date-edit">
                <input type="date" className="modal-input sm" value={draft} autoFocus
                  onChange={ev => setDraft(ev.target.value)}
                  onKeyDown={ev => { if (ev.key === 'Enter') moveTo(draft); if (ev.key === 'Escape') setEditingDate(false); }} />
                <button type="button" className="btn sm primary" disabled={!draft || draft === due} onClick={() => moveTo(draft)}>Mover</button>
                {adjusted && <button type="button" className="dp-link" onClick={() => moveTo(auto)}>automática ({shortDate(auto)})</button>}
                <button type="button" className="dp-link" onClick={() => setEditingDate(false)}>cancelar</button>
              </span>
            ) : (
              <span className="ent-date-edit">
                <small className={days < 0 ? 'red-t' : 'muted'}>vence el <b>{longDate(due)}</b>{adjusted ? ' (ajustada)' : ''} · {daysText(days)}</small>
                <button type="button" className="dp-link" onClick={() => setEditingDate(true)}>✏️ cambiar</button>
              </span>
            )}
          </div>
          <div className="ent-letter">
            <button type="button" className="dp-link" onClick={() => setShowLetter(v => !v)}>✉️ Carta {e.letter ? `lista (${shortDate(e.letter)})` : e.letterText ? `(${e.letterText.trim().split(/\s+/).length} palabras)` : '(vacía)'} {showLetter ? '▴' : '▾'}</button>
            {showLetter && <LetterText b={b} itemKey={key} />}
          </div>
          <DeliveryFiles b={b} itemKey={key} kind="docs" />
        </section>
      </div>
    </div>
  );
}

/** Photos and documents of a delivery: add (button or drag & drop), open, remove. */
function DeliveryFiles({ b, itemKey: key, kind }: { b: Project; itemKey: string; kind: 'photos' | 'docs' }) {
  const files = [...(deliveryOf(b, key).files ?? [])].filter(f => (f.type === 'photo') === (kind === 'photos'))
    .sort((x, y) => (x.takenOn ?? '9').localeCompare(y.takenOn ?? '9'));
  const photoRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState('');
  const [over, setOver] = useState(false);

  async function add(list: File[]) {
    if (!list.length) return;
    try {
      const atts = await saveAttachments(b.code, list, todayISO(), i => setSaving(`Guardando ${i} de ${list.length}…`));
      const marked = addDeliveryFiles(b.id, key, atts);
      toast(`✓ ${b.code}: ${atts.length} archivo(s) guardado(s)` + (marked.length ? ` · marcado: ${marked.join(', ')}` : ''), true);
    } catch (e) { toast('No se pudo guardar: ' + String(e)); }
    setSaving('');
  }
  const remove = (id: string) => {
    const f = files.find(x => x.id === id);
    if (!f) return;
    removeDeliveryFile(b.id, key, id);
    backend.deleteAttachment(f.path).catch(() => { /* already gone */ });
    if (f.thumb) backend.deleteAttachment(f.thumb).catch(() => { /* already gone */ });
    toast(`${f.name} quitado (queda en la papelera de la carpeta de datos)`, true);
  };
  const isPhotos = kind === 'photos';
  const ref = isPhotos ? photoRef : docRef;

  return (
    <div className={`ent-files ${over ? 'over' : ''}`} title="También puedes arrastrar archivos aquí"
      onDragOver={ev => { ev.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={ev => { ev.preventDefault(); setOver(false); add(Array.from(ev.dataTransfer.files) as File[]); }}>
      {!files.length && <div className="ent-files-empty">{isPhotos ? '📷 Arrastra aquí las fotos de la inspección: se leen su fecha y ubicación' : '📄 Arrastra aquí la carta firmada o los PDF'}</div>}
      {files.length > 0 && (
        <div className="ent-files-grid">
          {files.map(f => (
            <span key={f.id} className="ent-file">
              <Thumb a={f} near={b.location} />
              <button type="button" className="ent-file-x" title="Quitar" onClick={() => remove(f.id)}>✕</button>
            </span>
          ))}
        </div>
      )}
      <div className="ent-files-btns">
        <button type="button" className="btn sm" disabled={!!saving} onClick={() => ref.current?.click()}>
          {isPhotos ? `📷 ${files.length ? 'Más fotos' : 'Agregar fotos'}` : `📄 ${files.length ? 'Más documentos' : 'Agregar carta / PDF'}`}</button>
        {isPhotos && files.length > 0 && <button type="button" className="dp-link" onClick={() => backend.openProjectFolder(b.code).catch(e => toast(String(e)))}>Abrir carpeta</button>}
        {saving && <small className="muted">{saving}</small>}
      </div>
      <input ref={photoRef} type="file" accept="image/*" multiple hidden onChange={ev => { add(Array.from(ev.target.files ?? []) as File[]); ev.target.value = ''; }} />
      <input ref={docRef} type="file" accept=".pdf,.doc,.docx,application/pdf" multiple hidden onChange={ev => { add(Array.from(ev.target.files ?? []) as File[]); ev.target.value = ''; }} />
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
