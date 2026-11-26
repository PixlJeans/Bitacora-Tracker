// ===== One delivery: a month (Inspección + Bitácora) or a Regencia (every 6 months) =====
// Every task falls on the opening day and can be moved to any date · photos and documents ·
// the letter for SETENA (a template will fill it later).
// Everything is saved to the data immediately.
import { useEffect, useRef, useState } from 'react';
import type { Project, Step } from '../lib/types';
import { MONTHLY_NAME, SEMIANNUAL_NAME, STEPS } from '../lib/types';
import { inspectionDate, monthlyDue, monthlyDueAuto, regenciaDue } from '../lib/schedule';
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

export function DeliveryCard({ b, itemKey: key }: { b: Project; itemKey: string; isOpen?: boolean }) {
  const today = todayISO();
  const e = deliveryOf(b, key);
  const monthly = isMonthly(key);
  const due = dueDate(b, key), auto = autoDate(b, key);
  const insp = monthly ? inspectionDate(b, key.slice(2)) : due;
  const done = monthly ? !!(e.visit && e.uploaded) : !!e.uploaded;
  const late = (!e.uploaded && due < today) || (monthly && !e.visit && insp < today);
  const [showLetter, setShowLetter] = useState(!e.uploaded);

  const step = (p: Step, date: string | null) => {
    markStep(b.id, key, p, date);
    const nameText = monthly ? STEPS.find(x => x.id === p)!.name : 'Regencia';
    toast(date ? `✓ ${b.code}: ${nameText} · ${shortDate(date)}` : `${b.code}: ${nameText} desmarcada`, true);
  };
  const check = (p: Step, date: string) => (
    <button type="button" className={`ent-check ${e[p] ? 'on' : ''}`} title={e[p] ? 'Clic para desmarcar' : 'Clic para marcarla hecha (con su fecha)'}
      onClick={() => step(p, e[p] ? null : (date <= today ? date : today))}>
      <span className="cb">{e[p] && <Ic n="check" size={12} />}</span>
    </button>
  );
  const doneOn = (p: Step) => e[p] && <span className="ent-date-edit">
    <small className="muted">hecha el</small>
    <input type="date" className="ent-step-date" value={e[p]!} title="Fecha en que se hizo (editable)" onChange={ev => ev.target.value && step(p, ev.target.value)} />
  </span>;
  const letter = (
    <div className="ent-letter">
      <button type="button" className="dp-link" onClick={() => setShowLetter(v => !v)}>✉️ Carta {e.letter ? `lista (${shortDate(e.letter)})` : e.letterText ? `(${e.letterText.trim().split(/\s+/).length} palabras)` : '(vacía)'} {showLetter ? '▴' : '▾'}</button>
      {showLetter && <LetterText b={b} itemKey={key} />}
    </div>
  );

  return (
    <div className={`delivery ${done ? 'completed' : late ? 'is-overdue' : ''} ${monthly ? 'monthly' : 'semiannual'}`}
      onKeyDown={ev => { if (ev.key === 'Enter' && (ev.target as HTMLElement).tagName === 'INPUT') ev.preventDefault(); }}>
      <div className="ent-h">
        <b>{monthly ? `📅 ${monthNameOf(key.slice(2))}` : '🗂️ Regencia (semestral)'}</b>
      </div>

      {monthly ? (
        <div className="ent-cols">
          {/* LEFT · Inspección (site visit) + its photos */}
          <section className={`ent-block ${e.visit ? 'on' : insp < today ? 'late' : ''}`}>
            <div className="ent-row">{check('visit', insp)}<b>🚗 Inspección</b></div>
            <div className="ent-row sub">
              {e.visit ? doneOn('visit') : <DateMover b={b} itemKey={key} what="Inspección" date={insp} auto={auto}
                onMove={v => editDelivery(b.id, key, { planned: v })} />}
            </div>
            <DeliveryFiles b={b} itemKey={key} kind="photos" />
          </section>

          {/* RIGHT · Bitácora presented to SETENA + letter and documents */}
          <section className={`ent-block ${e.uploaded ? 'on' : due < today ? 'late' : ''}`}>
            <div className="ent-row">{check('uploaded', due)}<b>📋 Bitácora a SETENA</b></div>
            <div className="ent-row sub">
              {e.uploaded ? doneOn('uploaded') : <DateMover b={b} itemKey={key} what="Bitácora" date={due} auto={auto}
                onMove={v => editDelivery(b.id, key, { due: v })} />}
            </div>
            {letter}
            <DeliveryFiles b={b} itemKey={key} kind="docs" />
          </section>
        </div>
      ) : (
        <section className={`ent-block ${e.uploaded ? 'on' : due < today ? 'late' : ''}`}>
          <div className="ent-row">
            {check('uploaded', due)}<b>🗂️ Regencia presentada</b>
            <span className="grow" />
            {e.uploaded ? doneOn('uploaded') : <DateMover b={b} itemKey={key} what="Regencia" date={due} auto={auto}
              onMove={v => editDelivery(b.id, key, { due: v })} />}
          </div>
          <div className="ent-cols">
            <div>{letter}</div>
            <div className="ent-reg-files"><DeliveryFiles b={b} itemKey={key} kind="docs" /><DeliveryFiles b={b} itemKey={key} kind="photos" /></div>
          </div>
        </section>
      )}
    </div>
  );
}

/** Date of a task with «✏️ cambiar»: it can be moved to any date, even another month (the calendar follows it). */
function DateMover({ b, what, date, auto, onMove }: { b: Project; itemKey: string; what: string; date: string; auto: string; onMove: (v: string | null) => void }) {
  const today = todayISO();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(date);
  const days = daysUntil(date, today);
  const moveTo = (v: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
    onMove(v === auto ? null : v);
    setEditing(false);
    toast(`${b.code}: ${what} ${v === auto ? 'en su fecha automática' : 'movida'} al ${longDate(v)}`, true);
    if (v.slice(0, 7) !== date.slice(0, 7)) window.dispatchEvent(new CustomEvent('bt-goto-month', { detail: v.slice(0, 7) }));
  };
  if (editing) return (
    <span className="ent-date-edit">
      <input type="date" className="modal-input sm" value={draft} autoFocus onChange={ev => setDraft(ev.target.value)}
        onKeyDown={ev => { if (ev.key === 'Enter') moveTo(draft); if (ev.key === 'Escape') setEditing(false); }} />
      <button type="button" className="btn sm primary" disabled={!draft || draft === date} onClick={() => moveTo(draft)}>Mover</button>
      {date !== auto && <button type="button" className="dp-link" onClick={() => moveTo(auto)}>automática ({shortDate(auto)})</button>}
      <button type="button" className="dp-link" onClick={() => setEditing(false)}>cancelar</button>
    </span>
  );
  return (
    <span className="ent-date-edit">
      <small className={days < 0 ? 'red-t' : 'muted'}><b>{longDate(date)}</b>{date !== auto ? ' (movida)' : ''} · {daysText(days)}</small>
      <button type="button" className="dp-link" onClick={() => { setDraft(date); setEditing(true); }}>✏️ cambiar</button>
    </span>
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
