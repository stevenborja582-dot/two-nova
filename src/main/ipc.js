'use strict';
const { DEFAULTS } = require('../lib/personalities');

/**
 * Canales del panel. Solo responde a la ventana del panel (nadie más puede pedirlos),
 * y cualquier error vuelve como mensaje en español sin romper nada.
 */
function registerPanelIpc({ ipcMain, isPanel, assistant, book, secrets, claudeCode }) {
  const handle = (channel, fn) => ipcMain.handle(channel, async (event, ...args) => {
    if (!isPanel(event.sender)) return { ok: false, error: 'No permitido.' };
    try { return { ok: true, data: await fn(...args) }; } catch (e) { return { ok: false, error: e?.message || 'Algo salió mal.' }; }
  });
  const decorate = () => {
    const active = book.activeId();
    return book.list().map((p) => ({ ...p, builtin: DEFAULTS.some((d) => d.id === p.id), active: p.id === active }));
  };
  const str = (v, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : '');

  handle('nova:chat', (text, pid) => assistant.chat(str(text), pid ? str(pid, 60) : undefined));
  handle('nova:reset', () => { assistant.reset(); return true; });

  handle('nova:people:list', () => decorate());
  handle('nova:people:save', (p) => { book.save(p); return decorate(); });
  handle('nova:people:create', (p) => { const { created } = book.create(p); return { list: decorate(), created }; });
  handle('nova:people:remove', (id) => { book.remove(str(id, 60)); return decorate(); });
  handle('nova:people:reset', (id) => { book.reset(str(id, 60)); return decorate(); });
  handle('nova:people:active', (id) => { book.setActive(str(id, 60)); return true; });

  handle('nova:settings:get', () => ({ settings: assistant.settings(), usage: assistant.usage() }));
  handle('nova:settings:save', (s) => assistant.saveSettings(s || {}));

  handle('nova:key:status', () => assistant.keyStatus());
  handle('nova:key:set', (k) => { secrets.set('anthropic', str(k, 400)); return assistant.keyStatus(); });
  handle('nova:key:clear', () => { secrets.clear('anthropic'); return assistant.keyStatus(); });

  handle('nova:cc:status', () => ({ connected: claudeCode.status().connected }));
  handle('nova:cc:connect', async () => { await claudeCode.connect(); return { connected: claudeCode.status().connected }; });
  handle('nova:cc:disconnect', async () => { await claudeCode.disconnect(); return { connected: claudeCode.status().connected }; });
}

module.exports = { registerPanelIpc };
