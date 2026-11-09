'use strict';
// Bandeja de archivos: guarda solo la ruta (nunca copia ni lee el contenido).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const MAX = 30;

class TrayFiles {
  constructor(store, fsImpl = fs) { this.store = store; this.fs = fsImpl; }
  list() {
    const l = this.store.getSetting('trayFiles', []);
    return (Array.isArray(l) ? l : []).map((f) => ({ ...f, missing: !this.fs.existsSync(f.path) }));
  }
  add(paths) {
    const cur = this.store.getSetting('trayFiles', []);
    const out = Array.isArray(cur) ? cur.slice() : [];
    for (const p of Array.isArray(paths) ? paths : []) {
      if (typeof p !== 'string' || !path.isAbsolute(p) || p.length > 1000) continue;
      let st; try { st = this.fs.statSync(p); } catch { continue; }
      if (out.some((f) => f.path === p)) continue;
      out.unshift({ id: crypto.randomUUID(), path: p, name: path.basename(p), dir: st.isDirectory(), size: st.isFile() ? st.size : 0 });
    }
    this.store.setSetting('trayFiles', out.slice(0, MAX));
    return this.list();
  }
  find(id) { return this.list().find((f) => f.id === id) || null; }
  remove(id) { this.store.setSetting('trayFiles', this.list().filter((f) => f.id !== id).map(({ missing, ...f }) => f)); return this.list(); }
  clear() { this.store.setSetting('trayFiles', []); return []; }
}

module.exports = { TrayFiles };
