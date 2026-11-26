// ===== Import from the SETENA PDF — step by step and with PAUSE =====
//  1. Load: drop / pick the PDF, or paste the text.
//  2. Summary: how many were found and the default opening date.
//  3. One by one: a clean card per project. «Guardar y siguiente» saves it RIGHT AWAY.
//     «Pausar» closes and remembers where you were (stored in your data: survives closing the app).
//  4. Done: summary of what was imported.
import { useEffect, useRef, useState } from 'react';
import type { Project, AppData, Status, ImportRow, ImportSession } from '../lib/types';
import { STATUSES, statusName } from '../lib/types';
import { extractProjects, normalizeCode, isValidCode } from '../lib/parser';
import { labelForStatus, getData, mutate, useAppData } from '../lib/store';
import { reminderFrom } from '../lib/schedule';
import { shortDate, longDate, fromISO, addMonths, todayISO, uid } from '../lib/dates';
import { Ic, openModal, alertBox, closeModal, confirmDialog, HbHead, toast } from './core';

export function openImport(file?: File) { openModal(<Import initial={file} />, 'create-modal importar'); }

type Step = 'load' | 'summary' | 'one' | 'done';

/** Applies a row to the data (creates or updates the project). */
function applyRow(d: AppData, f: ImportRow): 'new' | 'updated' {
  const code = normalizeCode(f.code), name = f.name.trim().replace(/\s+/g, ' ');
  const b = d.projects.find(x => x.code === code);
  if (b) {
    Object.assign(b, { name: name, status: f.status, labelId: f.labelId });
    if (!f.noDate) { b.openedOn = f.openedOn; b.noOpeningDate = false; }
    return 'updated';
  }
  const isNew: Project = {
    id: uid(), code: code, name: name, status: f.status, labelId: f.labelId, openedOn: f.openedOn,
    notes: '', uploads: [], visits: [], regencias: [], entries: [], archived: false, archivedOn: null,
    lastUpdated: null, createdOn: todayISO(), noOpeningDate: !!f.noDate
  };
  d.projects.push(isNew);
  return 'new';
}

const valid = (f: ImportRow) => isValidCode(normalizeCode(f.code)) && !!f.name.trim() && !!f.openedOn;

