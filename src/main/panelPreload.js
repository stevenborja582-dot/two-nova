'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

// Lo único que el panel puede pedirle a la app. La clave de la API solo entra, nunca sale.
contextBridge.exposeInMainWorld('nova', {
  chat: (text, personalityId) => call('nova:chat', String(text ?? ''), personalityId ? String(personalityId) : null),
  resetChat: () => call('nova:reset'),
  people: {
    list: () => call('nova:people:list'),
    save: (p) => call('nova:people:save', p),
    create: (p) => call('nova:people:create', p),
    remove: (id) => call('nova:people:remove', String(id)),
    reset: (id) => call('nova:people:reset', String(id)),
    setActive: (id) => call('nova:people:active', String(id)),
  },
  settings: { get: () => call('nova:settings:get'), save: (s) => call('nova:settings:save', s) },
  key: { status: (provider) => call('nova:key:status', provider ? String(provider) : null), set: (k, provider) => call('nova:key:set', String(k ?? ''), provider ? String(provider) : null), clear: (provider) => call('nova:key:clear', provider ? String(provider) : null) },
  stats: () => call('nova:stats'),
  theme: { get: () => call('nova:theme:get'), save: (t) => call('nova:theme:save', t), reset: () => call('nova:theme:reset') },
  onGoto: (cb) => ipcRenderer.on('nova:goto', (_e, section) => cb(String(section))),
  claudeCode: { status: () => call('nova:cc:status'), connect: () => call('nova:cc:connect'), disconnect: () => call('nova:cc:disconnect') },
});
