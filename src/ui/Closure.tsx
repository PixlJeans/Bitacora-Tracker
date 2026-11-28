// ===== «🔒 Cierre del proyecto»: final regencia → SETENA approves → guarantee returned =====
import type { AppData, Project, ClosureStep } from '../lib/types';
import { CLOSURE_STEPS, closureFromDocs, closureNext, closureOf, inClosure, guaranteeOf, fileAlerts } from '../lib/closure';
import { markClosure, getData } from '../lib/store';
import { appOnly } from '../lib/setenaMatch';
import { shortDate, todayISO } from '../lib/dates';
import { Ic, toast } from './core';
import { openEditor } from './ProjectEditor';

const label = (s: ClosureStep) => CLOSURE_STEPS.find(x => x.id === s)!.name;

/** The closing steps of one project, each a check with its date (in the project editor). */
export function ClosureBox({ b }: { b: Project }) {
  const c = closureOf(b), auto = closureFromDocs(b), today = todayISO();
  const next = closureNext(b);
  return (
    <div className="cz-box">
      <div className="cz-head"><b>🔒 Cierre del proyecto</b>
        <span className="muted">{next ? next.text : '✓ Cerrado: la garantía ya se devolvió. Ya se puede archivar con 📦.'}</span></div>
      <ol className="cz-steps">
        {CLOSURE_STEPS.map((s, i) => {
          const on = !!c[s.id], fromPdf = on && auto[s.id] === c[s.id] && !(b.closure && s.id in b.closure);
          const blocked = s.id === 'guarantee' && !c.approved;
          return (
            <li key={s.id} className={`cz-step ${on ? 'on' : ''} ${blocked ? 'blocked' : ''}`}>
              <button type="button" className="tk-step-box" disabled={blocked}
                title={blocked ? 'La garantía se devuelve solo cuando SETENA aprueba el cierre' : on ? 'Desmarcar' : 'Marcar hecho hoy'}
                onClick={() => { markClosure(b.id, s.id, on ? null : today); toast(on ? `${b.code}: «${s.name}» desmarcado` : `✓ ${b.code}: ${s.name}`, true); }}>
                {on && <Ic n="check" size={11} />}
              </button>
              <span>{s.icon} {s.name}{i === 3 ? <small className="muted"> (opcional)</small> : null}</span>
              {on && <input type="date" className="cz-date" value={c[s.id]!} max={today}
                onChange={e => e.target.value && markClosure(b.id, s.id, e.target.value)} />}
              {fromPdf && <small className="muted" title="Leído del PDF del informe final">· del PDF</small>}
              {blocked && <small className="muted">· después de la aprobación</small>}
            </li>
          );
        })}
      </ol>
      <p className="muted sm">La garantía ambiental es el cheque que SETENA pide mientras el proyecto está activo: se le devuelve al propietario cuando SETENA aprueba la Solicitud de Cierre.</p>
    </div>
  );
}

/** Projects being closed and what each needs next (in Tareas). */
export function ClosureTasks({ d }: { d: AppData }) {
  const list = d.projects.filter(inClosure).map(b => ({ b, next: closureNext(b) })).filter(x => x.next)
    .sort((x, y) => Number(!!x.next!.wait) - Number(!!y.next!.wait) || x.b.code.localeCompare(y.b.code));
  if (!list.length) return null;
  const today = todayISO();
  return (
    <section className="tk-sec closing">
      <h3>🔒 Cierres <span className="tk-n">{list.length}</span></h3>
      {list.map(({ b, next }) => {
        const c = closureOf(b);
        return (
          <div key={b.id} className={`tk-row tk-reg cz-row-task ${next!.wait ? 'wait' : ''}`}>
            <div className="tk-steps">
              <span className="tk-what">{CLOSURE_STEPS.find(x => x.id === next!.step)!.icon} {next!.text}</span>
              {next!.step === 'approved' && <button type="button" className="tk-step" title="SETENA ya aprobó la Solicitud de Cierre"
                onClick={() => { markClosure(b.id, 'approved', today); toast(`✓ ${b.code}: cierre aprobado`, true); }}><span className="tk-step-box" />Ya lo aprobó</button>}
              {next!.step === 'guarantee' && <button type="button" className="tk-step" title="El cheque de la garantía ya se le devolvió al propietario"
                onClick={() => { markClosure(b.id, 'guarantee', today); toast(`✓ ${b.code}: garantía devuelta`, true); }}><span className="tk-step-box" />Devuelta</button>}
              {(next!.step === 'letter' || next!.step === 'signed' || next!.step === 'uploaded') && <button type="button" className="tk-step"
                onClick={() => { markClosure(b.id, next!.step, today); toast(`✓ ${b.code}: ${label(next!.step)}`, true); }}><span className="tk-step-box" />{label(next!.step)}</button>}
            </div>
            <button type="button" className="tk-proj" title="Abrir el proyecto" onClick={() => openEditor(getData().projects.find(x => x.id === b.id) ?? b)}>
              <b className="mono">{b.code}</b> <span>{b.name}</span>
            </button>
            <span className="tk-date"><small>{c.uploaded ? `informe final ${shortDate(c.uploaded)}${c.uploaded.slice(0, 4) !== today.slice(0, 4) ? ` ${c.uploaded.slice(2, 4)}` : ''}` : 'sin informe final'}</small>
              {c.approved && <small>aprobado {shortDate(c.approved)}</small>}</span>
          </div>
        );
      })}
    </section>
  );
}

