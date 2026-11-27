// ===== One delivery: a month (Inspección + Bitácora) or a Regencia (every 6 months) =====
// Month: 🚗 Inspección (with its photos) and 📋 Llenado de bitácora (a check).
// Regencia: ✍️ Elaboración → 🖊️ Firma del cliente (the developer signs it) → 📤 Subir (your mom sends it to SETENA) → 🧾 Nota de recibido.
// Files are saved in Proyectos/<Código - Nombre>/<Año>/<MM - Mes>/Fotos|Regencias.
// Everything is saved to the data immediately.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Project, Step } from '../lib/types';
import { MONTHLY_NAME, SEMIANNUAL_NAME, STEPS } from '../lib/types';
import { inspectionDate, monthlyDue, monthlyDueAuto, regenciaDue, monthLive, regenciaLive } from '../lib/schedule';
import { shortDate, longDate, fromISO, monthNameOf, todayISO } from '../lib/dates';
import { addDeliveryFiles, editDelivery, deliveryOf, getData, markStep, relocateFiles, removeDeliveryFile } from '../lib/store';
import { backend } from '../lib/backend';
import { Ic, toast } from './core';
import { Thumb, saveAttachments } from './ProjectLog';
import { deliveryFolder, monthFolderOf, receiptFolder } from '../lib/folders';
import { regenciaLabels } from '../lib/docSort';

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

  return (
    <div className={`checklist ${monthly ? 'monthly' : 'semiannual'}`}
      onKeyDown={ev => { if (ev.key === 'Enter' && (ev.target as HTMLElement).tagName === 'INPUT') ev.preventDefault(); }}>
      <div className="cl-h">
        <b>{monthly ? `📅 ${monthNameOf(key.slice(2))}` : '🗂️ Regencia (semestral)'}</b>
        {!monthly && !e.uploaded && <DateMover b={b} itemKey={key} what="Regencia" date={due} auto={auto} onMove={v => editDelivery(b.id, key, { due: v })} />}
        <span className="grow" />
        {monthly && MONTH_DOCS.map(([sub, label]) => <DocsButton key={sub} b={b} ym={key.slice(2)} sub={sub} label={label} />)}
        <FolderButton b={b} itemKey={key} />
      </div>
      {monthly ? <>
        <CheckRow b={b} itemKey={key} step="visit" name="🚗 Inspección" date={insp} auto={auto} today={today}
          onMove={v => editDelivery(b.id, key, { planned: v })} />
        <CheckRow b={b} itemKey={key} step="uploaded" name="📋 Llenado de bitácora" date={due} auto={auto} today={today}
          onMove={v => editDelivery(b.id, key, { due: v })} />
        <MonthNote b={b} itemKey={key} />
      </> : <>
        <RegenciaInfo b={b} itemKey={key} />
        <CheckRow b={b} itemKey={key} step="letter" name="✍️ Elaboración de la regencia" today={today} />
        <CheckRow b={b} itemKey={key} step="signed" name="🖊️ Firma del cliente" today={today} />
        <CheckRow b={b} itemKey={key} step="uploaded" name="📤 Subir regencia" today={today} date={due} />
        <CheckRow b={b} itemKey={key} step="received" name="🧾 Nota de recibido" today={today}
          extra={<FolderButton b={b} itemKey={key} folder={receiptFolder(b, key)} label="Notas de recibido" />} />
        <MonthNote b={b} itemKey={key} />
      </>}
    </div>
  );
}

