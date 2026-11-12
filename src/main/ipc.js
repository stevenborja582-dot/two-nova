'use strict';
const { DEFAULTS } = require('../lib/personalities');
const { PROVIDERS } = require('../lib/brain');
const { localAddresses } = require('../lib/remote');

/**
 * Canales del panel. Solo responde a la ventana del panel (nadie más puede pedirlos),
 * y cualquier error vuelve como mensaje en español sin romper nada.
 */
function registerPanelIpc({ ipcMain, isPanel, assistant, book, secrets, claudeCode, remote, shell }) {
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

  const secretOf = (provider) => { const p = PROVIDERS[provider]; if (!p) throw new Error('Ese cerebro no existe.'); return p.secret; };
  handle('nova:key:status', (provider) => assistant.keyStatus(provider ? str(provider, 20) : undefined));
  handle('nova:key:set', (k, provider) => { const pr = provider ? str(provider, 20) : assistant.provider(); secrets.set(secretOf(pr), str(k, 400)); return assistant.keyStatus(pr); });
  handle('nova:key:clear', (provider) => { const pr = provider ? str(provider, 20) : assistant.provider(); secrets.clear(secretOf(pr)); return assistant.keyStatus(pr); });

  handle('nova:cc:status', () => ({ connected: claudeCode.status().connected }));
  handle('nova:cc:connect', async () => { await claudeCode.connect(); return { connected: claudeCode.status().connected }; });
  handle('nova:cc:disconnect', async () => { await claudeCode.disconnect(); return { connected: claudeCode.status().connected }; });

  // ---- Celular (control remoto) ----
  if (remote) {
    const rview = () => ({ ...remote.view(), addresses: localAddresses() });
    handle('nova:remote:status', () => rview());
    handle('nova:remote:enable', async (on) => { await remote.setEnabled(!!on); return rview(); });
    handle('nova:remote:perms', (p) => { remote.setPermissions({ power: p?.power, files: p?.files }); return rview(); });
    handle('nova:remote:pair', () => { remote.startPairing(); return rview(); });
    handle('nova:remote:cancelpair', () => { remote.cancelPairing(); return rview(); });
    handle('nova:remote:revoke', (id) => { remote.revoke(str(id, 40)); return rview(); });
    handle('nova:remote:folder', async (which) => {
      const dir = which === 'outbox' ? remote.outboxDir : remote.inboxDir;
      require('node:fs').mkdirSync(dir, { recursive: true });
      const err = await shell.openPath(dir);
      if (err) throw new Error('No pude abrir la carpeta.');
      return true;
    });
  }
}

module.exports = { registerPanelIpc };