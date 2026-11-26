// ===== Project log (inside the editor) =====
// Same as the SETENA portal timeline: each entry has a date, type, text and
// photos / files. Each stays «Por subir a SETENA» (to upload) until it is marked as uploaded.
// Photos and PDFs are saved in <data folder>/proyectos/<code>/.
// From the phone: QR on the same Wi-Fi network → photos arrive by themselves as a new entry.
import { useEffect, useRef, useState } from 'react';
import type { LogEntry, Attachment, Project, EntryType, ProjectLocation, Step } from '../lib/types';
import { ENTRY_TYPES, isActiveProject } from '../lib/types';
import { backend, esTauri, esWeb } from '../lib/backend';
import { getData, markRegencia, markStep, mutate, organizeFiles, recordVisit, useAppData } from '../lib/store';
import { nextRegencia, reportTasks, REPORT_LABEL } from '../lib/schedule';
import { addDays, shortDate, longDate, monthNameOf, todayISO, uid } from '../lib/dates';
import { photoInfo, commonDate, gpsComun, type PhotoInfo } from '../lib/exif';
import { distanceKm, kmTxt, mapLink } from '../lib/geo';
import { Ic, toast } from './core';

const isPhone = typeof window !== 'undefined' && (matchMedia?.('(pointer: coarse)').matches && innerWidth < 900);

export const SETENA_URL = 'https://bitacora.setena.go.cr/';

// ---------- file helpers ----------
const readDataUrl = (f: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); });
async function thumbnail(f: File, max = 360): Promise<string | undefined> {
  try {
    const bmp = await createImageBitmap(f);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.72).split(',')[1];
  } catch { return undefined; }
}
const typeOf = (n: string): Attachment['type'] => /\.(jpe?g|png|webp|heic|gif|bmp)$/i.test(n) ? 'photo' : /\.pdf$/i.test(n) ? 'pdf' : 'other';

/** Web: photos are shrunk to 2000 px before uploading (faster on mobile data). */
async function compress(f: File, max = 2000): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(f);
    if (Math.max(bmp.width, bmp.height) <= max && f.size < 1.5e6 && /jpe?g$/i.test(f.type)) return null;
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85).split(',')[1];
  } catch { return null; }
}

export async function saveAttachments(code: string, files: File[], date: string, progress?: (i: number) => void, folder?: string): Promise<Attachment[]> {
  const out: Attachment[] = [];
  for (const [i, f] of files.entries()) {
    progress?.(i + 1);
    const type = typeOf(f.name);
    // Date and GPS are read from the ORIGINAL (they are lost when the photo is shrunk)
    const meta = type === 'photo' ? await photoInfo(f) : null;
    const reduced = esWeb && type === 'photo' ? await compress(f) : null;
    const finalName = reduced ? f.name.replace(/\.[^.]+$/, '') + '.jpg' : f.name;
    const data = reduced ?? (await readDataUrl(f)).split(',')[1];
    const thumb = type === 'photo' ? await thumbnail(f) : undefined;
    const g = await backend.saveAttachment(code, `${date}_${finalName}`, data, thumb, folder);
    out.push({ id: uid(), name: finalName, path: g.path, thumb: g.thumb, type: type, takenOn: meta?.date ?? null, lat: meta?.lat ?? null, lng: meta?.lng ?? null });
  }
  return out;
}

