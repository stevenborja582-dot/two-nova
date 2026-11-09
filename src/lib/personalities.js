'use strict';
// Las personalidades cambian el TONO y la voz. Nunca cambian los permisos ni las reglas:
// esas viven en el código y no dependen de lo que diga el texto de estilo.

const DEFAULTS = [
  { id: 'mayordomo', name: 'Mayordomo', tagline: 'Formal y preciso',
    style: 'Formal, preciso y breve. Trata de usted. Sin bromas.',
    color: '#9fb3c8', greeting: 'A sus órdenes.', rate: 0.95, pitch: 0.9, voiceHints: ['Pablo', 'Jorge', 'Raul'] },
  { id: 'compa', name: 'Compa', tagline: 'Casual y bromista',
    style: 'Casual y bromista, como un amigo cercano. Frases cortas y naturales. Español de El Salvador, sin exagerar.',
    color: '#f6ad55', greeting: '¿Qué hacemos?', rate: 1.1, pitch: 1.1, voiceHints: ['Raul', 'Diego', 'Jorge'] },
  { id: 'profe', name: 'Profe', tagline: 'Paciente, paso a paso',
    style: 'Paciente y claro. Explica paso a paso y comprueba que se entendió. Pensado para las tareas del colegio.',
    color: '#68d391', greeting: 'Vamos con calma, paso a paso.', rate: 0.9, pitch: 1.0, voiceHints: ['Sabina', 'Helena', 'Laura'] },
  { id: 'coach', name: 'Coach', tagline: 'Directo y motivador',
    style: 'Directo y motivador. Va al grano y empuja a terminar lo pendiente, sin presionar de más.',
    color: '#ed8936', greeting: 'Vamos, a terminar lo pendiente.', rate: 1.15, pitch: 0.95, voiceHints: ['Pablo', 'Raul', 'Diego'] },
  { id: 'seco', name: 'Seco', tagline: 'Humor seco, muy breve',
    style: 'Humor seco y sarcasmo suave. Muy breve. Nunca bromea con permisos, seguridad ni errores serios.',
    color: '#b794f4', greeting: 'Aquí estoy. Qué emoción.', rate: 0.95, pitch: 0.8, voiceHints: ['Helena', 'Sabina', 'Paulina'] },
];

const MAX_PERSONALITIES = 12;
const HEX = /^#[0-9a-f]{6}$/i;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);

/** Revisa y limpia una personalidad. Lanza un Error con mensaje en español si algo no vale. */
function sanitize(p) {
  const name = String(p?.name ?? '').trim();
  if (!name || name.length > 30) throw new Error('El nombre debe tener entre 1 y 30 letras.');
  const style = String(p?.style ?? '').trim();
  if (!style || style.length > 600) throw new Error('El estilo debe tener entre 1 y 600 letras.');
  const rate = num(p?.rate); const pitch = num(p?.pitch);
  if (!(rate >= 0.5 && rate <= 2)) throw new Error('La velocidad va de 0.5 a 2.');
  if (!(pitch >= 0.5 && pitch <= 2)) throw new Error('El tono va de 0.5 a 2.');
  const color = String(p?.color ?? '');
  if (!HEX.test(color)) throw new Error('El color debe ser como #aabbcc.');
  const id = String(p?.id ?? '');
  if (!/^[a-z0-9-]{2,40}$/.test(id)) throw new Error('Identificador no válido.');
  const hints = Array.isArray(p?.voiceHints) ? p.voiceHints.map((h) => String(h).slice(0, 40)).slice(0, 6) : [];
  return {
    id, name, style, color: color.toLowerCase(),
    tagline: String(p?.tagline ?? '').slice(0, 60),
    greeting: String(p?.greeting ?? '').slice(0, 120),
    rate: Math.round(rate * 100) / 100, pitch: Math.round(pitch * 100) / 100,
    voiceHints: hints,
    voiceName: p?.voiceName ? String(p.voiceName).slice(0, 120) : null,
  };
}

/** Ninguna personalidad puede sonar idéntica a otra: voz, velocidad y tono distintos. */
function checkDistinct(list) {
  const seen = new Map();
  for (const p of list) {
    const key = [p.voiceName || p.voiceHints.join('|'), p.rate, p.pitch].join('#');
    if (seen.has(key)) throw new Error(`"${p.name}" suena igual que "${seen.get(key)}". Cambia la voz, la velocidad o el tono.`);
    seen.set(key, p.name);
  }
}

function withDefaults(saved) {
  const byId = new Map((Array.isArray(saved) ? saved : []).map((p) => [p.id, p]));
  const out = DEFAULTS.map((d) => {
    try { return sanitize({ ...d, ...(byId.get(d.id) || {}), id: d.id }); } catch { return sanitize(d); }
  });
  for (const p of byId.values()) {
    if (DEFAULTS.some((d) => d.id === p.id)) continue;
    try { out.push(sanitize(p)); } catch { /* personalidad dañada: se ignora */ }
  }
  return out.slice(0, MAX_PERSONALITIES);
}

function newId(name, existing) {
  const base = String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'nueva';
  let id = base.length < 2 ? `${base}x` : base; let i = 2;
  const ids = new Set(existing.map((p) => p.id));
  while (ids.has(id)) id = `${base}-${i++}`;
  return id;
}

class PersonalityBook {
  constructor(store) { this.store = store; }
  list() { return withDefaults(this.store.getSetting('personalities', [])); }
  get(id) { const l = this.list(); return l.find((p) => p.id === id) || l[0]; }
  activeId() { const id = this.store.getSetting('activePersonality', 'compa'); return this.list().some((p) => p.id === id) ? id : 'compa'; }
  setActive(id) { if (!this.list().some((p) => p.id === id)) throw new Error('Esa personalidad no existe.'); this.store.setSetting('activePersonality', id); }

  save(input) {
    const list = this.list();
    const clean = sanitize(input);
    const i = list.findIndex((p) => p.id === clean.id);
    if (i === -1) throw new Error('Esa personalidad no existe.');
    const next = list.slice(); next[i] = clean;
    checkDistinct(next);
    this.store.setSetting('personalities', next);
    return next;
  }

  create(input) {
    const list = this.list();
    if (list.length >= MAX_PERSONALITIES) throw new Error(`Máximo ${MAX_PERSONALITIES} personalidades.`);
    const clean = sanitize({ ...input, id: newId(input?.name, list) });
    const next = [...list, clean];
    checkDistinct(next);
    this.store.setSetting('personalities', next);
    return { list: next, created: clean };
  }

  remove(id) {
    if (DEFAULTS.some((d) => d.id === id)) throw new Error('Las 5 personalidades de partida no se borran; puedes editarlas.');
    const next = this.list().filter((p) => p.id !== id);
    this.store.setSetting('personalities', next);
    if (this.activeId() === id) this.store.setSetting('activePersonality', 'compa');
    return next;
  }

  reset(id) {
    const d = DEFAULTS.find((x) => x.id === id);
    if (!d) throw new Error('Solo se restauran las de partida.');
    return this.save({ ...d, voiceName: null });
  }
}

module.exports = { DEFAULTS, PersonalityBook, sanitize, checkDistinct, withDefaults, MAX_PERSONALITIES };
