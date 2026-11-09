'use strict';
// Canales de datos de la isla (notas, agenda, bandeja, portapapeles, estadísticas, tema).
// Solo contestan a la ventana de la isla; el panel tiene sus propios canales (ipc.js).
const { sanitizeTheme, DEFAULT_THEME } = require('../lib/theme');

const MAX_NOTE = 20000;

function registerIslandIpc({ ipcMain, isIsland, isPanel, store, agenda, trayFiles, clipHistory, shell, clipboard, getTheme, setTheme,
  resizeIsland, openPanel, startDrag, send, nowMs = () => Date.now() }) {
  const handle = (channel, fn) => ipcMain.handle(channel, async (event, ...args) => {
    if (!isIsland(event.sender)) throw new Error('No permitido.');
    return fn(...args);
  });
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

  handle('isla:theme:get', () => getTheme());
  handle('isla:notes:get', () => str(store.getSetting('notes', ''), MAX_NOTE));
  handle('isla:notes:save', (t) => { store.setSetting('notes', str(t, MAX_NOTE)); return true; });

  handle('isla:agenda:list', (from, to) => agenda.range(str(from, 10), str(to, 10)));
  handle('isla:agenda:add', (e) => agenda.add(e));
  handle('isla:agenda:remove', (id) => { agenda.remove(str(id, 60)); return true; });

  handle('isla:tray:list', () => trayFiles.list());
  handle('isla:tray:add', (paths) => trayFiles.add(Array.isArray(paths) ? paths.slice(0, 30) : []));
  handle('isla:tray:remove', (id) => trayFiles.remove(str(id, 60)));
  handle('isla:tray:clear', () => trayFiles.clear());
  // Solo se abre lo que tú pusiste en la bandeja (se busca por id, nunca por una ruta que mande la página).
  handle('isla:tray:open', async (id) => { const f = trayFiles.find(str(id, 60)); if (f && !f.missing) { const err = await shell.openPath(f.path); return err || ''; } return 'No se encuentra el archivo.'; });
  handle('isla:tray:reveal', (id) => { const f = trayFiles.find(str(id, 60)); if (f && !f.missing) shell.showItemInFolder(f.path); return true; });
  ipcMain.on('isla:tray:drag', (event, id) => { if (isIsland(event.sender)) { const f = trayFiles.find(str(id, 60)); if (f && !f.missing) startDrag(event.sender, f.path); } });

  handle('isla:clip:state', () => clipHistory.view());
  handle('isla:clip:enable', async (v) => { clipHistory.setEnabled(!!v); if (clipHistory.enabled) clipHistory.push(await clipboard.readText()); const s = clipHistory.view(); send('isla:clip', s); return s; });
  handle('isla:clip:copy', async (id) => { const i = clipHistory.get(str(id, 60)); if (i) { clipHistory.last = i.text; await clipboard.writeText(i.text); } return true; });
  handle('isla:clip:pin', (id) => { clipHistory.pin(str(id, 60)); const s = clipHistory.view(); send('isla:clip', s); return s; });
  handle('isla:clip:clear', () => { clipHistory.clear(); const s = clipHistory.view(); send('isla:clip', s); return s; });

  handle('isla:stats', () => ({
    ...store.doneStats(new Date().getTimezoneOffset(), nowMs()),
    recent: store.recentDone(8),
  }));

  ipcMain.on('isla:expand', (event, v) => { if (isIsland(event.sender)) resizeIsland(!!v); });
  ipcMain.on('isla:open-panel', (event, section) => { if (isIsland(event.sender)) openPanel(typeof section === 'string' ? section.slice(0, 20) : undefined); });

  // ---- Tema (lo edita el panel; la isla solo lo recibe) ----
  const panelHandle = (channel, fn) => ipcMain.handle(channel, async (event, ...args) => {
    if (!isPanel(event.sender)) return { ok: false, error: 'No permitido.' };
    try { return { ok: true, data: await fn(...args) }; } catch (e) { return { ok: false, error: e?.message || 'Algo salió mal.' }; }
  });
  panelHandle('nova:stats', () => ({ ...store.doneStats(new Date().getTimezoneOffset(), nowMs()), recent: store.recentDone(8) }));
  panelHandle('nova:theme:get', () => ({ theme: getTheme(), defaults: DEFAULT_THEME }));
  panelHandle('nova:theme:save', (t) => { const clean = sanitizeTheme(t); setTheme(clean); return clean; });
  panelHandle('nova:theme:reset', () => { const clean = sanitizeTheme({}); setTheme(clean); return clean; });
}

module.exports = { registerIslandIpc };