// ---------- cached thumbnail ----------
const cache = new Map<string, string>();
export function Thumb({ a, near }: { a: Attachment; near?: ProjectLocation | null }) {
  const [src, setSrc] = useState<string | null>(a.thumb ? cache.get(a.thumb) ?? null : null);
  useEffect(() => {
    if (!a.thumb || cache.has(a.thumb)) return;
    backend.readB64(a.thumb).then(b => { const u = `data:image/jpeg;base64,${b}`; cache.set(a.thumb!, u); setSrc(u); }).catch(() => { /* no thumbnail */ });
  }, [a.thumb]);
  const hasGps = a.lat != null && a.lng != null;
  const km = hasGps && near ? distanceKm({ lat: a.lat!, lng: a.lng! }, near) : null;
  return (
    <span className="att-wrap">
      <button type="button" className={`att ${a.type}`} title={`Abrir ${a.name}${a.takenOn ? ` · tomada el ${longDate(a.takenOn)}` : ''}${hasGps ? ` · GPS ${a.lat}, ${a.lng}` : ''}`} onClick={() => backend.openAttachment(a.path).catch(e => toast(String(e)))}>
        {src ? <img src={src} alt={a.name} /> : <span>{a.type === 'pdf' ? '📄' : a.type === 'photo' ? '🖼️' : /\.docx?$/i.test(a.name) ? '📝' : '📎'}<small>{a.name}</small></span>}
      </button>
      {a.type === 'photo' && (
        <span className="att-cap">
          {a.takenOn ? shortDate(a.takenOn) : 'sin fecha'}
          {hasGps && <button type="button" title={`Ver dónde se tomó${km !== null ? ` (a ${kmTxt(km)} del proyecto)` : ''}`}
            className={km !== null && km > 2 ? 'red-t' : ''}
            onClick={() => backend.openMap(mapLink({ lat: a.lat!, lng: a.lng! })).catch(e => toast(String(e)))}>📍{km !== null ? ` ${kmTxt(km)}` : ''}</button>}
        </span>
      )}
    </span>
  );
}

// ---------- receiving from the phone (registered once, in App) ----------
let listening = false;
export function listenToPhone() {
  if (listening) return;
  listening = true;
  // A checkbox ticked on the phone: done on the task's own date (or today if it is in the future)
  backend.onPhoneCheck(c => {
    const today = todayISO();
    const t = reportTasks(getData(), today, addDays(today, 60));
    const task = [...t.overdue, ...t.upcoming].find(x => x.b.id === c.id && x.key === c.key && x.step === c.step);
    const date = task && task.date <= today ? task.date : today;
    markStep(c.id, c.key, c.step as Step, c.done ? date : null);
    const b = getData().projects.find(x => x.id === c.id);
    toast(`📱 ${b?.code ?? ''}: ${task ? REPORT_LABEL[task.kind].replace(/^\S+\s/, '') : c.step} ${c.done ? 'hecha' : 'desmarcada'}`, true);
  });
  backend.onPhone(r => {
    const d = getData();
    const b = d.projects.find(x => x.code === r.code);
    if (!b) return;
    const noteOnly = r.name === 'nota.txt' && !r.thumb;
    mutate(dd => {
      const x = dd.projects.find(y => y.id === b.id);
      if (!x) return;
      let an = x.entries.find(a => a.batch === r.batch);
      if (!an) {
        an = { id: uid(), date: r.date || todayISO(), type: 'visit', text: r.note, attachments: [], regencia: null, uploaded: false, uploadedOn: null, source: 'phone', batch: r.batch, createdOn: todayISO() };
        x.entries.push(an);
      } else if (!an.text && r.note) an.text = r.note;
      if (!noteOnly) an.attachments.push({ id: uid(), name: r.name, path: r.path, thumb: r.thumb, type: 'photo', takenOn: r.takenOn ?? null, lat: r.lat ?? null, lng: r.lng ?? null });
    }, { undo: false });
    if (r.index !== r.total) return;
    if (noteOnly) { toast(`📱 Nota recibida en ${r.code}`); return; }
    // Last photo of the batch: mark the Informe Regencial's visit + photos and the location from the GPS
    const an = getData().projects.find(x => x.id === b.id)?.entries.find(a => a.batch === r.batch);
    const photos = an?.attachments ?? [];
    const gps = gpsComun(photos.map(f => ({ date: f.takenOn ?? null, time: null, lat: f.lat ?? null, lng: f.lng ?? null })));
    const hadLocation = !!b.location;
    const month = recordVisit(b.id, an?.date || r.date || todayISO(), gps, { undo: false });
    // The note from the phone goes into that month's notes
    if (month && an?.text.trim()) {
      const note = an.text.trim();
      mutate(dd => {
        const x = dd.projects.find(y => y.id === b.id);
        if (!x) return;
        const key = `m:${month}`;
        x.deliveries = x.deliveries ?? {};
        const e = x.deliveries[key] ?? { planned: null, due: null, visit: null, photos: null, letter: null, uploaded: null, received: null, letterText: '', files: [] };
        x.deliveries[key] = { ...e, notes: [e.notes, `📱 ${note}`].filter(Boolean).join('\n') };
        const en = x.entries.find(a => a.batch === r.batch);
        if (en) en.text = '';
      }, { undo: false });
    }
    organizeFiles(); // the photos go into the month they belong to (and into its Fotos folder)
    const far = gps && b.location ? distanceKm(gps, b.location) : 0;
    toast(`📱 ${r.total} foto(s) recibida(s) en ${r.code}` + (month ? ` · visita y fotos marcadas (${monthNameOf(month)})` : '') +
      (gps && !hadLocation ? ' · ubicación del proyecto tomada del GPS' : '') + (far > 2 ? ` · ⚠️ las fotos se tomaron a ${kmTxt(far)} del proyecto: ¿es el proyecto correcto?` : ''));
  });
}

