'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

let sound = true;
ipcRenderer.invoke('isla:settings').then((s) => { sound = !!s.sound; }).catch(() => {});
ipcRenderer.on('isla:settings', (_e, s) => { sound = !!s.sound; });

const call = (c, ...a) => ipcRenderer.invoke(c, ...a);
const on = (channel, cb) => { const f = (_e, v) => cb(v); ipcRenderer.on(channel, f); return () => ipcRenderer.removeListener(channel, f); };

// Lo único que la página de la isla puede pedirle a la app. Nada más.
contextBridge.exposeInMainWorld('isla', {
  getState: () => call('isla:state'),
  decide: (id, decision) => ipcRenderer.send('isla:decide', String(id), decision === 'allow' ? 'allow' : 'deny'),
  setIgnoreMouse: (ignore) => ipcRenderer.send('isla:mouse', !!ignore),
  setExpanded: (v) => ipcRenderer.send('isla:expand', !!v),
  openPanel: (section) => ipcRenderer.send('isla:open-panel', section ? String(section) : ''),
  onState: (cb) => on('isla:state', cb),
  onNotice: (cb) => on('isla:notice', cb),
  onSpeak: (cb) => on('isla:speak', cb),
  onToggle: (cb) => on('isla:toggle', cb),
  soundEnabled: () => sound,
  theme: { get: () => call('isla:theme:get'), onChange: (cb) => on('isla:theme', cb) },
  notes: { get: () => call('isla:notes:get'), save: (t) => call('isla:notes:save', String(t ?? '')) },
  agenda: {
    list: (from, to) => call('isla:agenda:list', String(from), String(to)),
    add: (e) => call('isla:agenda:add', e),
    remove: (id) => call('isla:agenda:remove', String(id)),
  },
  tray: {
    list: () => call('isla:tray:list'),
    add: (paths) => call('isla:tray:add', paths),
    remove: (id) => call('isla:tray:remove', String(id)),
    clear: () => call('isla:tray:clear'),
    open: (id) => call('isla:tray:open', String(id)),
    reveal: (id) => call('isla:tray:reveal', String(id)),
    startDrag: (id) => ipcRenderer.send('isla:tray:drag', String(id)),
    pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  },
  clip: {
    state: () => call('isla:clip:state'),
    setEnabled: (v) => call('isla:clip:enable', !!v),
    copy: (id) => call('isla:clip:copy', String(id)),
    pin: (id) => call('isla:clip:pin', String(id)),
    clear: () => call('isla:clip:clear'),
    onChange: (cb) => on('isla:clip', cb),
  },
  stats: () => call('isla:stats'),
});
