'use strict';
// Ventana de Two-Nova: conversación, personalidades y ajustes.
// Todo el texto entra con textContent (nunca innerHTML).
(() => {
  const $ = (id) => document.getElementById(id);
  const h = (tag, props = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v;
      else if (k === 'style') el.style.cssText = v; // por CSSOM: la política de seguridad bloquea style="" en el HTML
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid);
    return el;
  };
  const api = async (p) => { const r = await p; if (!r?.ok) throw new Error(r?.error || 'Algo salió mal.'); return r.data; };

  let people = []; let activeId = 'compa'; let settings = {}; let voices = [];
  let busy = false;

  function toast(text) {
    const t = $('toast'); t.textContent = text; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2800);
  }
  const showError = (id, msg) => { const e = $(id); e.hidden = !msg; e.textContent = msg || ''; };
  const idx = (id) => Math.max(0, people.findIndex((p) => p.id === id));
  const byId = (id) => people.find((p) => p.id === id) || people[0];

  // ---------- Pestañas ----------
  const tabs = [...document.querySelectorAll('.tabs [role="tab"]')];
  function showView(name) {
    $('toast').hidden = true;
    for (const t of tabs) {
      const on = t.dataset.view === name;
      t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
      $(`view-${t.dataset.view}`).hidden = !on;
    }
    if (name === 'settings') refreshSettings();
    if (name === 'home') refreshHome();
    if (name === 'connections') refreshConnections();
    if (name === 'look') initLook();
  }
  window.addEventListener('click', (e) => { const g = e.target.closest?.('[data-goto]'); if (g) showView(g.dataset.goto); });
  window.nova.onGoto?.((section) => { const map = { connections: 'connections', look: 'look', chat: 'chat', home: 'home', settings: 'settings', people: 'people' }; if (map[section]) showView(map[section]); });
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => showView(t.dataset.view));
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return; e.preventDefault();
      const n = tabs[(i + d + tabs.length) % tabs.length]; n.focus(); showView(n.dataset.view);
    });
  });

  // ---------- Conversación ----------
  function renderChips() {
    const box = $('chips'); box.replaceChildren();
    for (const p of people) {
      const on = p.id === activeId;
      const chip = h('button', { class: 'chip', type: 'button', role: 'radio', 'aria-checked': String(on), tabindex: on ? 0 : -1,
        style: `--c:${p.color}`, title: p.tagline,
        onclick: async () => { try { await api(window.nova.people.setActive(p.id)); activeId = p.id; renderChips(); renderEmpty(); } catch (e) { showError('chat-error', e.message); } },
      }, h('span', { class: 'dot' }), p.name);
      box.append(chip);
    }
    box.onkeydown = (e) => {
      const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!d) return; e.preventDefault();
      const i = idx(activeId); const n = people[(i + d + people.length) % people.length];
      window.nova.people.setActive(n.id).then(() => { activeId = n.id; renderChips(); renderEmpty(); box.querySelector('[aria-checked="true"]').focus(); });
    };
  }

  function renderEmpty() {
    const log = $('log'); if (log.querySelector('.msg')) return;
    const p = byId(activeId);
    log.replaceChildren(h('div', { class: 'empty' }, h('strong', { text: p.greeting || `Hola, soy ${p.name}` }), `Estás hablando con ${p.name}. Escribe abajo para empezar.`));
  }

  function addMsg(kind, text, p) {
    const log = $('log'); log.querySelector('.empty')?.remove();
    const m = h('div', { class: `msg ${kind}`, style: p ? `--c:${p.color}` : null },
      kind === 'bot' ? h('span', { class: 'who', text: p.name }) : null, h('span', { text }));
    log.append(m); m.scrollIntoView({ block: 'end' });
    return m;
  }

  async function send(text) {
    if (busy || !text.trim()) return;
    busy = true; showError('chat-error', '');
    const btn = $('send'); btn.disabled = true; btn.classList.add('busy');
    const p = byId(activeId);
    addMsg('user', text);
    const pending = addMsg('bot pending', 'Pensando…', p);
    $('input').value = ''; autosize();
    try {
      const data = await api(window.nova.chat(text, p.id));
      pending.remove();
      addMsg('bot', data.reply, p);
      if ($('speak-toggle').checked) window.NovaSpeech.speak(data.reply, p, idx(p.id));
    } catch (e) {
      pending.remove(); showError('chat-error', e.message);
    } finally { busy = false; btn.disabled = false; btn.classList.remove('busy'); $('input').focus(); }
  }

  const autosize = () => { const t = $('input'); t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight, 160)}px`; t.style.overflowY = t.scrollHeight > 160 ? 'auto' : 'hidden'; };
  $('input').addEventListener('input', autosize);
  $('input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('chat-form').requestSubmit(); } });
  $('chat-form').addEventListener('submit', (e) => { e.preventDefault(); send($('input').value); });
  $('reset').addEventListener('click', async () => { await window.nova.resetChat(); window.NovaSpeech.stop(); $('log').replaceChildren(); showError('chat-error', ''); renderEmpty(); });
  $('speak-toggle').addEventListener('change', async (e) => {
    if (!e.target.checked) window.NovaSpeech.stop();
    try { settings = await api(window.nova.settings.save({ speakReplies: e.target.checked })); } catch (err) { showError('chat-error', err.message); }
  });

  // ---------- Personalidades ----------
  function voiceLabel(p) {
    const v = window.NovaSpeech.pickVoice(voices, p, idx(p.id));
    return v ? `${v.name} (${v.lang})` : 'No encontré voces en español: se usará la de Windows por defecto.';
  }

  function renderPeople() {
    const box = $('people'); box.replaceChildren();
    for (const p of people) box.append(personCard(p));
  }

  function personCard(p) {
    const draft = { ...p };
    const id = (s) => `${s}-${p.id}`;
    const rateOut = h('output', { text: draft.rate.toFixed(2) });
    const pitchOut = h('output', { text: draft.pitch.toFixed(2) });
    const voiceInfo = h('div', { class: 'voice', text: `Voz: ${voiceLabel(draft)}` });
    const update = () => { voiceInfo.textContent = `Voz: ${voiceLabel(draft)}`; };

    const voiceSel = h('select', { id: id('voice'), onchange: (e) => { draft.voiceName = e.target.value || null; update(); } },
      h('option', { value: '', text: 'Automática (la preferida de esta personalidad)' }),
      voices.filter((v) => /^es/i.test(v.lang)).map((v) => h('option', { value: v.name, text: `${v.name} (${v.lang})`, selected: v.name === draft.voiceName })),
    );
    const err = h('p', { class: 'error', role: 'alert', hidden: true });
    const showErr = (m) => { err.hidden = !m; err.textContent = m || ''; };

    const card = h('article', { class: 'card person', style: `--c:${p.color}` },
      h('header', {}, h('span', { class: 'swatch' }), h('div', {}, h('h3', { text: p.name }), h('small', { text: p.tagline || '' }))),
      h('div', { class: 'field' }, h('label', { for: id('name'), text: 'Nombre' }), h('input', { id: id('name'), type: 'text', maxlength: 30, value: draft.name, oninput: (e) => { draft.name = e.target.value; } })),
      h('div', { class: 'field' }, h('label', { for: id('style'), text: 'Cómo habla (solo tono y estilo)' }), h('textarea', { id: id('style'), rows: 4, maxlength: 600, oninput: (e) => { draft.style = e.target.value; } }, draft.style)),
      h('div', { class: 'field' }, h('label', { for: id('rate') }, 'Velocidad ', rateOut), h('input', { id: id('rate'), type: 'range', min: 0.5, max: 2, step: 0.05, value: draft.rate, oninput: (e) => { draft.rate = +e.target.value; rateOut.textContent = draft.rate.toFixed(2); } })),
      h('div', { class: 'field' }, h('label', { for: id('pitch') }, 'Tono ', pitchOut), h('input', { id: id('pitch'), type: 'range', min: 0.5, max: 2, step: 0.05, value: draft.pitch, oninput: (e) => { draft.pitch = +e.target.value; pitchOut.textContent = draft.pitch.toFixed(2); } })),
      h('div', { class: 'field' }, h('label', { for: id('voice'), text: 'Voz' }), voiceSel, voiceInfo),
      err,
      h('div', { class: 'actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => window.NovaSpeech.speak(draft.greeting || `Hola, soy ${draft.name}.`, draft, idx(p.id)), text: 'Probar voz' }),
        h('button', { class: 'btn btn-primary', type: 'button', text: 'Guardar', onclick: async () => {
          try { showErr(''); people = await api(window.nova.people.save(draft)); toast(`${draft.name} guardada`); renderChips(); renderPeople(); } catch (e) { showErr(e.message); }
        } }),
        p.builtin
          ? h('button', { class: 'btn btn-ghost', type: 'button', text: 'Restaurar', onclick: async () => { try { people = await api(window.nova.people.reset(p.id)); renderChips(); renderPeople(); toast('Restaurada'); } catch (e) { showErr(e.message); } } })
          : h('button', { class: 'btn btn-ghost', type: 'button', text: 'Borrar', onclick: async () => { try { people = await api(window.nova.people.remove(p.id)); if (activeId === p.id) activeId = 'compa'; renderChips(); renderPeople(); } catch (e) { showErr(e.message); } } }),
      ),
    );
    return card;
  }

  $('add-person').addEventListener('click', async () => {
    try {
      showError('people-error', '');
      const data = await api(window.nova.people.create({ name: 'Nueva', style: 'Amable y claro.', color: '#7aa2ff', rate: 1.0, pitch: 0.7 + (people.length % 5) * 0.1, voiceHints: [] }));
      people = data.list; renderChips(); renderPeople();
      document.getElementById(`name-${data.created.id}`)?.focus();
    } catch (e) { showError('people-error', e.message); }
  });

  // ---------- Ajustes ----------
  const HELP = {
    gemini: 'Gemini tiene nivel gratuito. Consigue tu clave gratis en aistudio.google.com/apikey (inicia sesión con tu cuenta de Google y pulsa "Create API key"). En el nivel gratuito Google puede usar lo que escribas para mejorar sus productos: no pongas datos privados.',
    claude: 'Claude cobra por uso: la clave sale de console.anthropic.com y necesita saldo en Plans & Billing (la suscripción de Claude.ai no lo cubre).',
  };
  const HOLDER = { gemini: 'AIza…', claude: 'sk-ant-…' };
  async function showProvider(id) {
    const p = settings.providers?.find((x) => x.id === id) || { model: '' };
    $('provider-help').textContent = HELP[id] || '';
    $('key-input').placeholder = HOLDER[id] || '';
    $('model').value = p.model;
    const key = await api(window.nova.key.status(id));
    const ks = $('key-status');
    ks.className = `status ${key.hasKey ? 'ok' : 'bad'}`;
    ks.textContent = key.hasKey ? `Clave guardada (${key.hint}).` : (key.canEncrypt ? 'Aún no hay clave. Pégala abajo para que Two-Nova pueda conversar.' : 'Este equipo no permite cifrar claves, así que no puedo guardarla.');
  }
  async function refreshSettings() {
    try {
      const s = await api(window.nova.settings.get());
      settings = s.settings;
      $('provider').value = s.settings.provider;
      $('cap').value = s.settings.monthlyTokenCap;
      $('speak-events').checked = !!s.settings.speakEvents; $('speak-toggle').checked = !!s.settings.speakReplies;
      const u = s.usage; const bar = $('usage-bar');
      bar.style.width = `${u.percent}%`; bar.className = u.percent >= 100 ? 'full' : u.percent >= 80 ? 'warn' : '';
      $('usage-text').textContent = `${u.used.toLocaleString('es')} de ${u.cap.toLocaleString('es')} tokens este mes`;
      await showProvider(s.settings.provider);
    } catch (e) { toast(e.message); }
  }
  $('provider').addEventListener('change', () => { showProvider($('provider').value).catch((e) => toast(e.message)); });
  $('key-save').addEventListener('click', async () => {
    const v = $('key-input').value; if (!v.trim()) return;
    try { await api(window.nova.key.set(v, $('provider').value)); $('key-input').value = ''; toast('Clave guardada y cifrada'); showProvider($('provider').value); } catch (e) { toast(e.message); }
  });
  $('key-clear').addEventListener('click', async () => { try { await api(window.nova.key.clear($('provider').value)); toast('Clave eliminada'); showProvider($('provider').value); } catch (e) { toast(e.message); } });
  $('settings-save').addEventListener('click', async () => {
    const m = $('settings-msg');
    try {
      await api(window.nova.settings.save({ provider: $('provider').value, model: $('model').value, monthlyTokenCap: Number($('cap').value), speakEvents: $('speak-events').checked }));
      m.className = 'status ok'; m.textContent = 'Ajustes guardados.'; refreshSettings();
    } catch (e) { m.className = 'status bad'; m.textContent = e.message; }
  });


  // ---------- Inicio y Conexiones ----------
  const card = (cls, ...kids) => h('article', { class: `card info ${cls || ''}` }, ...kids);
  const pill = (text, kind) => h('span', { class: `pill ${kind || ''}`, text });

  async function refreshHome() {
    try {
      const [cc, key, st, th] = await Promise.all([api(window.nova.claudeCode.status()), api(window.nova.key.status()), api(window.nova.stats()), api(window.nova.theme.get())]);
      $('home-hello').textContent = `Hola, ${th.theme.userName}`;
      const p = byId(activeId);
      $('home-cards').replaceChildren(
        card('', h('h2', { text: 'Claude Code' }), pill(cc.connected ? 'Conectada' : 'No conectada', cc.connected ? 'ok' : 'warn'),
          h('p', { class: 'muted', text: cc.connected ? 'La isla te avisa cuando Claude pide permiso o termina.' : 'Conéctala en Conexiones para que la isla la vigile.' })),
        card('', h('h2', { text: 'Cerebro' }), pill(key.hasKey ? 'Clave guardada' : 'Falta la clave', key.hasKey ? 'ok' : 'warn'),
          h('p', { class: 'muted', text: key.hasKey ? 'Two-Nova puede conversar contigo.' : 'Pega tu clave de la API en Ajustes.' })),
        card('', h('h2', { text: 'Personalidad' }), pill(p ? p.name : '—', ''), h('p', { class: 'muted', text: p?.tagline || '' })),
        card('', h('h2', { text: 'Trabajos terminados' }), h('p', { class: 'big', text: String(st.today) }),
          h('p', { class: 'muted', text: `hoy · ${st.tasksDone} en total · racha de ${st.streak} día(s)` })),
      );
    } catch (e) { toast(e.message); }
  }

  const CONNECTORS = [
    { id: 'claude-code', name: 'Claude Code', text: 'Avisos y permisos de lo que hace Claude Code en tu PC.' },
    { id: 'gmail', name: 'Gmail y Calendario', text: 'Leer y resumir correos, y ver tus eventos. Nunca envía sin tu clic.' },
    { id: 'spotify', name: 'Spotify', text: 'Ver qué suena y controlar la reproducción (requiere Premium).' },
    { id: 'github', name: 'GitHub y VS Code', text: 'Ver tus repositorios y abrir proyectos en el editor.' },
    { id: 'classroom', name: 'Google Classroom', text: 'Ver tareas y fechas de entrega.' },
    { id: 'files', name: 'Chrome y archivos', text: 'Abrir páginas y carpetas que tú permitas.' },
    { id: 'bingx', name: 'BingX (solo lectura)', text: 'Consultar saldos y precios. No opera ni da consejos de inversión.' },
  ];

  // ---------- Celular (control remoto) ----------
  let phoneTimer = null;
  const fmtDate = (t) => (t ? new Date(t).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
  async function refreshPhone() {
    const box = $('phone-card');
    let r;
    try { r = await api(window.nova.remote.status()); } catch (e) { box.replaceChildren(h('p', { class: 'status bad', text: e.message })); return; }
    const act = async (fn, okMsg) => { try { await api(fn()); if (okMsg) toast(okMsg); } catch (e) { toast(e.message); } refreshPhone(); };
    const ts = r.addresses.find((a) => a.tailscale);
    const kids = [
      h('div', { class: 'row between' }, h('h2', { text: 'Celular: control remoto' }), pill(r.running ? 'Activo' : 'Apagado', r.running ? 'ok' : '')),
      h('p', { class: 'muted', text: 'Desde tu celular puedes bloquear, suspender, reiniciar o apagar la PC (con 30 segundos para cancelar), y mandar archivos y texto en los dos sentidos. Está apagado hasta que lo actives, solo acepta tu red y Tailscale, y cada celular se empareja con un código.' }),
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', id: 'remote-enable', checked: r.enabled, onchange: (e) => act(() => window.nova.remote.enable(e.target.checked), e.target.checked ? 'Control remoto activado' : 'Control remoto apagado') }), h('span', { text: 'Activar el control remoto' })),
    ];
    if (r.running) {
      kids.push(
        h('div', { class: 'phone-addr' },
          h('p', { class: 'muted', text: 'En la app del celular escribe esta dirección:' }),
          ...(r.addresses.length ? r.addresses.map((a) => h('p', { class: 'addr' }, h('code', { text: `${a.ip}:${r.port}` }), h('span', { class: 'muted', text: ` · ${a.label}` }))) : [h('p', { class: 'status bad', text: 'No encuentro ninguna red activa.' })]),
          ts ? null : h('p', { class: 'muted', text: 'Para controlar la PC desde fuera de casa instala Tailscale (gratis, tailscale.com/download) en la PC y en el celular, con la misma cuenta. Aparecerá aquí una dirección 100.x.x.x.' }),
        ),
        r.pairing
          ? h('div', { class: 'pair-box' }, h('p', { class: 'muted', text: 'Escribe este código en el celular. Vale 5 minutos y se anula tras 5 errores.' }), h('p', { class: 'pair-code', id: 'pair-code', text: r.pairing.code.replace(/(\d{3})(\d{3})/, '$1 $2') }),
              h('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancelar', onclick: () => act(() => window.nova.remote.cancelPair()) }))
          : h('div', { class: 'row' }, h('button', { class: 'btn btn-primary', id: 'remote-pair', type: 'button', text: 'Emparejar un celular', onclick: () => act(() => window.nova.remote.pair()) })),
        h('h3', { text: 'Celulares emparejados' }),
        r.devices.length
          ? h('ul', { class: 'devices' }, r.devices.map((d) => h('li', {}, h('span', { class: 'grow' }, h('strong', { text: d.name }), h('span', { class: 'muted', text: ` · última vez ${fmtDate(d.lastSeen)}` })),
              h('button', { class: 'btn btn-ghost', type: 'button', 'aria-label': `Quitar ${d.name}`, text: 'Quitar', onclick: () => act(() => window.nova.remote.revoke(d.id), 'Celular quitado') }))))
          : h('p', { class: 'muted', text: 'Ninguno todavía.' }),
        h('h3', { text: 'Qué puede hacer el celular' }),
        h('label', { class: 'switch' }, h('input', { type: 'checkbox', id: 'remote-power', checked: r.power, onchange: (e) => act(() => window.nova.remote.perms({ power: e.target.checked })) }), h('span', { text: 'Bloquear, suspender, reiniciar y apagar la PC' })),
        h('label', { class: 'switch' }, h('input', { type: 'checkbox', id: 'remote-files', checked: r.files, onchange: (e) => act(() => window.nova.remote.perms({ files: e.target.checked })) }), h('span', { text: 'Mandar y recibir archivos y texto' })),
        h('div', { class: 'row' },
          h('button', { class: 'btn', type: 'button', text: 'Abrir carpeta de lo recibido', onclick: () => act(() => window.nova.remote.folder('inbox')) }),
          h('button', { class: 'btn', type: 'button', text: 'Abrir carpeta "Para el cel"', onclick: () => act(() => window.nova.remote.folder('outbox')) })),
        h('p', { class: 'muted', text: 'Para mandar algo al celular, ponlo en la carpeta "Para el cel" o en la bandeja de la isla. Si Windows pregunta por el firewall al activar esto, permite las redes privadas.' }),
        h('p', { class: 'muted', text: 'Encender la PC a distancia: con solo WiFi no es fiable. Lo más seguro es un enchufe inteligente con "Restaurar tras corte de luz = Encender" en el BIOS (te explico cuando quieras).' }),
      );
    }
    box.replaceChildren(...kids);
  }

  async function refreshConnections() {
    refreshPhone();
    clearInterval(phoneTimer);
    phoneTimer = setInterval(() => { if ($('view-connections').hidden) { clearInterval(phoneTimer); return; } if (!document.activeElement?.closest?.('#phone-card')) refreshPhone(); }, 3000);
    const box = $('connections');
    let cc = { connected: false };
    try { cc = await api(window.nova.claudeCode.status()); } catch (e) { toast(e.message); }
    box.replaceChildren(...CONNECTORS.map((c) => {
      if (c.id === 'claude-code') {
        return card('', h('h2', { text: c.name }), pill(cc.connected ? 'Conectada' : 'No conectada', cc.connected ? 'ok' : 'warn'), h('p', { class: 'muted', text: c.text }),
          h('div', { class: 'row' },
            cc.connected
              ? h('button', { class: 'btn', type: 'button', text: 'Desconectar', onclick: async () => { await window.nova.claudeCode.disconnect(); refreshConnections(); } })
              : h('button', { class: 'btn btn-primary', type: 'button', text: 'Conectar', onclick: async () => { await window.nova.claudeCode.connect(); refreshConnections(); } })));
      }
      return card('soon', h('h2', { text: c.name }), pill('Próximamente', ''), h('p', { class: 'muted', text: c.text }),
        h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', disabled: true, text: 'Conectar' })));
    }));
  }

  // ---------- Apariencia (editor con vista previa en vivo) ----------
  const PRESETS = [
    { name: 'Nova', t: { accent: '#8fb0ff', bg: '#0b0d12', eyeColor: '', eyeStyle: 'ovalo', shape: 'suave' } },
    { name: 'Medianoche', t: { accent: '#b69cff', bg: '#0a0614', eyeColor: '', eyeStyle: 'redondo', shape: 'pildora' } },
    { name: 'Bosque', t: { accent: '#6fdc8c', bg: '#07120c', eyeColor: '', eyeStyle: 'ovalo', shape: 'suave' } },
    { name: 'Atardecer', t: { accent: '#ff9f5a', bg: '#140a07', eyeColor: '#ffd08a', eyeStyle: 'gato', shape: 'suave' } },
    { name: 'Mono', t: { accent: '#e8e8e8', bg: '#000000', eyeColor: '', eyeStyle: 'rendija', shape: 'recto' } },
  ];
  const EYE_LABEL = { ovalo: 'Óvalo', redondo: 'Redondo', rendija: 'Rendija', gato: 'Gato' };
  const SHAPE_LABEL = { pildora: 'Píldora', suave: 'Suave', recto: 'Recto' };
  const OPEN_LABEL = { hover: 'Al pasar el mouse', click: 'Al hacer clic' };
  const MOTION_LABEL = { elastica: 'Elástica (rebota)', suave: 'Suave', rapida: 'Rápida' };
  const IDLEANIM_LABEL = { respirar: 'Respirar', parpadeo: 'Solo parpadeo', mirar: 'Mirar a los lados', flotar: 'Flotar', latido: 'Latido', nada: 'Quieta' };
  const IDLELABEL_LABEL = { hora: 'La hora', estado: '"En reposo"', saludo: 'Un saludo', texto: 'Mi propio texto', nada: 'Nada, solo los ojos' };
  let look = null; let lookSaved = null; let previewReady = false; let lookInit = false; let previewMode = 'expanded';

  const post = (msg) => { try { $('preview').contentWindow.postMessage(msg, '*'); } catch { /* */ } };
  window.addEventListener('message', (e) => { if (e.source === $('preview').contentWindow && e.data?.type === 'ready') { previewReady = true; if (look) { post({ type: 'theme', theme: look }); post({ type: 'mode', mode: previewMode }); } } });

  function lookMsg(text, kind) { const m = $('look-msg'); m.textContent = text || ''; m.className = `status ${kind || ''}`; }
  function pushLook() {
    try {
      const clean = window.NovaTheme.sanitizeTheme(look);
      lookMsg(JSON.stringify(clean) === JSON.stringify(window.NovaTheme.sanitizeTheme(lookSaved)) ? '' : 'Tienes cambios sin guardar.', '');
      $('look-save').disabled = false;
      if (previewReady) post({ type: 'theme', theme: clean });
    } catch (e) { lookMsg(e.message, 'bad'); $('look-save').disabled = true; }
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function fillLook() {
    $('f-accent').value = look.accent; $('f-accent-hex').value = look.accent;
    $('f-bg').value = look.bg; $('f-bg-hex').value = look.bg;
    $('f-eye').value = look.eyeColor || look.accent;
    $('f-eyestyle').value = look.eyeStyle; $('f-shape').value = look.shape;
    for (const [id, key, fmt] of [['scale', 'scale', (v) => `${Math.round(v * 100)}%`], ['opacity', 'opacity', (v) => `${Math.round(v * 100)}%`], ['offset', 'offsetY', (v) => `${v}px`], ['glowstr', 'glowStrength', (v) => `${Math.round(v * 100)}%`]]) {
      $(`f-${id}`).value = look[key]; $(`o-${id}`).textContent = fmt(look[key]);
    }
    $('f-glow').checked = look.glow; $('f-seconds').checked = look.clockSeconds; $('f-anim').checked = look.animations; $('f-blur').checked = look.collapseOnBlur;
    $('f-name').value = look.userName;
    $('f-open').value = look.openMode; $('f-motion').value = look.motion; $('f-idleanim').value = look.idleAnim; $('f-idlelabel').value = look.idleLabel;
    $('f-idletext').value = look.idleText; $('f-idletext-wrap').hidden = look.idleLabel !== 'texto';
    renderDockEditor();
  }

  function renderDockEditor() {
    const all = Object.keys(window.NovaTheme.PAGES);
    const order = [...look.dock, ...all.filter((p) => !look.dock.includes(p))];
    const ul = $('dock-editor'); ul.replaceChildren();
    order.forEach((id) => {
      const on = look.dock.includes(id); const meta = window.NovaTheme.PAGES[id];
      const move = (d) => { const i = look.dock.indexOf(id); const j = i + d; if (i < 0 || j < 0 || j >= look.dock.length) return; const a = look.dock.slice(); [a[i], a[j]] = [a[j], a[i]]; look = { ...look, dock: a }; renderDockEditor(); pushLook(); };
      ul.append(h('li', { style: `--c:${meta.color}` },
        h('label', { class: 'switch grow' }, h('input', { type: 'checkbox', checked: on, 'aria-label': `Mostrar ${meta.label}`, onchange: (e) => {
          const next = e.target.checked ? [...look.dock, id] : look.dock.filter((p) => p !== id);
          look = { ...look, dock: next }; renderDockEditor(); pushLook(); } }), h('span', { class: 'dot' }), h('span', { text: meta.label })),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', disabled: !on || look.dock.indexOf(id) === 0, 'aria-label': `Subir ${meta.label}`, text: '↑', onclick: () => move(-1) }),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', disabled: !on || look.dock.indexOf(id) === look.dock.length - 1, 'aria-label': `Bajar ${meta.label}`, text: '↓', onclick: () => move(1) })));
    });
  }

  function bindLook() {
    for (const e of window.NovaTheme.EYES) $('f-eyestyle').append(h('option', { value: e, text: EYE_LABEL[e] }));
    for (const e of window.NovaTheme.SHAPES) $('f-shape').append(h('option', { value: e, text: SHAPE_LABEL[e] }));
    const fillSelect = (id, labels, values) => { for (const v of values) $(id).append(h('option', { value: v, text: labels[v] })); };
    fillSelect('f-open', OPEN_LABEL, window.NovaTheme.OPEN_MODES); fillSelect('f-motion', MOTION_LABEL, window.NovaTheme.MOTIONS);
    fillSelect('f-idleanim', IDLEANIM_LABEL, window.NovaTheme.IDLE_ANIMS); fillSelect('f-idlelabel', IDLELABEL_LABEL, window.NovaTheme.IDLE_LABELS);
    const set = (patch) => { look = { ...look, ...patch }; pushLook(); };
    $('f-open').addEventListener('change', (e) => set({ openMode: e.target.value }));
    $('f-motion').addEventListener('change', (e) => set({ motion: e.target.value }));
    $('f-idleanim').addEventListener('change', (e) => set({ idleAnim: e.target.value }));
    $('f-idlelabel').addEventListener('change', (e) => { $('f-idletext-wrap').hidden = e.target.value !== 'texto'; set({ idleLabel: e.target.value }); });
    $('f-idletext').addEventListener('input', (e) => set({ idleText: e.target.value }));
    const color = (colorId, hexId, key) => {
      $(colorId).addEventListener('input', (e) => { $(hexId).value = e.target.value; set({ [key]: e.target.value }); });
      $(hexId).addEventListener('input', (e) => { const v = e.target.value.trim(); if (/^#[0-9a-f]{6}$/i.test(v)) { $(colorId).value = v; set({ [key]: v }); } else lookMsg('Escribe el color como #aabbcc.', 'bad'); });
    };
    color('f-accent', 'f-accent-hex', 'accent'); color('f-bg', 'f-bg-hex', 'bg');
    $('f-eye').addEventListener('input', (e) => set({ eyeColor: e.target.value }));
    $('f-eye-auto').addEventListener('click', () => { $('f-eye').value = look.accent; set({ eyeColor: '' }); });
    $('f-eyestyle').addEventListener('change', (e) => set({ eyeStyle: e.target.value }));
    $('f-shape').addEventListener('change', (e) => set({ shape: e.target.value }));
    const range = (id, key, outId, fmt) => $(id).addEventListener('input', (e) => { const v = Number(e.target.value); $(outId).textContent = fmt(v); set({ [key]: v }); });
    range('f-scale', 'scale', 'o-scale', (v) => `${Math.round(v * 100)}%`); range('f-opacity', 'opacity', 'o-opacity', (v) => `${Math.round(v * 100)}%`);
    range('f-offset', 'offsetY', 'o-offset', (v) => `${v}px`); range('f-glowstr', 'glowStrength', 'o-glowstr', (v) => `${Math.round(v * 100)}%`);
    $('f-glow').addEventListener('change', (e) => set({ glow: e.target.checked }));
    $('f-seconds').addEventListener('change', (e) => set({ clockSeconds: e.target.checked }));
    $('f-anim').addEventListener('change', (e) => set({ animations: e.target.checked }));
    $('f-blur').addEventListener('change', (e) => set({ collapseOnBlur: e.target.checked }));
    $('f-name').addEventListener('input', (e) => set({ userName: e.target.value }));

    const box = $('presets');
    for (const p of PRESETS) box.append(h('button', { class: 'preset', type: 'button', style: `--a:${p.t.accent};--b:${p.t.bg}`, onclick: () => { look = { ...look, ...p.t }; fillLook(); pushLook(); } }, h('span', { class: 'sw' }), p.name));

    const modes = [['expanded', 'Abierta'], ['idle', 'Reposo'], ['working', 'Trabajando'], ['permission', 'Permiso'], ['done', 'Terminó']];
    const mbox = $('preview-modes');
    const FRAME_W = 800; const heights = { expanded: 500, permission: 300, working: 150, idle: 150, done: 180 };
    const fit = () => {
      const box = $('preview').parentElement; const scale = Math.min(1, box.clientWidth / FRAME_W) || 1;
      const h = heights[previewMode] || 150;
      $('preview').style.width = `${FRAME_W}px`; $('preview').style.height = `${h}px`;
      $('preview').style.transform = `scale(${scale})`; box.style.height = `${Math.round(h * scale)}px`;
    };
    const sizeFrame = () => fit();
    new ResizeObserver(fit).observe($('preview').parentElement);
    for (const [m, label] of modes) mbox.append(h('button', { type: 'button', 'aria-pressed': String(m === previewMode), text: label, onclick: (e) => {
      previewMode = m; for (const b of mbox.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); sizeFrame(); post({ type: 'mode', mode: m }); } }));
    sizeFrame();

    $('look-save').addEventListener('click', async () => {
      try { const clean = await api(window.nova.theme.save(look)); look = clean; lookSaved = clean; fillLook(); lookMsg('Guardado. Ya se ve en tu isla.', 'ok'); toast('Apariencia guardada'); }
      catch (e) { lookMsg(e.message, 'bad'); }
    });
    $('look-reset').addEventListener('click', async () => {
      try { const clean = await api(window.nova.theme.reset()); look = clean; lookSaved = clean; fillLook(); pushLook(); lookMsg('Volvió a lo original.', 'ok'); }
      catch (e) { lookMsg(e.message, 'bad'); }
    });
  }

  async function initLook() {
    try {
      const data = await api(window.nova.theme.get());
      if (!lookInit) { lookInit = true; look = data.theme; lookSaved = data.theme; bindLook(); }
      else if (same(look, lookSaved)) { look = data.theme; lookSaved = data.theme; }
      fillLook(); pushLook();
      if (previewReady) post({ type: 'mode', mode: previewMode });
    } catch (e) { lookMsg(e.message, 'bad'); }
  }

  // ---------- Arranque ----------
  (async () => {
    try {
      voices = await window.NovaSpeech.loadVoices();
      const es = voices.filter((v) => /^es/i.test(v.lang));
      $('voices-info').textContent = es.length
        ? `${es.length} voz(es) en español: ${es.map((v) => v.name.replace(/^Microsoft /, '')).join(', ')}.`
        : 'No encontré voces en español. En Windows: Configuración → Hora e idioma → Voz → Agregar voces.';
      people = await api(window.nova.people.list());
      activeId = people.find((p) => p.active)?.id || 'compa';
      const s = await api(window.nova.settings.get()); settings = s.settings;
      $('speak-toggle').checked = !!settings.speakReplies;
      renderChips(); renderPeople(); renderEmpty(); autosize(); refreshHome();
    } catch (e) { showError('chat-error', e.message); }
  })();
})();