/** «🛡️ Garantía ambiental»: its documents found in the project's files and the validity they state. */
export function GuaranteeLine({ b }: { b: Project }) {
  const g = guaranteeOf(b), today = todayISO();
  if (!g.docs.length) return null;
  const expired = !!g.validTo && g.validTo < today;
  return (
    <div className={`cz-guar ${expired ? 'warn' : ''}`}>
      🛡️ <b>Garantía ambiental</b>
      <span className="muted"> · {g.docs.length} documento{g.docs.length === 1 ? '' : 's'} (el más reciente del {shortDate(g.docs[0].date)} {g.docs[0].date.slice(0, 4)})</span>
      {g.validTo && <span> · {expired ? 'vigencia vencida el' : 'vigente hasta el'} <b>{shortDate(g.validTo)} {g.validTo.slice(0, 4)}</b>{expired && g.docs[0].date > g.validTo ? <span className="muted"> (hay un documento posterior: puede ser la renovación)</span> : null}</span>}
    </div>
  );
}

/** Warnings read from the documents (in Tareas): a regencia in the wrong bitácora, a closing request not accepted. */
export function FileAlerts({ d }: { d: AppData }) {
  const list = fileAlerts(d.projects);
  // marks the app has that SETENA doesn't show (per project; reviewed in its «🌐 SETENA» tab)
  const only = d.projects.filter(b => !b.archived).map(b => ({ b, n: appOnly(b).length })).filter(x => x.n);
  if (!list.length && !only.length) return null;
  return (
    <section className="tk-sec cz-alerts">
      <h3>⚠️ Revisar en SETENA <span className="tk-n">{list.length + only.length}</span></h3>
      {only.map(({ b, n }) => (
        <div key={`only:${b.id}`} className="tk-row cz-alert">
          <span className="tk-what">🔁 {n} marca{n === 1 ? '' : 's'} en la app que SETENA no tiene (inspección, bitácora o regencia)</span>
          <button type="button" className="tk-proj" title="Ver la comparación con SETENA" onClick={() => openEditor(getData().projects.find(x => x.id === b.id) ?? b, undefined, 'setena' as any)}>
            <b className="mono">{b.code}</b> <span>{b.name}</span>
          </button>
          <span className="tk-date"><small>revisar</small></span>
        </div>
      ))}
      {list.map(a => (
        <div key={`${a.b.id}:${a.kind}:${a.date}`} className="tk-row cz-alert">
          <span className="tk-what">{a.kind === 'misfiled' ? '📂' : '🔒'} {a.text}</span>
          <button type="button" className="tk-proj" title="Abrir el proyecto" onClick={() => openEditor(getData().projects.find(x => x.id === a.b.id) ?? a.b, undefined, 'timeline' as any)}>
            <b className="mono">{a.b.code}</b> <span>{a.b.name}</span>
          </button>
          <span className="tk-date"><small>{shortDate(a.date)} {a.date.slice(0, 4)}</small></span>
        </div>
      ))}
    </section>
  );
}