// ---------- panel ----------
export function ProjectLog({ id }: { id: string }) {
  const d = useAppData();
  const b = d.projects.find(x => x.id === id) as Project | undefined;
  const [isNew, setShowNew] = useState(false);
  const [qr, setQr] = useState<{ url: string; svg: string } | null>(null);
  const [qrErr, setQrErr] = useState('');
  const [onlyPending, setOnlyPending] = useState(false);
  const [toDelete, setToDelete] = useState<string | null>(null);
  if (!b) return <p className="muted sm">Guarda primero la bitácora para poder agregar anotaciones y fotos.</p>;

  const list = [...b.entries].filter(a => !onlyPending || !a.uploaded).sort((x, y) => y.date.localeCompare(x.date) || y.createdOn.localeCompare(x.createdOn));
  const pending = b.entries.filter(a => !a.uploaded).length;
  const photos = b.entries.reduce((n, a) => n + a.attachments.filter(f => f.type === 'photo').length, 0);

  const up = (aid: string, f: (a: LogEntry) => void) => mutate(dd => { const x = dd.projects.find(y => y.id === id)?.entries.find(a => a.id === aid); if (x) f(x); });

  async function openQr() {
    setQrErr('');
    if (qr) { setQr(null); return; }
    try { setQr(await backend.phoneStart()); } catch (e: any) { setQrErr(e?.message || String(e)); }
  }

  return (
    <div className="log">
      <div className="log-bar">
        <button type="button" className="btn primary sm" onClick={() => setShowNew(v => !v)}><Ic n="plus" size={14} /> Nueva anotación</button>
        {!(esWeb && isPhone) && <button type="button" className={`btn sm ${qr ? 'on' : ''}`} onClick={openQr} data-help-title="Fotos desde el celular" data-help="Muestra un código QR. Escanéalo con el celular (mismo Wi-Fi) para tomar fotos en la visita: llegan solas a este proyecto." title="Tomar o enviar fotos desde el celular"><span>📱</span> Fotos desde el celular</button>}
        {!esWeb && <button type="button" className="btn sm" onClick={() => backend.openProjectFolder(b.code).catch(e => toast(String(e)))} title="Carpeta con las fotos y archivos de este proyecto"><span>📂</span> Carpeta</button>}
        <button type="button" className="btn sm" onClick={() => backend.openSetena(SETENA_URL).catch(e => toast(String(e)))} title="Abrir el portal de bitácoras de SETENA"><span>🌐</span> Abrir SETENA</button>
      </div>

      {(qr || qrErr) && (
        <div className="qr-box">
          {qrErr ? <p className="ed-hint warn">{qrErr}</p> : qr && esWeb ? (
            <div className="qr-txt">
              <b>En el celular, abre esta misma página</b>
              <p className="qr-url"><code>{qr.url}</code> <button type="button" className="dp-link" onClick={() => navigator.clipboard.writeText(qr.url).then(() => toast('Enlace copiado'))}>Copiar enlace</button></p>
              <ol>
                <li>Inicia sesión con tu usuario (o agrégala a la pantalla de inicio para usarla como app).</li>
                <li>Abre el proyecto → «Bitácora» → <b>Nueva anotación</b> → <b>📷 Tomar foto</b>.</li>
                <li>Todo queda guardado en el servidor y lo ves aquí al instante.</li>
              </ol>
            </div>
          ) : qr && <>
            <div className="qr" dangerouslySetInnerHTML={{ __html: qr.svg }} />
            <div className="qr-txt">
              <b>Escanéalo con la cámara del celular</b>
              <ol>
                <li>El celular debe estar en el <b>mismo Wi-Fi</b> que esta computadora.</li>
                <li>Elige el proyecto, toma fotos o elígelas de la galería y escribe una nota.</li>
                <li>Llegan aquí solas como anotación <b>Por subir a SETENA</b>.</li>
              </ol>
              <small className="muted">Si Windows pregunta por el acceso a la red, elige «Permitir». Dirección: <code>{qr.url.split('?')[0]}</code></small>
            </div>
          </>}
        </div>
      )}

      {isNew && <NewEntry b={b} onDone={() => setShowNew(false)} />}

      <div className="log-filter">
        <span>{b.entries.length} anotaciones · {photos} fotos</span>
        {pending > 0 && <button type="button" className={`fchip warn ${onlyPending ? 'on' : ''}`} onClick={() => setOnlyPending(v => !v)}>Por subir<b>{pending}</b></button>}
      </div>

      <div className="timeline">
        {!list.length && <p className="muted sm">{onlyPending ? 'Todo está subido a SETENA. 🎉' : 'Aún no hay anotaciones. Agrega fotos de una visita, la Regencia en PDF o una observación.'}</p>}
        {list.map(a => {
          const t = ENTRY_TYPES.find(x => x.id === a.type)!;
          return (
            <article key={a.id} className={`entry t-${a.type} ${a.uploaded ? 'uploaded' : ''}`}>
              <header>
                <span className="entry-ic">{t.icon}</span>
                <b>{longDate(a.date)}</b>
                <span className="muted">· {t.name}{a.source === 'phone' ? ' · desde el celular' : ''}{a.regencia ? ` · informe ${shortDate(a.regencia)}` : ''}</span>
                <span className="grow" />
                <button type="button" className={`upload-pill ${a.uploaded ? 'on' : ''}`} title={a.uploaded ? 'Clic para marcar como pendiente' : 'Clic cuando ya la subiste al portal de SETENA'}
                  onClick={() => up(a.id, x => { x.uploaded = !x.uploaded; x.uploadedOn = x.uploaded ? todayISO() : null; })}>
                  {a.uploaded ? <><Ic n="check" size={12} /> Subida {a.uploadedOn ? shortDate(a.uploadedOn) : ''}</> : <>⬆ Por subir a SETENA</>}
                </button>
              </header>
              {a.text && <p className="entry-text">{a.text}</p>}
              {a.attachments.length > 0 && <div className="atts">{[...a.attachments].sort((x, y) => (x.takenOn ?? '9').localeCompare(y.takenOn ?? '9')).map(f => <Thumb key={f.id} a={f} near={b.location} />)}</div>}
              <footer>
                {a.text && <button type="button" className="dp-link" onClick={() => navigator.clipboard.writeText(a.text).then(() => toast('Texto copiado: pégalo en «Escribir» de SETENA'))}>Copiar texto</button>}
                {a.attachments.length > 0 && !esWeb && <button type="button" className="dp-link" onClick={() => backend.openProjectFolder(b.code)}>Ver archivos para «Adjunto»</button>}
                <span className="grow" />
                {toDelete === a.id ? <span className="conf-inline">¿Eliminar?
                  <button type="button" className="dp-link danger" onClick={() => {
                    a.attachments.forEach(f => { backend.deleteAttachment(f.path).catch(() => { /* ya no está */ }); if (f.thumb) backend.deleteAttachment(f.thumb).catch(() => { /* ya no está */ }); });
                    mutate(dd => { const x = dd.projects.find(y => y.id === id); if (x) x.entries = x.entries.filter(y => y.id !== a.id); });
                    setToDelete(null); toast('Anotación eliminada (los archivos van a la carpeta «papelera»)', true);
                  }}>Sí</button>
                  <button type="button" className="dp-link" onClick={() => setToDelete(null)}>No</button></span>
                  : <button type="button" className="dp-link danger" onClick={() => setToDelete(a.id)}>Eliminar</button>}
              </footer>
            </article>
          );
        })}
      </div>
      {!isActiveProject(b) && <p className="muted sm">Este proyecto ya no genera entregas, pero puedes seguir guardando su historial.</p>}
    </div>
  );
}