/** One line of the checklist: big checkbox · name · its date (movable) or the day it was done. */
export function CheckRow({ b, itemKey: key, step, name, date, auto, today, onMove, extra }: {
  b: Project; itemKey: string; step: Step; name: string; today: string; date?: string; auto?: string; onMove?: (v: string | null) => void; extra?: ReactNode;
}) {
  const e = deliveryOf(b, key);
  const on = !!e[step];
  const toggle = () => {
    const d = on ? null : (date && date <= today ? date : today);
    markStep(b.id, key, step, d);
    toast(d ? `✓ ${b.code}: ${name.replace(/^\S+\s/, '')}` : `${b.code}: ${name.replace(/^\S+\s/, '')} desmarcada`, true);
  };
  // already history (v53): a month before last month, or a regencia whose next one is already due — grey, not red
  const past = !on && (key.startsWith('m:') ? !monthLive(key.slice(2), today) : key.startsWith('r:') ? !regenciaLive(b, key.slice(2), today) : false);
  return (
    <div className={`cl-row ${on ? 'on' : past ? 'past' : date && date < today ? 'late' : ''}`} title={past ? 'Ya pasó: queda en la historia como «sin anotación en SETENA»' : undefined}>
      <label className="cl-check">
        <input type="checkbox" checked={on} onChange={toggle} />
        <span className="cl-box">{on && <Ic n="check" size={14} />}</span>
        <span className="cl-name">{name}</span>
      </label>
      <span className="cl-date">
        {on ? <span className="ent-date-edit"><small className="muted">hecha el</small>
          <input type="date" className="ent-step-date" value={e[step]!} title="Fecha en que se hizo (editable)" onChange={ev => ev.target.value && markStep(b.id, key, step, ev.target.value)} /></span>
          : date && onMove && auto ? <DateMover b={b} itemKey={key} what={name.replace(/^\S+\s/, '')} date={date} auto={auto} onMove={onMove} />
          : date ? <small className={past ? 'muted' : date < today ? 'red-t' : 'muted'}>{longDate(date)} · {past ? 'ya pasó' : daysText(daysUntil(date, today))}</small> : null}
        {extra}
      </span>
    </div>
  );
}

/** «📂 Fotos (3)»: opens the folder in the file explorer, where the files are added, opened and deleted.
 *  The count is read from the folder itself (refreshed when coming back to the app). */
export function FolderButton({ b, itemKey: key, folder: given, label: givenLabel }: { b: Project; itemKey: string; folder?: string; label?: string }) {
  const folder = given ?? deliveryFolder(b, key);
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => backend.listFolder(folder).then(l => { if (live) setN(l.length); }).catch(() => { /* not on desktop */ });
    read();
    window.addEventListener('focus', read);
    return () => { live = false; window.removeEventListener('focus', read); };
  }, [folder]);
  const label = givenLabel ?? (key.startsWith('m:') ? 'Fotos' : key.startsWith('r:') ? 'Regencias' : 'Inicio de obras');
  return (
    <button type="button" className={`btn sm folder-btn ${n ? 'has' : ''}`} title={`Abrir en el explorador: ${folder.replace(/\//g, '\\')}`}
      onClick={() => backend.openSubfolder(folder).catch(err => toast(String(err)))}>
      📂 {label}{n !== null ? <b className="folder-n">{n}</b> : null}
    </button>
  );
}

/** Other folders of a month (filled by the SETENA download, sorted by what each PDF is). */
const MONTH_DOCS: [Parameters<typeof monthFolderOf>[2], string][] = [
  ['Regencias', '📂 Regencias'], ['Notas de recibido', '🧾 Recibidos'], ['Comunicados SETENA', '📨 SETENA'], ['Cartas', '✉️ Cartas'], ['Documentos', '📄 Otros']
];

/** «📂 Regencias (2)» on a month: the files of one of its folders. Only shown when it has some. */
function DocsButton({ b, ym, sub, label }: { b: Project; ym: string; sub: Parameters<typeof monthFolderOf>[2]; label: string }) {
  const folder = monthFolderOf(b, ym, sub);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    const read = () => backend.listFolder(folder).then(l => { if (live) setN(l.length); }).catch(() => { /* not on desktop */ });
    read();
    window.addEventListener('focus', read);
    return () => { live = false; window.removeEventListener('focus', read); };
  }, [folder]);
  if (!n) return null;
  return (
    <button type="button" className="btn sm folder-btn has" title={`Abrir en el explorador: ${folder.replace(/\//g, '\\')}`}
      onClick={() => backend.openSubfolder(folder).catch(err => toast(String(err)))}>
      {label}<b className="folder-n">{n}</b>
    </button>
  );
}

