'use strict';
// Historial del portapapeles: SOLO en memoria (nunca en disco), apagado por defecto,
// y no guarda nada que parezca una clave o contraseña.
const crypto = require('node:crypto');
const { mask } = require('./mask');
const MAX = 25;
const MAX_LEN = 2000;

class ClipboardHistory {
  constructor() { this.enabled = false; this.items = []; this.last = null; }
  setEnabled(v) { this.enabled = !!v; if (!this.enabled) { this.items = []; this.last = null; } }
  push(text) {
    if (!this.enabled || typeof text !== 'string') return false;
    const t = text.trim();
    if (!t || t === this.last || t.length > MAX_LEN) return false;
    this.last = t;
    if (mask(t) !== t) return false; // parece un secreto: no se guarda
    this.items = this.items.filter((i) => i.text !== t);
    this.items.unshift({ id: crypto.randomUUID(), text: t, pinned: false, at: Date.now() });
    const pinned = this.items.filter((i) => i.pinned);
    const rest = this.items.filter((i) => !i.pinned).slice(0, MAX);
    this.items = [...pinned, ...rest].sort((a, b) => b.at - a.at);
    return true;
  }
  get(id) { return this.items.find((i) => i.id === id) || null; }
  pin(id) { const i = this.get(id); if (i) i.pinned = !i.pinned; }
  clear() { this.items = this.items.filter((i) => i.pinned); }
  view() { return { enabled: this.enabled, items: this.items.map((i) => ({ id: i.id, text: i.text, pinned: i.pinned })) }; }
}

module.exports = { ClipboardHistory };
