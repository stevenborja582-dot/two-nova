'use strict';
// La isla completa (cabecera, permisos, avisos y dashboard con apps).
// La usan la ventana de la isla y la vista previa de Apariencia: por eso recibe un "api" y no toca Electron.
// Todo el texto entra con textContent (nunca innerHTML).
(function (root) {
  const NS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    home: ['M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z'],
    claude: ['M4 6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z', 'M8 10l3 2-3 2', 'M13 15h4'],
    music: ['M9 18V6l10-2v12', 'M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z', 'M19 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'],
    notes: ['M6 3h9l4 4v14H6z', 'M14 3v5h5', 'M9 13h7', 'M9 17h5'],
    agenda: ['M5 5h14v15H5z', 'M5 10h14', 'M9 3v4', 'M15 3v4'],
    tray: ['M4 13l2-8h12l2 8v6H4z', 'M4 13h5a3 3 0 0 0 6 0h5'],
    clipboard: ['M9 4h6v3H9z', 'M7 5H5v16h14V5h-2', 'M9 12h6', 'M9 16h4'],
    sliders: ['M4 7h10', 'M18 7h2', 'M4 17h2', 'M10 17h10', 'M14 4v6', 'M6 14v6'],
    close: ['M6 6l12 12', 'M18 6L6 18'],
    plus: ['M12 5v14', 'M5 12h14'],
    prev: ['M5 5v14', 'M7 12l10-7v14z'], play: ['M7 4l13 8-13 8z'], next: ['M19 5v14', 'M17 12L7 5v14z'],
  };
  const icon = (name) => {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'ic'); s.setAttribute('aria-hidden', 'true');
    for (const d of ICONS[name] || []) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.append(p); }
    return s;
  };
  const h = (tag, props = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid);
    return el;
  };

  const RISK = { low: 'Riesgo bajo', medium: 'Riesgo medio', high: 'Riesgo alto', unknown: 'Sin clasificar' };
  const STATE_LABEL = { idle: 'Reposo', working: 'Trabajando', waiting: 'Esperando', done: 'Terminó', error: 'Error', ended: 'Cerrada' };
  const DONE_VISIBLE_MS = 9000;
  const base = (p) => (p || '').split(/[\\/]/).filter(Boolean).pop() || '';
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hhmm = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : b ? `${b} B` : '');
  const T = () => root.NovaTheme;

  function mount(host, api, opts = {}) {
    const preview = !!opts.preview;
    let view = { state: 'idle', pending: [], sessions: [], latest: null, connected: false };
    let theme = T().sanitizeTheme({});
    let notice = null; let noticeTimer = null;
    let expanded = !!opts.expanded; let page = opts.page || 'home';
    let stats = { tasksDone: 0, today: 0, streak: 0, recent: [] };
    let current = null; let lastVisible = null;
    let pinned = false; let over = false; let hoverOpenT = null; let hoverCloseT = null; let shown = false; let leaveTimer = null;
    const hoverMode = () => theme.openMode === 'hover';
    const animOn = () => theme.animations !== false && !matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ---------- Esqueleto ----------
    const els = {};
    const root_ = h('section', { class: 'island', 'data-state': 'idle', 'data-expanded': 'false', 'aria-label': 'Two-Nova: estado de Claude Code' });
    els.head = h('button', { class: 'head', type: 'button', 'aria-expanded': 'false' },
      h('span', { class: 'eyes', 'aria-hidden': 'true' }, h('i', { class: 'eye' }), h('i', { class: 'eye' })),
      h('span', { class: 'label' }, els.title = h('span', { class: 'title', text: 'En reposo' }), els.detail = h('span', { class: 'detail' })),
      els.badge = h('span', { class: 'badge', hidden: true }));
    els.progress = h('div', { class: 'progress', 'aria-hidden': 'true' }, h('i'));
    els.permTool = h('span', { class: 'chip' }); els.permRisk = h('span', { class: 'chip risk' });
    els.permCount = h('span', { class: 'chip', hidden: true }); els.permProject = h('span', { class: 'project' });
    els.permCmd = h('pre', { class: 'cmd', tabindex: '0' });
    els.deny = h('button', { class: 'btn btn-secondary btn-deny', type: 'button' }, 'Negar ', h('kbd', { text: 'Ctrl+Alt+N' }));
    els.allow = h('button', { class: 'btn btn-primary btn-allow', type: 'button' }, 'Permitir ', h('kbd', { text: 'Ctrl+Alt+Y' }));
    els.permission = h('div', { class: 'permission', role: 'alertdialog', 'aria-labelledby': 'isl-title', hidden: true },
      h('div', { class: 'perm-meta' }, els.permCount, els.permTool, els.permRisk, els.permProject), els.permCmd,
      h('div', { class: 'actions' }, els.deny, els.allow),
      h('p', { class: 'hint', text: 'Si no respondes, Claude Code te lo preguntará en su terminal como siempre.' }));
    els.title.id = 'isl-title';
    els.noticeText = h('p', { class: 'notice-text' });
    els.noticeClose = h('button', { class: 'btn btn-secondary btn-small notice-close', type: 'button', text: 'Entendido' });
    els.notice = h('div', { class: 'notice', hidden: true }, els.noticeText, els.noticeClose);
    els.date = h('span', { class: 'date' }); els.battery = h('span', { class: 'battery', hidden: true });
    els.openPanel = h('button', { class: 'tiny open-panel', type: 'button', title: 'Abrir Two-Nova (ajustes y chat)', 'aria-label': 'Abrir Two-Nova: ajustes y chat' }, icon('sliders'));
    els.collapse = h('button', { class: 'tiny collapse', type: 'button', title: 'Cerrar', 'aria-label': 'Cerrar la isla' }, icon('close'));
    els.page = h('div', { class: 'page', role: 'tabpanel' });
    els.dock = h('nav', { class: 'dock', role: 'tablist', 'aria-label': 'Apps de la isla' });
    els.dash = h('div', { class: 'dash', hidden: true },
      h('div', { class: 'dash-top' }, els.date, els.battery, h('span', { class: 'sp' }), els.openPanel, els.collapse), els.page, els.dock);
    els.live = h('div', { class: 'sr-only', 'aria-live': 'polite' });
    root_.append(els.head, els.progress, els.permission, els.notice, els.dash, els.live);
    host.replaceChildren(root_);

    // ---------- Estado efectivo ----------
    const effective = () => (view.pending.length ? 'permission' : notice ? notice.kind : view.state === 'working' ? 'working' : 'idle');
    const dashVisible = () => expanded && effective() !== 'permission';

    // Lo que dice la pastilla cuando no pasa nada (se elige en Apariencia).
    function idleText() {
      switch (theme.idleLabel) {
        case 'hora': { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
        case 'saludo': return `Hola, ${theme.userName}`;
        case 'texto': return theme.idleText || 'Two-Nova';
        case 'nada': return '';
        default: return 'En reposo';
      }
    }
    // Abre y cierra el tablero; al cerrar, primero se desvanece y después se encoge.
    function finishLeave() { clearTimeout(leaveTimer); leaveTimer = null; shown = false; delete els.dash.dataset.leaving; root_.dataset.expanded = 'false'; els.dash.hidden = true; }
    function applyExpanded(vis, immediate) {
      if (vis) {
        clearTimeout(leaveTimer); leaveTimer = null; delete els.dash.dataset.leaving;
        shown = true; root_.dataset.expanded = 'true'; els.dash.hidden = false;
      } else if (shown) {
        if (immediate || !animOn()) finishLeave();
        else if (!leaveTimer) { els.dash.dataset.leaving = 'true'; leaveTimer = setTimeout(finishLeave, 170); }
      } else { root_.dataset.expanded = 'false'; els.dash.hidden = true; }
    }
    const setOpen = (v, pin) => { expanded = !!v; pinned = v ? !!pin : false; render(); };

    function render() {
      const state = effective(); const cur = view.pending[0]; const vis = dashVisible();
      root_.dataset.state = state;
      applyExpanded(vis, state === 'permission');
      els.permission.hidden = state !== 'permission';
      els.notice.hidden = !(state === 'done' || state === 'attention');
      els.head.setAttribute('aria-expanded', String(vis));
      els.head.disabled = state === 'permission';
      if (state === 'permission' && cur) {
        els.title.textContent = 'Claude pide permiso'; els.detail.textContent = '';
        els.permTool.textContent = cur.toolName; els.permRisk.textContent = RISK[cur.risk] || RISK.unknown;
        els.permRisk.dataset.risk = cur.risk || 'unknown';
        els.permProject.textContent = base(view.sessions.find((s) => s.id === cur.sessionId)?.cwd);
        els.permCmd.textContent = cur.summary || '(sin detalle)';
        const n = view.pending.length; els.permCount.hidden = n < 2; els.permCount.textContent = `1 de ${n}`;
        els.badge.hidden = n < 2; els.badge.textContent = String(n);
      } else {
        els.badge.hidden = true;
        els.title.textContent = { idle: idleText(), working: 'Trabajando…', done: 'Terminó', attention: 'Te necesita' }[state] || idleText();
        els.detail.textContent = state === 'working' ? (view.latest?.lastMessage || '') : '';
      }
      root_.dataset.nolabel = String(state === 'idle' && theme.idleLabel === 'nada');
      if (notice) els.noticeText.textContent = notice.text;
      if (vis !== lastVisible) { lastVisible = vis; if (!preview) api.setExpanded?.(vis); if (vis) { refreshStats(); showPage(page, true); } else destroyPage(); }
      else if (vis) current?.update?.();
    }

    // ---------- Dock y páginas ----------
    function renderDock() {
      els.dock.replaceChildren();
      for (const id of theme.dock) {
        const meta = T().PAGES[id];
        const b = h('button', { type: 'button', role: 'tab', 'aria-selected': String(id === page), tabindex: id === page ? '0' : '-1', 'aria-label': meta.label, title: meta.label, 'data-page': id,
          onclick: () => showPage(id) }, icon(id), h('span', { text: meta.label }));
        els.dock.append(b);
      }
    }
    els.dock.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!d) return; e.preventDefault();
      const i = theme.dock.indexOf(page); const next = theme.dock[(i + d + theme.dock.length) % theme.dock.length];
      showPage(next); els.dock.querySelector(`[data-page="${next}"]`)?.focus();
    });

    function destroyPage() { current?.destroy?.(); current = null; els.page.replaceChildren(); }
    function showPage(id, force) {
      if (!theme.dock.includes(id)) id = theme.dock[0];
      if (!force && id === page && current) return;
      page = id; destroyPage();
      root_.style.setProperty('--page-c', T().PAGES[id].color);
      renderDock();
      const build = PAGES[id] || PAGES.home;
      current = build(ctx);
      els.page.replaceChildren(current.el);
      els.page.setAttribute('aria-label', T().PAGES[id].label);
    }

    async function refreshStats() { try { const s = await api.stats?.(); if (s) { stats = s; current?.update?.(); } } catch { /* sin datos */ } }

    const ctx = {
      api, preview, h, icon, fmtSize, ymd, hhmm, base, pad,
      get view() { return view; }, get theme() { return theme; }, get stats() { return stats; },
      openPanel: (section) => api.openPanel?.(section), goto: (p) => showPage(p),
    };

    // ---------- Páginas ----------
    const PAGES = {
      home(c) {
        const clock = h('p', { class: 'clock' }); const date = h('p', { class: 'muted', style: 'margin:4px 0 0' });
        const hello = h('p', { class: 'muted', style: 'margin:0 0 4px' });
        const tClaude = h('button', { class: 'tile', type: 'button', onclick: () => (c.view.connected ? c.goto('claude') : c.openPanel('connections')) }, h('strong'), h('span'));
        const tMusic = h('button', { class: 'tile', type: 'button', onclick: () => c.goto('music') }, h('strong', { text: 'Nada sonando' }), h('span', { text: 'Spotify: próximamente' }));
        const tTasks = h('button', { class: 'tile', type: 'button', onclick: () => c.goto('claude') }, h('strong'), h('span'));
        const el = h('div', {}, hello, clock, date, h('div', { class: 'tiles' }, tClaude, tMusic, tTasks));
        const tick = () => {
          const d = new Date(); const hr = d.getHours();
          hello.textContent = `${hr < 12 ? 'Buenos días' : hr < 19 ? 'Buenas tardes' : 'Buenas noches'}, ${c.theme.userName}`;
          clock.replaceChildren(`${pad(hr)}:${pad(d.getMinutes())}`, ...(c.theme.clockSeconds ? [h('small', { text: `:${pad(d.getSeconds())}` })] : []));
          date.textContent = d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
        };
        const update = () => {
          const v = c.view; const first = tClaude.children;
          if (!v.connected) { first[0].textContent = 'Conectar Claude Code'; first[1].textContent = 'en Ajustes'; }
          else if (v.state === 'working') { first[0].textContent = 'Trabajando'; first[1].textContent = c.base(v.latest?.cwd) || 'Claude Code'; }
          else { first[0].textContent = 'En reposo'; first[1].textContent = `${v.sessions.length} sesión(es)`; }
          tTasks.children[0].textContent = `${c.stats.today} hoy`;
          tTasks.children[1].textContent = `${c.stats.tasksDone} en total · racha ${c.stats.streak}`;
          tick();
        };
        const timer = setInterval(tick, 1000); update();
        return { el, update, destroy: () => clearInterval(timer) };
      },

      claude(c) {
        const cta = h('div', { class: 'card cta', hidden: true }, h('p', { text: 'Conecta Claude Code para ver aquí lo que hace.' }),
          h('button', { class: 'btn btn-primary btn-small', type: 'button', text: 'Conectar', onclick: () => c.openPanel('connections') }));
        const sessions = h('ul', { class: 'list' }); const done = h('ul', { class: 'list' });
        const el = h('div', {}, h('div', { class: 'p-head' }, h('h3', { text: 'Claude Code' })), cta,
          sessions, h('div', { class: 'p-head', style: 'margin-top:16px' }, h('h3', { text: 'Terminadas hace poco' })), done);
        const update = () => {
          cta.hidden = !!c.view.connected;
          sessions.replaceChildren(...(c.view.sessions.length ? c.view.sessions.map((s) => h('li', {},
            h('div', { class: 'grow' }, h('div', { class: 't', text: c.base(s.cwd) || 'Sesión' }), s.lastMessage ? h('div', { class: 's', text: s.lastMessage }) : null),
            h('span', { class: 'st', 'data-s': s.status, text: STATE_LABEL[s.status] || s.status }))) : [h('li', { class: 'empty', text: 'Todavía no hay actividad.' })]));
          done.replaceChildren(...(c.stats.recent.length ? c.stats.recent.slice(0, 6).map((r) => h('li', {},
            h('div', { class: 'grow' }, h('div', { class: 't', text: c.base(r.cwd) || 'Sesión' }), h('div', { class: 's', text: r.summary })),
            h('span', { class: 'st muted', text: c.hhmm(r.createdAt) }))) : [h('li', { class: 'empty', text: 'Cuando Claude termine un trabajo, aparece aquí.' })]));
        };
        update(); return { el, update };
      },

      music() {
        const dis = (name, label) => h('button', { type: 'button', disabled: true, 'aria-label': `${label} (no disponible)` }, icon(name));
        return { el: h('div', {}, h('div', { class: 'p-head' }, h('h3', { text: 'Música' })),
          h('div', { class: 'music card' }, h('div', { class: 'cover', 'aria-hidden': 'true' }),
            h('div', {}, h('p', { class: 'big', text: 'Nada sonando' }),
              h('p', { class: 'muted', style: 'margin:4px 0 0', text: 'Spotify se conecta en un siguiente hito. Aquí vas a controlar la música.' }),
              h('div', { class: 'controls' }, dis('prev', 'Anterior'), dis('play', 'Reproducir'), dis('next', 'Siguiente'))))) };
      },

      notes(c) {
        const ta = h('textarea', { rows: 8, maxlength: 20000, placeholder: 'Escribe aquí. Empieza una línea con [ ] y te sale un círculo para marcarla.', 'aria-label': 'Nota rápida' });
        const side = h('div', { class: 'side', 'aria-label': 'Lista de tareas de la nota' }); const saved = h('span', { class: 'saved', role: 'status' });
        const el = h('div', { class: 'notes' }, ta, h('div', {}, h('div', { class: 'p-head' }, h('h3', { text: 'Lista' }), saved), side));
        let timer = null; let loaded = false;
        const LINE = /^(\s*)\[( |x|X)\]\s?(.*)$/;
        const renderChecks = () => {
          const lines = ta.value.split('\n'); const items = [];
          lines.forEach((ln, i) => { const m = LINE.exec(ln); if (m) items.push(h('button', { class: 'check', type: 'button', 'aria-pressed': String(m[2].toLowerCase() === 'x'),
            onclick: () => { lines[i] = `${m[1]}[${m[2].toLowerCase() === 'x' ? ' ' : 'x'}] ${m[3]}`; ta.value = lines.join('\n'); save(); renderChecks(); } },
            h('span', { class: 'circle' }), h('span', { class: 'txt', text: m[3] || '(vacía)' }))); });
          side.replaceChildren(...(items.length ? items : [h('p', { class: 'empty', text: 'Aún no hay tareas. Escribe "[ ] algo por hacer".' })]));
        };
        const save = () => { clearTimeout(timer); saved.textContent = 'Guardando…'; timer = setTimeout(async () => { try { await api.notes?.save(ta.value); saved.textContent = 'Guardado'; } catch { saved.textContent = 'No se pudo guardar'; } }, 500); };
        ta.addEventListener('input', () => { if (loaded) { save(); renderChecks(); } });
        Promise.resolve(api.notes?.get()).then((t) => { ta.value = t || ''; loaded = true; renderChecks(); if (!preview) setTimeout(() => ta.focus(), 50); });
        return { el, destroy: () => { clearTimeout(timer); if (loaded) api.notes?.save(ta.value); } };
      },

      agenda(c) {
        let mode = 'day'; let day = new Date(); let monthRef = new Date(); let events = []; let formOpen = false;
        const el = h('div'); 
        const load = async () => {
          const from = mode === 'day' ? ymd(day) : ymd(new Date(monthRef.getFullYear(), monthRef.getMonth(), 1));
          const to = mode === 'day' ? ymd(day) : ymd(new Date(monthRef.getFullYear(), monthRef.getMonth() + 1, 0));
          try { events = (await api.agenda?.list(from, to)) || []; } catch { events = []; } draw();
        };
        function draw() {
          const isToday = ymd(day) === ymd(new Date());
          const title = mode === 'day' ? (events.length ? (isToday ? 'Hoy' : day.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })) : (isToday ? 'Nada planeado' : 'Sin eventos')) : monthRef.toLocaleDateString('es', { month: 'long', year: 'numeric' });
          const head = h('div', { class: 'p-head' }, h('h3', { text: 'Agenda' }),
            h('div', { style: 'display:flex;gap:8px;align-items:center' },
              h('div', { class: 'seg', role: 'group', 'aria-label': 'Vista' },
                h('button', { type: 'button', 'aria-pressed': String(mode === 'day'), text: 'Día', onclick: () => { mode = 'day'; load(); } }),
                h('button', { type: 'button', 'aria-pressed': String(mode === 'month'), text: 'Mes', onclick: () => { mode = 'month'; load(); } })),
              h('button', { class: 'round', type: 'button', title: 'Agregar evento', 'aria-label': 'Agregar evento', onclick: () => { formOpen = !formOpen; draw(); } }, icon('plus'))));
          const body = [head, h('p', { class: 'big', style: 'margin:0 0 8px;text-transform:capitalize', text: title })];
          if (formOpen) body.push(form());
          body.push(mode === 'day' ? dayView(isToday) : monthView());
          el.replaceChildren(...body);
        }
        function form() {
          const t = h('input', { type: 'text', maxlength: 80, placeholder: 'Ej. Clase de redes', 'aria-label': 'Título' });
          const d = h('input', { type: 'date', value: ymd(day), 'aria-label': 'Fecha' });
          const tm = h('input', { type: 'time', value: '09:00', 'aria-label': 'Hora' });
          const err = h('p', { class: 'hint', role: 'alert', style: 'color:var(--danger)', hidden: true });
          const go = async () => { try { await api.agenda.add({ title: t.value, date: d.value, time: tm.value, duration: 60 }); formOpen = false; day = new Date(`${d.value}T12:00`); await load(); } catch (e) { err.hidden = false; err.textContent = e.message; } };
          t.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
          setTimeout(() => t.focus(), 30);
          return h('div', {}, h('div', { class: 'form' }, h('label', {}, 'Título', t), h('label', {}, 'Fecha', d), h('label', {}, 'Hora', tm), h('button', { class: 'btn btn-primary btn-small', type: 'button', text: 'Guardar', onclick: go })), err);
        }
        function dayView(isToday) {
          const S = 8; const E = 20; const tl = h('div', { class: 'timeline', 'aria-hidden': 'true' }, h('div', { class: 'line' }));
          for (const hr of [8, 12, 16, 20]) { const x = ((hr - S) / (E - S)) * 100; const tk = h('i', { class: 'tick' }); tk.style.left = `${x}%`; const lb = h('span', { class: 'tl', text: `${pad(hr)}:00` }); lb.style.left = `${x}%`; tl.append(tk, lb); }
          for (const ev of events) {
            const [hh, mm] = ev.time.split(':').map(Number); const start = hh + mm / 60; const x = Math.max(0, ((start - S) / (E - S)) * 100);
            if (start >= E || start + ev.duration / 60 <= S) continue;
            const b = h('i', { class: 'ev' }); b.style.left = `${x}%`; b.style.width = `${Math.min(100 - x, (ev.duration / 60 / (E - S)) * 100)}%`; tl.append(b);
          }
          if (isToday) { const n = new Date(); const hr = n.getHours() + n.getMinutes() / 60; if (hr >= S && hr <= E) { const nw = h('i', { class: 'now' }); nw.style.left = `${((hr - S) / (E - S)) * 100}%`; tl.append(nw); } }
          const list = h('ul', { class: 'list' }, ...events.map((ev) => h('li', {}, h('span', { class: 'st muted', text: ev.time }),
            h('div', { class: 'grow' }, h('div', { class: 't', text: ev.title })),
            h('button', { class: 'tiny', type: 'button', 'aria-label': `Borrar ${ev.title}`, title: 'Borrar', onclick: async () => { await api.agenda.remove(ev.id); load(); } }, icon('close')))));
          return h('div', {}, tl, events.length ? list : h('p', { class: 'hint', text: 'Los eventos de Google Calendar llegan en un siguiente hito. Por ahora puedes agregar los tuyos con +.' }));
        }
        function monthView() {
          const y = monthRef.getFullYear(); const m = monthRef.getMonth(); const first = (new Date(y, m, 1).getDay() + 6) % 7; const days = new Date(y, m + 1, 0).getDate();
          const grid = h('div', { class: 'month' }, ...['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d) => h('span', { class: 'dow', text: d })));
          for (let i = 0; i < first; i += 1) grid.append(h('button', { type: 'button', disabled: true, 'aria-hidden': 'true' }));
          for (let d = 1; d <= days; d += 1) {
            const key = `${y}-${pad(m + 1)}-${pad(d)}`; const has = events.some((e) => e.date === key);
            grid.append(h('button', { type: 'button', 'data-today': String(key === ymd(new Date())), 'aria-label': `${d}${has ? ', con eventos' : ''}`, onclick: () => { day = new Date(y, m, d, 12); mode = 'day'; load(); } }, String(d), has ? h('i', { class: 'dot' }) : null));
          }
          const nav = h('div', { style: 'display:flex;gap:8px;margin-bottom:8px' },
            h('button', { class: 'btn btn-secondary btn-small', type: 'button', text: '←', 'aria-label': 'Mes anterior', onclick: () => { monthRef = new Date(y, m - 1, 1); load(); } }),
            h('button', { class: 'btn btn-secondary btn-small', type: 'button', text: '→', 'aria-label': 'Mes siguiente', onclick: () => { monthRef = new Date(y, m + 1, 1); load(); } }));
          return h('div', {}, nav, grid);
        }
        load(); return { el };
      },

      tray(c) {
        const drop = h('div', { class: 'drop', 'data-over': 'false' }, 'Suelta archivos aquí para tenerlos a mano');
        const list = h('ul', { class: 'list' }); const clear = h('button', { class: 'btn btn-secondary btn-small', type: 'button', text: 'Vaciar' });
        const el = h('div', {}, h('div', { class: 'p-head' }, h('h3', { text: 'Bandeja de archivos' }), clear), drop, list);
        let items = [];
        const draw = () => list.replaceChildren(...(items.length ? items.map((f) => {
          const li = h('li', { draggable: f.missing ? 'false' : 'true', 'aria-label': f.name },
            h('div', { class: 'grow' }, h('div', { class: 't', text: f.name }), h('div', { class: 's', text: f.missing ? 'No se encuentra el archivo' : (f.dir ? 'Carpeta' : fmtSize(f.size)) })),
            h('div', { class: 'li-actions' },
              h('button', { class: 'btn btn-secondary btn-small', type: 'button', text: 'Abrir', disabled: f.missing, onclick: () => api.tray.open(f.id) }),
              h('button', { class: 'btn btn-secondary btn-small', type: 'button', text: 'Mostrar', disabled: f.missing, onclick: () => api.tray.reveal(f.id) }),
              h('button', { class: 'tiny', type: 'button', title: 'Quitar de la bandeja', 'aria-label': `Quitar ${f.name}`, onclick: async () => { items = await api.tray.remove(f.id); draw(); } }, icon('close'))));
          li.addEventListener('dragstart', (e) => { e.preventDefault(); api.tray.startDrag(f.id); });
          return li;
        }) : [h('li', { class: 'empty', text: 'La bandeja está vacía.' })]));
        drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.dataset.over = 'true'; });
        drop.addEventListener('dragleave', () => { drop.dataset.over = 'false'; });
        drop.addEventListener('drop', async (e) => {
          e.preventDefault(); drop.dataset.over = 'false';
          const paths = [...(e.dataTransfer?.files || [])].map((f) => api.tray.pathForFile(f)).filter(Boolean);
          if (paths.length) { items = await api.tray.add(paths); draw(); }
        });
        clear.addEventListener('click', async () => { items = await api.tray.clear(); draw(); });
        Promise.resolve(api.tray?.list()).then((l) => { items = l || []; draw(); });
        return { el };
      },

      clipboard(c) {
        const sw = h('input', { type: 'checkbox', role: 'switch' }); const clear = h('button', { class: 'btn btn-secondary btn-small', type: 'button', text: 'Limpiar' });
        const list = h('ul', { class: 'list' }); const note = h('p', { class: 'hint' });
        const el = h('div', {}, h('div', { class: 'p-head' }, h('h3', { text: 'Portapapeles' }), clear),
          h('label', { class: 'switch' }, sw, 'Guardar lo que copio (solo en memoria, se borra al cerrar)'), note, list);
        let state = { enabled: false, items: [] };
        const draw = () => {
          sw.checked = state.enabled; clear.hidden = !state.enabled;
          note.textContent = state.enabled ? 'No se guardan textos que parezcan claves o contraseñas.' : 'Está apagado por defecto porque lo que copias puede ser privado.';
          list.replaceChildren(...(state.enabled && state.items.length ? state.items.map((i) => h('li', {},
            h('button', { class: 'check', type: 'button', title: 'Copiar de nuevo', 'aria-label': `Copiar: ${i.text.slice(0, 60)}`, onclick: () => api.clip.copy(i.id) }, h('span', { class: 't grow', text: i.text.replace(/\s+/g, ' ').slice(0, 140) })),
            h('button', { class: 'btn btn-secondary btn-small', type: 'button', 'aria-pressed': String(i.pinned), text: i.pinned ? 'Fijado' : 'Fijar', onclick: () => api.clip.pin(i.id) }))) : state.enabled ? [h('li', { class: 'empty', text: 'Copia algo y aparece aquí.' })] : []));
        };
        sw.addEventListener('change', () => api.clip.setEnabled(sw.checked));
        clear.addEventListener('click', () => api.clip.clear());
        const off = api.clip?.onChange?.((s) => { state = s; draw(); });
        Promise.resolve(api.clip?.state()).then((s) => { if (s) { state = s; draw(); } });
        return { el, destroy: () => { try { off?.(); } catch { /* */ } } };
      },
    };

    // ---------- Eventos ----------
    // Con "al pasar el mouse": abre al llegar y cierra al irse. Un clic en la cabecera lo deja fijo.
    els.head.addEventListener('click', () => {
      if (effective() === 'permission') return;
      clearTimeout(hoverOpenT); clearTimeout(hoverCloseT);
      if (hoverMode()) { if (expanded && pinned) setOpen(false); else setOpen(true, true); } else setOpen(!expanded, false);
    });
    els.collapse.addEventListener('click', () => { clearTimeout(hoverCloseT); setOpen(false); });
    const scheduleClose = () => {
      clearTimeout(hoverCloseT);
      hoverCloseT = setTimeout(() => { if (!over && expanded && !pinned && hoverMode() && !root_.contains(document.activeElement && ['TEXTAREA', 'INPUT'].includes(document.activeElement.tagName) ? document.activeElement : null)) setOpen(false); }, 450);
    };
    root_.addEventListener('mouseenter', () => {
      over = true; clearTimeout(hoverCloseT);
      if (hoverMode() && !expanded && effective() !== 'permission') { clearTimeout(hoverOpenT); hoverOpenT = setTimeout(() => { if (over) setOpen(true, false); }, 140); }
    });
    root_.addEventListener('mouseleave', () => { over = false; clearTimeout(hoverOpenT); if (hoverMode() && expanded && !pinned) scheduleClose(); });
    root_.addEventListener('focusout', () => { setTimeout(() => { if (!over && hoverMode() && expanded && !pinned) scheduleClose(); }, 0); });
    els.openPanel.addEventListener('click', () => ctx.openPanel());
    els.allow.addEventListener('click', () => view.pending[0] && api.decide?.(view.pending[0].id, 'allow'));
    els.deny.addEventListener('click', () => view.pending[0] && api.decide?.(view.pending[0].id, 'deny'));
    els.noticeClose.addEventListener('click', () => { notice = null; clearTimeout(noticeTimer); render(); });
    root_.addEventListener('keydown', (e) => { if (e.key === 'Escape' && expanded) setOpen(false); });
    if (!preview) {
      root_.addEventListener('mouseenter', () => api.setIgnoreMouse?.(false));
      root_.addEventListener('mouseleave', () => api.setIgnoreMouse?.(true));
      api.setIgnoreMouse?.(true);
      window.addEventListener('blur', () => { if (expanded && theme.collapseOnBlur && (!hoverMode() || pinned)) setOpen(false); });
      if (navigator.getBattery) navigator.getBattery().then((b) => { const f = () => { els.battery.hidden = false; els.battery.textContent = `${Math.round(b.level * 100)}%${b.charging ? ' · cargando' : ''}`; }; f(); b.addEventListener('levelchange', f); b.addEventListener('chargingchange', f); }).catch(() => {});
    }
    const labelTimer = setInterval(() => { if (effective() === 'idle' && theme.idleLabel === 'hora') render(); }, 5000);
    const dateTimer = setInterval(() => { els.date.textContent = new Date().toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' }); }, 30000);
    els.date.textContent = new Date().toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });

    // ---------- Control externo ----------
    const ctl = {
      root: root_,
      setView(v) { view = { connected: view.connected, ...v }; render(); },
      setTheme(t) { theme = T().sanitizeTheme(t); T().applyTheme(root_, theme); if (!theme.dock.includes(page)) page = theme.dock[0]; renderDock(); if (dashVisible()) showPage(page, true); render(); },
      showNotice(kind, text) {
        clearTimeout(noticeTimer);
        if (kind === 'none') { notice = null; render(); return; }
        notice = { kind, text };
        if (kind === 'done') { noticeTimer = setTimeout(() => { notice = null; render(); }, DONE_VISIBLE_MS); refreshStats(); }
        render();
      },
      setExpanded(v) { setOpen(v, true); },
      toggle() { if (effective() === 'permission') return; setOpen(!expanded, true); },
      setPage(p) { page = p; if (dashVisible()) showPage(p, true); else renderDock(); },
      announce(text) { els.live.textContent = text; },
      destroy() { clearInterval(labelTimer); clearInterval(dateTimer); clearTimeout(hoverOpenT); clearTimeout(hoverCloseT); clearTimeout(leaveTimer); clearTimeout(noticeTimer); destroyPage(); },
    };
    ctl.setTheme(theme); render();
    return ctl;
  }

  root.IslandUI = { mount };
})(window);
