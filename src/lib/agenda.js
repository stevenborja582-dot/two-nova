'use strict';
// Agenda local (eventos que tú escribes). La conexión con Google Calendar llega con los conectores.
const crypto = require('node:crypto');
const MAX_EVENTS = 500;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function sanitizeEvent(e) {
  const title = String(e?.title ?? '').trim();
  if (!title || title.length > 80) throw new Error('El título debe tener entre 1 y 80 letras.');
  if (!DATE.test(String(e?.date)) || Number.isNaN(Date.parse(`${e.date}T00:00:00Z`))) throw new Error('La fecha no es válida.');
  if (!TIME.test(String(e?.time))) throw new Error('La hora debe ser como 14:30.');
  const duration = Math.round(Number(e?.duration ?? 60));
  if (!(duration >= 5 && duration <= 1440)) throw new Error('La duración va de 5 minutos a 24 horas.');
  return { id: typeof e?.id === 'string' && /^[a-f0-9-]{8,40}$/.test(e.id) ? e.id : crypto.randomUUID(), title, date: e.date, time: e.time, duration };
}

class Agenda {
  constructor(store) { this.store = store; }
  all() { const l = this.store.getSetting('agendaEvents', []); return Array.isArray(l) ? l : []; }
  add(input) {
    const list = this.all();
    if (list.length >= MAX_EVENTS) throw new Error('Ya hay demasiados eventos. Borra algunos.');
    const ev = sanitizeEvent({ ...input, id: undefined });
    const next = [...list, ev].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    this.store.setSetting('agendaEvents', next);
    return ev;
  }
  remove(id) { this.store.setSetting('agendaEvents', this.all().filter((e) => e.id !== id)); }
  range(fromDate, toDate) { return this.all().filter((e) => e.date >= fromDate && e.date <= toDate); }
}

module.exports = { Agenda, sanitizeEvent };
