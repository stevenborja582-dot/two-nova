'use strict';
// Two-Nova en el celular: habla con la PC por /v1 (token propio de este celular).
(() => {
  const $ = (id) => document.getElementById(id);
  const KEY = 'twonova.conn';
  const DEFAULT_PORT = 47810;
  let conn = null; let pollTimer = null; let countdownTimer = null; let status = null; let online = false; let confirmAction = null;

  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
  const save = (c) => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* sin almacenamiento */ } };
  const forget = () => { try { localStorage.removeItem(KEY); } catch { /* */ } };

  function toast(text) { const t = $('toast'); t.textContent = text; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3200); }
  const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null && v !== false) e.setAttribute(k, v === true ? '' : v); } for (const kid of kids.flat()) if (kid != null) e.append(kid); return e; };
  const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`);

  /** "100.64.1.2" o "http://100.64.1.2:47810/" -> "100.64.1.2:47810" */
  function normalizeHost(v) {
    let s = String(v || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    if (!s) return '';
    if (!/:\d{2,5}$/.test(s)) s += `:${DEFAULT_PORT}`;
    return /^[A-Za-z0-9.\-]+:\d{2,5}$/.test(s) ? s : '';
  }

  async function api(method, path, { body, timeout = 8000, token = conn?.token, raw } = {}) {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(`http://${(conn || {}).host || api.host}${path}`, {
        method, signal: ctl.signal,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : raw,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { const e = new Error(data.error || `Error ${res.status}`); e.status = res.status; throw e; }
      return data;
    } catch (e) {
      if (e.status) throw e;
      throw new Error(e.name === 'AbortError' ? 'La PC no respondió a tiempo.' : 'No pude conectarme a la PC. ¿Está encendida, con Two-Nova abierto y con Tailscale (o el mismo WiFi)?');
    } finally { clearTimeout(timer); }
  }

  // ---------- Pantallas ----------
  function show(name) { $('screen-pair').hidden = name !== 'pair'; $('screen-main').hidden = name !== 'main'; }
  function tab(name) {
    for (const b of document.querySelectorAll('.nav [role="tab"]')) { const on = b.dataset.tab === name; b.setAttribute('aria-selected', String(on)); $(`tab-${b.dataset.tab}`).hidden = !on; }
    if (name === 'files') loadFiles();
  }
  document.querySelectorAll('.nav [role="tab"]').forEach((b) => b.addEventListener('click', () => tab(b.dataset.tab)));

  // ---------- Emparejar ----------
  $('code').addEventListener('input', (e) => { const d = e.target.value.replace(/\D/g, '').slice(0, 6); e.target.value = d.length > 3 ? `${d.slice(0, 3)} ${d.slice(3)}` : d; });
  $('pair-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const msg = $('pair-msg'); const set = (t, k) => { msg.textContent = t; msg.className = `msg ${k || ''}`; };
    const host = normalizeHost($('host').value); const code = $('code').value.replace(/\D/g, '');
    if (!host) return set('Escribe la dirección de la PC, por ejemplo 100.64.1.2:47810.', 'bad');
    if (code.length !== 6) return set('El código tiene 6 números.', 'bad');
    $('pair-btn').disabled = true; set('Emparejando…');
    try {
      api.host = host;
      const r = await api('POST', '/v1/pair', { body: { code, name: $('devname').value }, token: null });
      conn = { host, token: r.token, name: r.host }; save(conn);
      set('');
      start();
    } catch (e) { set(e.message, 'bad'); } finally { $('pair-btn').disabled = false; }
  });

  // ---------- Estado ----------
  async function poll() {
    try {
      status = await api('GET', '/v1/status', { timeout: 5000 });
      online = true;
    } catch (e) {
      online = false;
      if (e.status === 401) { forget(); conn = null; clearInterval(pollTimer); show('pair'); $('pair-msg').textContent = 'Este celular ya no está emparejado. Empareja de nuevo.'; $('pair-msg').className = 'msg bad'; return; }
    }
    renderStatus();
  }
  function renderStatus() {
    $('host-name').textContent = status?.host || conn?.name || 'Mi PC';
    const st = $('host-state'); st.className = `state ${online ? 'on' : 'off'}`;
    $('host-state-text').textContent = online ? 'Conectada' : 'Sin conexión con la PC';
    $('set-host').textContent = status?.host || conn?.name || '—'; $('set-addr').textContent = conn?.host || '—'; $('set-version').textContent = status?.version || '—';
    for (const b of document.querySelectorAll('[data-power]')) b.disabled = !online || (status && status.power === false);
    $('power-note').textContent = status && status.power === false ? 'El control de energía está apagado en la PC (Conexiones → Celular).' : 'Apagar y reiniciar esperan 30 segundos: puedes cancelar.';
    const p = status?.pending;
    $('pending').hidden = !p;
    clearInterval(countdownTimer);
    if (p) {
      // Se usa la diferencia entre el reloj de la PC y el del celular: así la cuenta no depende de que coincidan.
      const deadline = Date.now() + Math.max(0, p.at - (status.time || p.at));
      const tick = () => { const left = Math.max(0, Math.round((deadline - Date.now()) / 1000)); $('pending-title').textContent = p.action === 'restart' ? 'Reiniciando la PC' : 'Apagando la PC'; $('pending-sub').textContent = `Faltan unos ${left} segundos.`; };
      tick(); countdownTimer = setInterval(tick, 1000);
    }
  }

  // ---------- Energía ----------
  const TEXTS = {
    lock: ['¿Bloquear la PC?', 'Se bloquea la pantalla. Tendrás que poner la clave en la PC.'],
    sleep: ['¿Suspender la PC?', 'La PC se duerme. Con solo WiFi no podrás despertarla desde aquí.'],
    restart: ['¿Reiniciar la PC?', 'Se reinicia en 30 segundos. Guarda lo que tengas abierto; puedes cancelar desde aquí.'],
    shutdown: ['¿Apagar la PC?', 'Se apaga en 30 segundos. Con solo WiFi no podrás encenderla desde aquí; puedes cancelar a tiempo.'],
  };
  document.querySelectorAll('[data-power]').forEach((b) => b.addEventListener('click', () => ask(b.dataset.power)));
  function ask(action) { confirmAction = action; $('sheet-title').textContent = TEXTS[action][0]; $('sheet-text').textContent = TEXTS[action][1]; $('sheet').hidden = false; $('sheet-yes').focus(); }
  $('sheet-no').addEventListener('click', () => { $('sheet').hidden = true; confirmAction = null; });
  $('sheet-yes').addEventListener('click', async () => {
    const a = confirmAction; $('sheet').hidden = true; confirmAction = null; if (!a) return;
    try { const r = await api('POST', '/v1/power', { body: { action: a } }); toast(r.text || 'Hecho.'); } catch (e) { toast(e.message); }
    poll();
  });
  $('pending-cancel').addEventListener('click', async () => { try { const r = await api('POST', '/v1/power', { body: { action: 'cancel' } }); toast(r.text); } catch (e) { toast(e.message); } poll(); });

  // ---------- Archivos ----------
  $('file-input').addEventListener('change', (e) => { const files = [...e.target.files]; e.target.value = ''; files.forEach(upload); });
  function upload(file) {
    const bar = el('i'); const wrap = el('div', { class: 'bar' }, bar); const sub = el('span', { class: 'sub', text: `${fmtSize(file.size)} · enviando…` });
    const li = el('li', {}, el('div', { class: 'grow' }, el('div', { class: 'name', text: file.name }), sub, wrap)); $('uploads').prepend(li);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `http://${conn.host}/v1/files`);
    xhr.setRequestHeader('authorization', `Bearer ${conn.token}`); xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));
    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) bar.style.width = `${Math.round((ev.loaded / ev.total) * 100)}%`; };
    const fail = (t) => { wrap.classList.add('bad'); sub.textContent = t; };
    xhr.onload = () => { let d = {}; try { d = JSON.parse(xhr.responseText); } catch { /* */ } if (xhr.status === 200) { bar.style.width = '100%'; wrap.classList.add('done'); sub.textContent = `${fmtSize(file.size)} · enviado${d.name && d.name !== file.name ? ` como «${d.name}»` : ''}`; } else fail(d.error || `Error ${xhr.status}`); };
    xhr.onerror = () => fail('Se cortó la conexión con la PC.'); xhr.ontimeout = () => fail('La PC tardó demasiado.');
    xhr.send(file);
  }
  $('text-send').addEventListener('click', async () => {
    const t = $('text-input').value; if (!t.trim()) return toast('Escribe algo primero.');
    try { await api('POST', '/v1/clipboard', { body: { text: t } }); $('text-input').value = ''; toast('Listo: ya está en el portapapeles de la PC.'); } catch (e) { toast(e.message); }
  });
  $('files-refresh').addEventListener('click', loadFiles);
  async function loadFiles() {
    const ul = $('remote-files');
    try {
      const { files } = await api('GET', '/v1/files');
      $('remote-files-note').hidden = files.length > 0;
      ul.replaceChildren(...files.map((f) => el('li', {}, el('div', { class: 'grow' }, el('div', { class: 'name', text: f.name }), el('span', { class: 'sub', text: `${fmtSize(f.size)} · ${f.source}` })),
        el('button', { class: 'btn small', type: 'button', text: 'Bajar', 'aria-label': `Bajar ${f.name}`, onclick: (e) => download(f, e.currentTarget) }))));
    } catch (e) { ul.replaceChildren(); toast(e.message); }
  }
  async function download(f, btn) {
    btn.disabled = true; const old = btn.textContent; btn.textContent = '…';
    try {
      const cap = window.Capacitor; const FS = cap?.Plugins?.Filesystem; const Share = cap?.Plugins?.Share;
      if (cap?.isNativePlatform?.() && FS && Share) {
        // En el celular: se baja a la caché y se abre el menú de compartir (guardar, WhatsApp, Drive…).
        const safe = f.name.replace(/[\\/:*?"<>|]/g, '_');
        const r = await FS.downloadFile({ url: `http://${conn.host}/v1/files/${f.id}`, path: `descargas/${Date.now()}-${safe}`, directory: 'CACHE', recursive: true, headers: { authorization: `Bearer ${conn.token}` } });
        await Share.share({ title: f.name, files: [r.path], dialogTitle: 'Guardar o compartir' });
      } else {
        const res = await fetch(`http://${conn.host}/v1/files/${f.id}`, { headers: { authorization: `Bearer ${conn.token}` } });
        if (!res.ok) throw new Error('No pude bajar el archivo.');
        const url = URL.createObjectURL(await res.blob()); const a = el('a', { href: url, download: f.name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
      }
    } catch (e) { if (!/cancel/i.test(e.message || '')) toast(e.message || 'No pude bajar el archivo.'); } finally { btn.disabled = false; btn.textContent = old; }
  }

  // ---------- Ajustes ----------
  $('forget').addEventListener('click', () => { forget(); conn = null; clearInterval(pollTimer); clearInterval(countdownTimer); show('pair'); });

  function start() {
    show('main'); tab('control'); renderStatus(); poll();
    clearInterval(pollTimer); pollTimer = setInterval(poll, 4000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && conn) poll(); });

  conn = load();
  if (conn?.host && conn?.token) { api.host = conn.host; start(); } else { show('pair'); }
  window.__twonova = { normalizeHost };
})();
