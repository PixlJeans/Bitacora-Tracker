// ===== One delivery: a month (Inspección + Bitácora) or a Regencia (every 6 months) =====
// Month: 🚗 Inspección (with its photos) and 📋 Llenado de bitácora (a check).
// Regencia: ✍️ Elaboración (a check) and 📤 Subir (attach the Word / PDF). Dates movable to any month.
// Files are saved in Proyectos/<Código - Nombre>/<Año>/<MM - Mes>/Fotos|Regencias.
// Everything is saved to the data immediately.
import { useRef, useState } from 'react';
import type { Project, Step } from '../lib/types';
import { MONTHLY_NAME, SEMIANNUAL_NAME, STEPS } from '../lib/types';
import { inspectionDate, monthlyDue, monthlyDueAuto, regenciaDue } from '../lib/schedule';
import { shortDate, longDate, fromISO, monthNameOf, todayISO } from '../lib/dates';
import { addDeliveryFiles, editDelivery, deliveryOf, markStep, removeDeliveryFile } from '../lib/store';
import { backend } from '../lib/backend';
import { Ic, toast } from './core';
import { Thumb, saveAttachments } from './ProjectLog';
import { deliveryFolder } from '../lib/folders';

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

  /** One checkbox task: ☐ name · date (movable) or «hecha el …». */
  const task = (p: Step, name: string, date: string | null, move?: (v: string | null) => void) => (
    <div className={`task-box ${e[p] ? 'on' : date && date < today ? 'late' : ''}`}>
      <button type="button" className={`ent-check ${e[p] ? 'on' : ''}`} title={e[p] ? 'Clic para desmarcar' : 'Clic para marcarla hecha'}
        onClick={() => { const d = e[p] ? null : (date && date <= today ? date : today); markStep(b.id, key, p, d); toast(d ? `✓ ${b.code}: ${name}` : `${b.code}: ${name} desmarcada`, true); }}>
        <span className="cb">{e[p] && <Ic n="check" size={12} />}</span>
      </button>
      <div className="task-txt">
        <b>{name}</b>
        {e[p] ? <span className="ent-date-edit"><small className="muted">hecha el</small>
          <input type="date" className="ent-step-date" value={e[p]!} title="Fecha en que se hizo (editable)" onChange={ev => ev.target.value && markStep(b.id, key, p, ev.target.value)} /></span>
          : date && move ? <DateMover b={b} itemKey={key} what={name} date={date} auto={auto} onMove={move} /> : null}
      </div>
    </div>
  );

  return (
    <div className={`delivery ${done ? 'completed' : late ? 'is-overdue' : ''} ${monthly ? 'monthly' : 'semiannual'}`}
      onKeyDown={ev => { if (ev.key === 'Enter' && (ev.target as HTMLElement).tagName === 'INPUT') ev.preventDefault(); }}>
      <div className="ent-h">
        <b>{monthly ? `📅 ${monthNameOf(key.slice(2))}` : '🗂️ Regencia (semestral)'}</b>
        {!monthly && !e.uploaded && <DateMover b={b} itemKey={key} what="Regencia" date={due} auto={auto} onMove={v => editDelivery(b.id, key, { due: v })} />}
      </div>
      {monthly ? <>
        <div className="task-row">
          {task('visit', '🚗 Inspección', insp, v => editDelivery(b.id, key, { planned: v }))}
          {task('uploaded', '📋 Llenado de bitácora', due, v => editDelivery(b.id, key, { due: v }))}
        </div>
        <DeliveryFiles b={b} itemKey={key} kind="photos" />
      </> : <>
        <div className="task-row">
          {task('letter', '✍️ Elaboración de la regencia', null)}
          {task('uploaded', '📤 Subir regencia', null)}
        </div>
        <DeliveryFiles b={b} itemKey={key} kind="docs" label="📝 Adjuntar la regencia (Word / PDF)"
          hint="📝 Arrastra aquí el documento Word de la regencia (o el PDF): queda marcada como subida" />
      </>}
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
export function DeliveryFiles({ b, itemKey: key, kind, label, hint }: { b: Project; itemKey: string; kind: 'photos' | 'docs'; label?: string; hint?: string }) {
  const files = [...(deliveryOf(b, key).files ?? [])].filter(f => (f.type === 'photo') === (kind === 'photos'))
    .sort((x, y) => (x.takenOn ?? '9').localeCompare(y.takenOn ?? '9'));
  const photoRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState('');
  const [over, setOver] = useState(false);

  async function add(all: File[]) {
    // Photos only go to the Inspección; documents only to the Bitácora / Regencia / Inicio de obras
    const isImg = (f: File) => /^image\//.test(f.type) || /\.(jpe?g|png|heic|webp|gif)$/i.test(f.name);
    const list = all.filter(f => isImg(f) === (kind === 'photos'));
    if (list.length < all.length) toast(kind === 'photos' ? 'Aquí solo van fotos: los documentos van en la Bitácora o la Regencia.' : 'Aquí solo van documentos: las fotos van en la Inspección.');
    if (!list.length) return;
    try {
      const atts = await saveAttachments(b.code, list, todayISO(), i => setSaving(`Guardando ${i} de ${list.length}…`), deliveryFolder(b, key));
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
      {!files.length && <div className="ent-files-empty">{hint ?? (isPhotos ? '📷 Arrastra aquí las fotos de la inspección: se leen su fecha y ubicación' : '📄 Arrastra aquí la carta firmada o los PDF')}</div>}
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
          {isPhotos ? `📷 ${files.length ? 'Más fotos' : 'Agregar fotos'}` : files.length ? '📄 Agregar otro' : label ?? '📄 Agregar carta / PDF'}</button>
        {files.length > 0 && <button type="button" className="dp-link" title={deliveryFolder(b, key)} onClick={() => backend.openSubfolder(deliveryFolder(b, key)).catch(e => toast(String(e)))}>📂 Abrir carpeta</button>}
        {saving && <small className="muted">{saving}</small>}
      </div>
      <input ref={photoRef} type="file" accept="image/*" multiple hidden onChange={ev => { add(Array.from(ev.target.files ?? []) as File[]); ev.target.value = ''; }} />
      <input ref={docRef} type="file" accept=".pdf,.doc,.docx,application/pdf" multiple hidden onChange={ev => { add(Array.from(ev.target.files ?? []) as File[]); ev.target.value = ''; }} />
    </div>
  );
}


/** «Inicio de obras»: the letter sent to SETENA when the project starts (attach it, and check it presented). */
export function StartLetter({ b }: { b: Project }) {
  const key = 's:start';
  const e = deliveryOf(b, key);
  const today = todayISO();
  return (
    <section className={`ent-block start-letter ${e.uploaded ? 'on' : ''}`}>
      <div className="ent-row">
        <button type="button" className={`ent-check ${e.uploaded ? 'on' : ''}`} title={e.uploaded ? 'Clic para desmarcar' : 'Marcar presentada a SETENA'}
          onClick={() => { markStep(b.id, key, 'uploaded', e.uploaded ? null : today); toast(e.uploaded ? `${b.code}: Inicio de obras desmarcado` : `✓ ${b.code}: Inicio de obras presentado`, true); }}>
          <span className="cb">{e.uploaded && <Ic n="check" size={12} />}</span>
        </button>
        <b>🏗️ Carta de Inicio de obras</b>
        {e.uploaded && <span className="ent-date-edit"><small className="muted">presentada el</small>
          <input type="date" className="ent-step-date" value={e.uploaded} onChange={ev => ev.target.value && markStep(b.id, key, 'uploaded', ev.target.value)} /></span>}
      </div>
      <DeliveryFiles b={b} itemKey={key} kind="docs" label="📄 Agregar carta de Inicio de obras" hint="📄 Arrastra aquí la carta de Inicio de obras (Word o PDF)" />
    </section>
  );
}