/** Under a Regencia: which report(s) its folder holds, read from the PDF itself («IRA-I-2024 · Agosto 2023 - Enero 2024»). */
function RegenciaInfo({ b, itemKey: key }: { b: Project; itemKey: string }) {
  const folder = deliveryFolder(b, key);
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    backend.listFolder(folder).then(l => { if (live) setNames(l); }).catch(() => { /* not on desktop */ });
    return () => { live = false; };
  }, [folder]);
  const labels = regenciaLabels(b, names);
  if (!labels.length) return null;
  return <div className="reg-info">📄 {labels.join(' · ')}</div>;
}

/** Date of a task with «✏️ cambiar»: it can be moved to any date, even another month (the calendar follows it). */
function DateMover({ b, itemKey: key, what, date, auto, onMove }: { b: Project; itemKey: string; what: string; date: string; auto: string; onMove: (v: string | null) => void }) {
  const today = todayISO();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(date);
  const days = daysUntil(date, today);
  const moveTo = (v: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
    const before = deliveryFolder(b, key);
    onMove(v === auto ? null : v);
    setEditing(false);
    // Its files follow it to the folder of the new month
    const after = getData().projects.find(x => x.id === b.id);
    if (after && deliveryFolder(after, key) !== before)
      void relocateFiles().then(async () => {
        await backend.moveFolderFiles(before, deliveryFolder(after, key));
        if (key.startsWith('r:')) await backend.moveFolderFiles(receiptFolder(b, key), receiptFolder(after, key));
      }).catch(() => { /* not on desktop */ });
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
export function DeliveryFiles({ b, itemKey: key, kind, label, hint }: { b: Project; itemKey: string; kind: 'photos' | 'docs' | 'receipt'; label?: string; hint?: string }) {
  const files = [...(deliveryOf(b, key).files ?? [])].filter(f => kind === 'photos' ? f.type === 'photo' : f.type !== 'photo' && (f.role === 'receipt') === (kind === 'receipt'))
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
      const atts = (await saveAttachments(b.code, list, todayISO(), i => setSaving(`Guardando ${i} de ${list.length}…`), deliveryFolder(b, key)))
        .map(a => kind === 'receipt' ? { ...a, role: 'receipt' as const } : a);
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
  return (
    <div className="checklist start">
      <div className="cl-h"><b>🏗️ Inicio del proyecto</b><span className="grow" /><FolderButton b={b} itemKey="s:start" /></div>
      <CheckRow b={b} itemKey="s:start" step="uploaded" name="🏗️ Carta de Inicio de obras" today={todayISO()} />
    </div>
  );
}

/** Notes of one month (or one Regencia): saved by themselves while typing. */
export function MonthNote({ b, itemKey: key, rows = 1, placeholder }: { b: Project; itemKey: string; rows?: number; placeholder?: string }) {
  const saved = deliveryOf(b, key).notes ?? '';
  const [txt, setTxt] = useState(saved);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!t.current) setTxt(saved); }, [saved]);
  // grows with its text, so the whole note is always visible
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [txt]);
  useEffect(() => {
    const el = area.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => { if (el.clientWidth !== w) { w = el.clientWidth; el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; } });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const change = (v: string) => {
    setTxt(v);
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => { t.current = null; editDelivery(b.id, key, { notes: v }, { undo: false }); }, 500);
  };
  return (
    <textarea ref={area} className={`month-note ${txt ? 'has' : ''}`} rows={rows} value={txt}
      placeholder={placeholder ?? '📝 Notas de este mes…'} onChange={e => change(e.target.value)}
      onBlur={() => { if (t.current) { clearTimeout(t.current); t.current = null; editDelivery(b.id, key, { notes: txt }, { undo: false }); } }} />
  );
}
