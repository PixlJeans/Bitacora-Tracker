// Injected in the «Descargar de SETENA» window. On the bitácora portal (after the user logs in) it shows a
// button; the crawl reads every project (active and closed) and each event: date, text and files.
// The result goes back to the app in chunks through a navigation the app intercepts (no extra permissions).
(function () {
  if (!/(^|\.)setena\.go\.cr$/.test(location.hostname) || window.__btSetena) return;
  window.__btSetena = true;
  const onPortal = location.hostname === 'bitacora.setena.go.cr' && !/login|sso/i.test(location.pathname);
  const MES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
  const parseDate = t => {
    const m = /(\d{1,2})\/([A-Za-zÁÉÍÓÚáéíóúñ]+)\/(\d{4})/.exec(t || '');
    if (!m) return null;
    const mo = MES[m[2].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')];
    return mo ? `${m[3]}-${String(mo).padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
  };
  // the text sometimes comes with its HTML escaped (<p>, &nbsp;): turn it into plain text
  const clean = t => { const d = document.createElement('div'); d.innerHTML = t.replace(/<(br|p|div)[^>]*>/gi, ' $&'); return d.textContent.replace('Ver más', '').replace(/\s+/g, ' ').trim(); };
  const get = async url => new DOMParser().parseFromString(await (await fetch(url, { credentials: 'include' })).text(), 'text/html');
  async function list(tipo) {
    const doc = await get('/BitacoraDigital/CargarBitacorasGrid?tipoConsulta=' + tipo);
    return [...doc.querySelectorAll('tr[onclick]')].map(r => ({
      url: (/location.href = '([^']+)'/.exec(r.getAttribute('onclick')) || [])[1],
      code: r.cells[0].textContent.trim(), name: r.cells[1].textContent.replace(/\s+/g, ' ').trim(), status: r.cells[2].textContent.trim(), closed: tipo === 0
    })).filter(p => p.url);
  }
  // the bitácora page: its entries, plus the header (progress %, people, participation closed)
  async function events(url, p) {
    const doc = await get(url.replace(/&amp;/g, '&'));
    const av = (doc.querySelector('#ex15') || { getAttribute: () => '' }).getAttribute('data-slider-value');
    p.avance = av !== null && av !== '' && !isNaN(+av) ? +av : null;
    const roles = [...doc.querySelectorAll('h6.letraLinea2')].map(h => h.textContent.replace(/\s+/g, ' ').trim());
    p.participationClosed = roles.some(r => /Participaci[oó]n Cerrada/i.test(r));
    p.people = roles.map(r => /^(.+?)\s*\((Activo|Renuncia|Inactivo)[^)]*\)/i.exec(r)).filter(Boolean).map(m => `${m[1]} (${m[2]})`);
    return [...doc.querySelectorAll('li')].filter(l => l.querySelector('.flik-timeline-date')).map(l => {
      const files = new Set();
      l.querySelectorAll('a[href], img[src]').forEach(x => {
        const u = x.getAttribute('href') || x.getAttribute('src') || '';
        if (/\/documents\//i.test(u) && /\.[a-z0-9]{2,5}$/i.test(u)) files.add(new URL(u, location.origin).href);
      });
      const when = l.querySelector('.flik-timeline-date').textContent;
      // «7:45:30 p.m» → seconds of the day (to know which of two entries of the same day came first)
      const tm = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])\.?\s*m/i.exec(when);
      const time = tm ? ((+tm[1] % 12) + (tm[4].toLowerCase() === 'p' ? 12 : 0)) * 3600 + +tm[2] * 60 + +(tm[3] || 0) : null;
      const share = /objeto=(\d+)/.exec(l.innerHTML);
      return {
        date: parseDate(when), time,
        author: ((l.querySelector('.flik-timeline-title') || {}).textContent || '').trim(),
        id: share ? share[1] : null,
        text: clean((l.querySelector('.masTexto') || {}).textContent || ''),
        files: [...files]
      };
    }).filter(e => e.date);
  }
  // ---- sending to the app: chunks through an intercepted navigation, each one acknowledged ----
  let ack = null;
  window.__btAck = i => { if (ack) ack(i); };
  async function send(json) {
    const b64 = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_');
    const size = 24000, n = Math.ceil(b64.length / size), id = Date.now().toString(36);
    for (let i = 0; i < n; i++) {
      for (let tries = 0; ; tries++) {
        const got = new Promise(res => { ack = k => { if (k === i) res(true); }; setTimeout(() => res(false), 3000); });
        location.href = `https://bt-tracker.invalid/c?id=${id}&i=${i}&n=${n}&d=${b64.slice(i * size, (i + 1) * size)}`;
        if (await got) break;
        if (tries > 4) throw new Error('La app no respondió');
      }
      status(`Enviando a la app… ${Math.round((i + 1) / n * 100)}%`);
    }
  }
  // ---- panel ----
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:999999;background:#16a34a;color:#fff;padding:14px 16px;border-radius:14px;font:600 14px system-ui;box-shadow:0 6px 24px rgba(0,0,0,.35);max-width:320px';
  box.innerHTML = '<div style="margin-bottom:8px">🌿 Bitácora Tracker</div><button id="btGo" style="all:unset;cursor:pointer;background:#fff;color:#166534;padding:8px 12px;border-radius:10px">📥 Descargar todo a la app</button><div id="btMsg" style="margin-top:8px;font-weight:400;font-size:12px"></div>';
  const status = t => { box.querySelector('#btMsg').textContent = t; };
  const start = () => {
    if (!document.body || document.getElementById('btBox')) return;
    box.id = 'btBox';
    document.body.appendChild(box);
    if (!onPortal) { box.querySelector('#btGo').style.display = 'none'; status('1. Inicia sesión con tu usuario de SETENA. 2. Cuando veas tus bitácoras, aquí aparece el botón «Descargar todo a la app».'); }
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  box.querySelector('#btGo').onclick = async () => {
    const btn = box.querySelector('#btGo');
    btn.style.display = 'none';
    try {
      status('Leyendo la lista de bitácoras…');
      const projects = [...await list(1), ...await list(0)];
      for (let i = 0; i < projects.length; i++) {
        status(`Leyendo ${projects[i].code} (${i + 1} de ${projects.length})…`);
        try { projects[i].events = await events(projects[i].url, projects[i]); } catch (e) { projects[i].events = []; projects[i].error = String(e); }
      }
      // requests to SETENA (Solicitudes › Ver todas): when each bitácora was approved
      status('Leyendo las solicitudes…');
      let requests = [];
      try {
        const doc = await get('/Expediente/SolicitudesBitacora');
        requests = [...doc.querySelectorAll('tr')].map(r => [...r.cells].map(c => c.textContent.replace(/\s+/g, ' ').trim()))
          .filter(c => c.length >= 5 && /^D\d/.test(c[1])).map(c => ({ code: c[1], state: c[3], date: c[4] }));
      } catch { /* optional */ }
      const files = projects.reduce((s, p) => s + p.events.reduce((t, e) => t + e.files.length, 0), 0);
      await send(JSON.stringify({ projects, requests, readAt: new Date().toISOString() }));
      status(`✓ Listo: ${projects.length} bitácoras y ${files} archivos enviados. La app los descarga y los ordena; puedes cerrar esta ventana.`);
    } catch (e) {
      status('No se pudo: ' + (e.message || e)); btn.style.display = '';
    }
  };
})();
