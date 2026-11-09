'use strict';
// Vista previa de la isla dentro de Apariencia. Vive en su propio marco para que los estilos del panel no la toquen.
// Recibe del panel solo dos tipos de mensaje (tema y estado) y valida el tema antes de usarlo.
(() => {
  const events = [];
  const fakeApi = {
    notes: { get: async () => 'Ejemplo de nota\n[ ] Terminar el proyecto de redes\n[x] Entregar la tarea', save: async () => true },
    agenda: {
      list: async (from, to) => events.filter((e) => e.date >= from && e.date <= to),
      add: async (e) => { events.push({ ...e, id: String(events.length + 1) }); return true; },
      remove: async (id) => { const i = events.findIndex((e) => e.id === id); if (i >= 0) events.splice(i, 1); },
    },
    tray: { list: async () => [], add: async () => [], remove: async () => [], clear: async () => [], open() {}, reveal() {}, startDrag() {}, pathForFile: () => '' },
    clip: { state: async () => ({ enabled: false, items: [] }), setEnabled() {}, copy() {}, pin() {}, clear() {}, onChange: () => () => {} },
    stats: async () => ({ tasksDone: 12, today: 3, streak: 4, recent: [{ cwd: 'C:\\proyectos\\mi-web', summary: 'Arreglé el menú del celular.', createdAt: new Date().toISOString() }] }),
  };
  const ui = window.IslandUI.mount(document.getElementById('host'), fakeApi, { preview: true });
  const sessions = [{ id: 's1', cwd: 'C:\\proyectos\\mi-web', status: 'working', lastMessage: 'Editando styles.css' }];
  const base = { connected: true, state: 'idle', pending: [], sessions, latest: sessions[0] };

  function mode(m, page) {
    ui.showNotice('none', ''); // limpia avisos previos
    if (m === 'expanded') { ui.setView(base); ui.setExpanded(true); if (page) ui.setPage(page); return; }
    ui.setExpanded(false);
    if (m === 'working') ui.setView({ ...base, state: 'working' });
    else if (m === 'permission') ui.setView({ ...base, state: 'working', pending: [{ id: 'p1', sessionId: 's1', toolName: 'Bash', risk: 'medium', summary: 'npm install express' }] });
    else if (m === 'done') { ui.setView(base); ui.showNotice('done', 'Terminé de arreglar el menú del celular.'); }
    else ui.setView({ ...base, sessions: [] , latest: null });
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return;
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'theme') {
      try {
        const t = window.NovaTheme.sanitizeTheme(d.theme);
        ui.setTheme(t);
        document.body.style.zoom = String(t.scale);
      } catch { /* el panel ya muestra el error */ }
    } else if (d.type === 'mode') mode(String(d.mode), typeof d.page === 'string' ? d.page : undefined);
  });
  window.parent.postMessage({ type: 'ready' }, '*');
})();