function NewEntry({ b, onDone: onDone }: { b: Project; onDone: () => void }) {
  const [date, setDateRaw] = useState(todayISO());
  const [dateTouched, setDateTouched] = useState(false);
  const setDate = (v: string) => { setDateRaw(v); setDateTouched(true); };
  const [meta, setMeta] = useState<PhotoInfo[]>([]);
  const [useLocation, setUseLocation] = useState(true);
  const [type, setType] = useState<EntryType>('visit');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const [saving, setSaving] = useState(false);
  const regInfo = nextRegencia(b);
  const [markSubmitted, setMarkSubmitted] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);

  // When adding photos: read their date and GPS to suggest the visit date and the location
  async function addFiles(l: File[]) {
    if (!l.length) return;
    setFiles(f => [...f, ...l]);
    const newOnes = await Promise.all(l.filter(f => typeOf(f.name) === 'photo').map(f => photoInfo(f)));
    setMeta(m => {
      const everything = [...m, ...newOnes];
      const fc = commonDate(everything);
      if (fc && !dateTouched) setDateRaw(fc);
      return everything;
    });
  }
  const fc = commonDate(meta), gps = gpsComun(meta), gpsPhotos = meta.filter(x => x.lat !== null).length;
  const far = gps && b.location ? distanceKm(gps, b.location) : null;

  async function save() {
    if (!text.trim() && !files.length) { toast('Escribe una nota o agrega fotos / archivos'); return; }
    setSaving(true);
    try {
      const attachments = await saveAttachments(b.code, files, date, setUploading);
      const an: LogEntry = { id: uid(), date: date, type: type, text: text.trim(), attachments: attachments, regencia: type === 'regencia' && regInfo ? regInfo.key : null,
        uploaded: false, uploadedOn: null, source: 'pc', createdOn: todayISO() };
      mutate(dd => { dd.projects.find(y => y.id === b.id)?.entries.push(an); });
      if (type === 'regencia' && regInfo && markSubmitted) markRegencia(b.id, regInfo.key, true);
      let extra = '';
      const hasPhotos = attachments.some(a => a.type === 'photo');
      if (type === 'visit' && hasPhotos) {
        const month = recordVisit(b.id, date, useLocation ? gps : null, { location: useLocation });
        if (month) extra += ` · visita y fotos marcadas en el Informe Regencial de ${monthNameOf(month)}`;
        if (gps && useLocation && !b.location) extra += ' · ubicación guardada';
      } else if (gps && useLocation && !b.location) {
        mutate(dd => { const x = dd.projects.find(y => y.id === b.id); if (x && !x.location) x.location = { ...gps, text: '', source: 'photo' }; });
        extra += ' · ubicación guardada';
      }
      if (organizeFiles()) extra += ' · archivos guardados en su mes'; // photos / documents go into the month they belong to
      toast(`Anotación guardada en ${b.code}${extra}`, true);
      onDone();
    } catch (e: any) { toast('No se pudo guardar: ' + (e?.message || e)); }
    setSaving(false);
  }

  return (
    <div className="new-entry">
      <div className="na-row">
        <input type="date" className="modal-input" value={date} onChange={e => e.target.value && setDate(e.target.value)} />
        <div className="chip-pick">{ENTRY_TYPES.map(t => (
          <button type="button" key={t.id} className={`echip ${type === t.id ? 'on' : ''}`} onClick={() => setType(t.id)}>{t.icon} {t.name}</button>))}</div>
      </div>
      <textarea className="modal-input" rows={3} value={text} onChange={e => setText(e.target.value)}
        placeholder={type === 'regencia' ? 'Se procede a presentar informe de Regencia Ambiental…' : type === 'observation' ? 'Observación de SETENA o del regente…' : 'Qué se hizo / observó en la visita…'} />
      {meta.length > 0 && (
        <div className="photo-meta">
          {fc ? <span>📅 Fotos tomadas el <b>{longDate(fc)}</b>{fc === date ? ' (usada como fecha)' : <> · <button type="button" className="dp-link" onClick={() => setDate(fc)}>usar esa fecha</button></>}</span>
            : <span className="muted">📅 Las fotos no traen fecha (se usa la que pongas arriba).</span>}
          {gps ? <span>📍 {gpsPhotos} con GPS{far !== null ? <> · a <b className={far > 2 ? 'red-t' : ''}>{kmTxt(far)}</b> del proyecto{far > 2 ? ' — ⚠️ ¿es el proyecto correcto?' : ''}</> : ''}</span>
            : <span className="muted">📍 Sin GPS (en el celular: Cámara → permitir ubicación; al compartir, incluir ubicación).</span>}
          {gps && !b.location && <label className="na-check"><input type="checkbox" checked={useLocation} onChange={e => setUseLocation(e.target.checked)} /> Guardar como ubicación del proyecto</label>}
        </div>
      )}
      {type === 'regencia' && regInfo && (
        <label className="na-check"><input type="checkbox" checked={markSubmitted} onChange={e => setMarkSubmitted(e.target.checked)} /> Marcar como subida la Regencia que vence el {longDate(regInfo.due)}</label>
      )}
      <div className={`drop mini ${drag ? 'over' : ''}`} onClick={() => fileRef.current?.click()}
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); setDrag(false); addFiles(Array.from(e.dataTransfer.files) as File[]); }}>
        <Ic n="upload" size={18} /> {files.length ? `${files.length} archivo(s): ${files.map(f => f.name).slice(0, 3).join(', ')}${files.length > 3 ? '…' : ''}` : 'Arrastra fotos o el PDF del informe, o haz clic para elegir'}
      </div>
      <div className="na-row">
        <button type="button" className="btn sm" onClick={() => camRef.current?.click()}>📷 Tomar foto</button>
        <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}>🖼️ Fotos o PDF</button>
        {files.length > 0 && <button type="button" className="dp-link" onClick={() => { setFiles([]); setMeta([]); }}>Quitar archivos</button>}
      </div>
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={e => { const l = Array.from(e.target.files ?? []) as File[]; addFiles(l); e.target.value = ''; }} />
      <input ref={fileRef} type="file" multiple accept="image/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx" hidden onChange={e => { const l = Array.from(e.target.files ?? []) as File[]; addFiles(l); e.target.value = ''; }} />
      {!esTauri && !esWeb && <small className="muted">(Vista de prueba en navegador: los archivos no se guardan en disco)</small>}
      <div className="modal-btns">
        <button type="button" className="modal-btn cancel" onClick={onDone}>Cancelar</button>
        <button type="button" className="modal-btn ok" disabled={saving} onClick={save}>{saving ? (files.length > 1 && uploading ? `Subiendo ${uploading}/${files.length}…` : 'Guardando…') : 'Guardar anotación'}</button>
      </div>
    </div>
  );
}