function Import({ initial: initial }: { initial?: File }) {
  const d = useAppData();
  const session = d.importSession;
  const [step, setStep] = useState<Step>(session ? 'one' : 'load');
  const [text, setText] = useState('');
  const [rows, setRows] = useState<ImportRow[]>(session?.rows ?? []);
  const [i, setI] = useState(session ? Math.min(session.i, session.rows.length - 1) : 0);
  const [fileName, setFileName] = useState(session?.file ?? '');
  const [loading, setLoading] = useState('');
  const [drag, setDrag] = useState(false);
  const [defaultOpenedOn, setDefaultOpenedOn] = useState(todayISO());
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const initialDone = useRef(false);

  async function readPdf(f: File) {
    setFileName(f.name); setLoading('Leyendo PDF…');
    try {
      const { textFromPdf: textFromPdf } = await import('../lib/pdf');
      const txt = await textFromPdf(await f.arrayBuffer());
      setText(txt);
      if (!txt.trim()) alertBox('PDF sin texto', 'Este PDF parece escaneado (solo imagen). Copia el texto desde el visor de PDF y pégalo en el cuadro.', '🖼️', '#f59e0b');
      else analyze(txt);
    } catch (e: any) {
      alertBox('No se pudo leer el PDF', e?.message || String(e), '⚠️', '#f59e0b');
    } finally { setLoading(''); }
  }
  useEffect(() => {
    if (initial && !initialDone.current) {
      initialDone.current = true;
      if (session) { toast('Hay una importación en pausa: termínala o descártala antes de cargar otro PDF'); return; }
      readPdf(initial);
    }
  }, []); // eslint-disable-line

  function analyze(txt = text) {
    const dd = getData();
    setRows(extractProjects(txt).map(e => {
      const code = normalizeCode(e.code);
      const ex = dd.projects.find(b => b.code === code);
      return {
        code: code, name: e.name, status: e.status, openedOn: e.openedOn ?? ex?.openedOn ?? '',
        labelId: ex?.labelId ?? labelForStatus(e.status),
        doubts: e.doubts, existingId: ex?.id ?? null, result: 'pending' as const
      };
    }));
    setStep('summary');
  }

  // --- save the session (to pause) ---
  const saveSession = (fs: ImportRow[], idx: number) =>
    mutate(dd => { dd.importSession = { file: fileName, startedOn: dd.importSession?.startedOn ?? todayISO(), i: idx, rows: fs } as ImportSession; }, { undo: false });
  const logout = () => mutate(dd => { dd.importSession = null; }, { undo: false });

  function startOneByOne() {
    const fs = rows.map(f => ({ ...f, noDate: f.noDate ?? !f.openedOn, openedOn: f.openedOn || defaultOpenedOn }));
    setRows(fs); setI(0); setStep('one');
    saveSession(fs, 0);
  }

  function importAll(from = 0) {
    const fs = rows.map((f, k) => (k < from || f.result !== 'pending') ? f
      : { ...f, noDate: f.noDate ?? !f.openedOn, openedOn: f.openedOn || defaultOpenedOn });
    const lists = fs.map((f, k) => ({ f, k })).filter(({ f, k }) => k >= from && f.result === 'pending' && valid(f));
    mutate(dd => {
      lists.forEach(({ f }) => applyRow(dd, f));
      dd.importSession = null;
    });
    const end = fs.map((f, k) => lists.some(x => x.k === k) ? { ...f, result: 'imported' as const } : f.result === 'pending' && k >= from ? { ...f, result: 'skipped' as const } : f);
    setRows(end); setStep('done');
  }

  // --- tarjeta actual ---
  const f = rows[i];
  const upd = (p: Partial<ImportRow>) => { setErr(''); setRows(fs => fs.map((x, k) => (k === i ? { ...x, ...p } : x))); };
  const pending = rows.filter(x => x.result === 'pending').length;

  function nextPending(fs: ImportRow[], from: number) {
    for (let k = from + 1; k < fs.length; k++) if (fs[k].result === 'pending') return k;
    for (let k = 0; k <= from; k++) if (fs[k].result === 'pending') return k;
    return -1;
  }
  function advance(fs: ImportRow[]) {
    const n = nextPending(fs, i);
    setRows(fs);
    if (n < 0) { logout(); setStep('done'); return; }
    setI(n); saveSession(fs, n);
  }
  function saveCurrent() {
    const code = normalizeCode(f.code);
    if (!isValidCode(code)) return setErr('El número debe tener el formato D1-XXXX-AAAA.');
    if (!f.name.trim()) return setErr('Falta el nombre del proyecto.');
    if (!f.openedOn) return setErr('Falta la fecha de apertura.');
    const other = getData().projects.find(b => b.code === code);
    if (other && other.id !== f.existingId && f.existingId) return setErr(`Ya existe otra bitácora con el número ${code}.`);
    const row = { ...f, code: code, result: 'imported' as const };
    mutate(dd => { applyRow(dd, row); });
    advance(rows.map((x, k) => (k === i ? row : x)));
  }
  function skipCurrent() { advance(rows.map((x, k) => (k === i ? { ...x, result: 'skipped' as const } : x))); }
  function pause() {
    saveSession(rows, i);
    closeModal();
    toast(`Importación en pausa: ${pending} por revisar. Sigue cuando quieras desde «Importar PDF».`);
  }
  async function discard() {
    const ok = await confirmDialog({ title: '¿Descartar la importación?', text: `Las ${rows.filter(x => x.result === 'imported').length} bitácoras ya guardadas se quedan; las ${pending} pendientes no se importan.`, ok: 'Descartar', danger: true });
    logout();
    if (ok) toast('Importación descartada'); else openImport();
  }

  // ===================== Pantallas =====================
  if (step === 'load') return (
    <>
      <HbHead icon="📄" title="Importar desde PDF" sub="Paso 1 de 3 · elige el archivo" color="#60a5fa" />
      <div className={`drop large ${drag ? 'over' : ''}`} onClick={() => fileRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); const x = e.dataTransfer.files[0]; if (x) readPdf(x); }}>
        <Ic n="upload" size={34} />
        <b>{loading || 'Suelta aquí el PDF de SETENA'}</b>
        <small>o haz clic para elegirlo</small>
      </div>
      <input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden onChange={e => { const x = e.target.files?.[0]; if (x) readPdf(x); e.target.value = ''; }} />
      <details className="paste">
        <summary>¿No tienes el PDF? Pega el texto</summary>
        <textarea className="modal-input mono sm" rows={6} value={text} onChange={e => setText(e.target.value)}
          placeholder={'D1-0170-2020   CONDOMINIO VISTA DEL BOSQUE   Abierta'} />
        <button className="btn primary sm" disabled={!text.trim()} onClick={() => { setFileName('Texto pegado'); analyze(); }}>Analizar texto</button>
      </details>
      <div className="modal-btns"><button className="modal-btn cancel" onClick={closeModal}>Cancelar</button></div>
    </>
  );

  if (step === 'summary') {
    const newCount = rows.filter(x => !x.existingId).length;
    const existing = rows.length - newCount;
    const doubts = rows.filter(x => x.doubts.length || !x.name.trim()).length;
    const noDate = rows.filter(x => !x.openedOn).length;
    return (
      <>
        <HbHead icon="🔎" title={`${rows.length} bitácoras encontradas`} sub={`Paso 2 de 3 · ${fileName}`} color="#60a5fa" />
        {!rows.length ? <p className="modal-text center">No se encontró ningún número con formato D1-XXXX-AAAA. Prueba pegando el texto.</p> : <>
          <div className="hb-stats">
            <div><b>{newCount}</b><span>nuevas</span></div>
            <div><b>{existing}</b><span>ya existen</span></div>
            <div className={doubts ? 'warn' : ''}><b>{doubts}</b><span>por revisar</span></div>
          </div>
          <div className="imp-defs">
            <p className="imp-defs-t">Las entregas se calculan solas desde la fecha de apertura (luego se puede ajustar cada una). Para las que no la traigan en el PDF:</p>
            <label><span>Fecha de apertura {noDate ? <small>({noDate} sin fecha en el PDF)</small> : null}</span>
              <input type="date" className="modal-input" value={defaultOpenedOn} onChange={e => e.target.value && setDefaultOpenedOn(e.target.value)} /></label>
          </div>
        </>}
        <div className="modal-btns">
          <button className="modal-btn cancel" onClick={() => setStep('load')}>← Volver</button>
          <span className="grow" />
          {rows.length > 0 && <button className="modal-btn cancel" onClick={() => importAll(0)} title="Sin revisar una por una">Importar todas ya</button>}
          {rows.length > 0 && <button className="modal-btn ok" autoFocus onClick={startOneByOne}>Revisar una por una →</button>}
        </div>
      </>
    );
  }

  if (step === 'done' || !f) {
    const session = rows.filter(x => x.result === 'imported');
    return (
      <>
        <HbHead icon="🎉" title="¡Importación terminada!" sub={fileName} />
        <div className="hb-stats">
          <div><b>{session.filter(x => !x.existingId).length}</b><span>nuevas</span></div>
          <div><b>{session.filter(x => x.existingId).length}</b><span>actualizadas</span></div>
          <div><b>{rows.filter(x => x.result === 'skipped').length}</b><span>omitidas</span></div>
        </div>
        <div className="modal-btns center"><button className="modal-btn ok" autoFocus onClick={() => { logout(); closeModal(); }}>¡Listo!</button></div>
      </>
    );
  }

  // ---- one by one ----
  const doneCount = rows.filter(x => x.result !== 'pending').length;
  const ex = f.existingId ? d.projects.find(b => b.id === f.existingId) : null;
  const changes = ex ? [ex.status !== f.status && `estado: ${statusName(ex.status)} → ${statusName(f.status)}`, ex.name !== f.name.trim() && 'name', ex.openedOn !== f.openedOn && 'fecha de apertura'].filter(Boolean) : [];
  const due = f.openedOn ? addMonths(f.openedOn, 6) : '';
  return (
    <div className="one" onKeyDown={e => { if (e.key === 'Enter' && !(e.target as HTMLElement).closest('select,textarea')) { e.preventDefault(); saveCurrent(); } }}>
      <div className="one-top">
        <span className="one-n">Bitácora <b>{i + 1}</b> de {rows.length}</span>
        <div className="one-bar"><i style={{ width: `${(doneCount / rows.length) * 100}%` }} /></div>
        <button className="btn sm" onClick={pause} title="Guarda tu avance y cierra; sigue cuando quieras"><Ic n="clock" size={14} /> Pausar</button>
      </div>
      {session && doneCount > 0 && i === session.i && <p className="one-resume">▶ Continuando la importación de <b>{fileName}</b> ({doneCount} listas).</p>}

      <div className="one-card">
        <div className="one-tags">
          {ex ? <span className="tag changes">Ya existe{changes.length ? ` · cambia ${changes.join(', ')}` : ' · sin cambios'}</span> : <span className="tag new">Nueva</span>}
          {f.doubts.length > 0 && <span className="tag doubt" title={f.doubts.join('\n')}><Ic n="warn" size={12} /> {f.doubts[0]}</span>}
        </div>

        <label className="one-l">Número</label>
        <input className="modal-input mono one-code" value={f.code} onChange={e => upd({ code: e.target.value.toUpperCase() })} />
        <label className="one-l">Nombre del proyecto</label>
        <input className="modal-input one-name" value={f.name} autoFocus={!f.name} placeholder="Escribe el nombre del proyecto" onChange={e => upd({ name: e.target.value })} />

        <div className="one-grid">
          <div>
            <label className="one-l">Estado</label>
            <div className="chip-pick">{STATUSES.map(s => (
              <button key={s.id} className={`echip status-${s.id} ${f.status === s.id ? 'on' : ''}`} onClick={() => upd({ status: s.id as Status })}>{s.name}</button>))}</div>
          </div>
          <div>
            <label className="one-l">Fecha de apertura</label>
            <input type="date" className="modal-input" value={f.openedOn} onChange={e => upd({ openedOn: e.target.value, noDate: false })} />
            {due && <small className="one-hint">Informe Regencial el día {fromISO(f.openedOn).getDate()} de cada mes · 1.ª Regencia {longDate(due)} (avisos desde {shortDate(reminderFrom(due))})</small>}
          </div>
          <div>
            <label className="one-l">Avance</label>
            <div className="chip-pick">{d.labels.map(e => (
              <button key={e.id} className={`echip ${f.labelId === e.id ? 'on' : ''}`} style={{ ['--ec' as any]: e.color }} onClick={() => upd({ labelId: e.id })}><span className="dot" />{e.name}</button>))}</div>
          </div>
        </div>
      </div>

      <p className="ed-error" role="alert">{err}</p>
      <div className="modal-btns one-btns">
        <button className="modal-btn cancel" disabled={i === 0} onClick={() => setI(Math.max(0, i - 1))}>←</button>
        <button className="modal-btn cancel" onClick={skipCurrent}>Omitir</button>
        <span className="grow" />
        <button className="dp-link" onClick={() => importAll(i)} title="Importa las que faltan con los valores actuales">Importar las {pending} restantes</button>
        <button className="dp-link danger" onClick={discard}>Descartar</button>
        <button className="modal-btn ok" onClick={saveCurrent}>{f.result === 'imported' ? 'Guardar de nuevo →' : 'Guardar y siguiente →'}</button>
      </div>
    </div>
  );
}

/** For the rest of the app: is there a paused import? */
export function pausedImport(d: AppData) {
  const s = d.importSession;
  if (!s) return null;
  return { file: s.file, doneCount: s.rows.filter(f => f.result !== 'pending').length, total: s.rows.length };
}
