'use strict';
// Cómo se ve la isla. Todo se puede cambiar desde Apariencia, con vista previa en vivo.
// Este archivo lo usan el proceso principal (para validar) y las pantallas (para pintar).
(function (root) {
  const PAGES = {
    home:      { label: 'Inicio',       color: '#8b7bff' },
    claude:    { label: 'Claude',       color: '#ff9f5a' },
    music:     { label: 'Música',       color: '#ff5f8a' },
    notes:     { label: 'Notas',        color: '#9aa4b8' },
    agenda:    { label: 'Agenda',       color: '#4aa8ff' },
    tray:      { label: 'Bandeja',      color: '#3fd0c0' },
    clipboard: { label: 'Portapapeles', color: '#6fdc8c' },
  };
  const EYES = ['ovalo', 'redondo', 'rendija', 'gato'];
  const SHAPES = ['pildora', 'suave', 'recto'];
  const OPEN_MODES = ['hover', 'click'];
  const IDLE_LABELS = ['hora', 'estado', 'saludo', 'texto', 'nada'];
  const IDLE_ANIMS = ['respirar', 'parpadeo', 'mirar', 'flotar', 'latido', 'nada'];
  const MOTIONS = ['elastica', 'suave', 'rapida'];

  const DEFAULT_THEME = {
    accent: '#8fb0ff', eyeColor: '', eyeStyle: 'ovalo', bg: '#0b0d12', shape: 'suave',
    scale: 1, opacity: 1, glow: true, glowStrength: 0.45, clockSeconds: false, animations: true,
    collapseOnBlur: true, offsetY: 4, userName: 'S1even',
    openMode: 'hover', idleLabel: 'hora', idleText: '', idleAnim: 'respirar', motion: 'elastica',
    dock: ['home', 'claude', 'music', 'notes', 'agenda', 'tray', 'clipboard'],
  };

  const HEX = /^#[0-9a-f]{6}$/i;
  function lum(hex) {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const bool = (v, d) => (typeof v === 'boolean' ? v : d);
  const numIn = (v, d, lo, hi, name) => {
    if (v === undefined) return d;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new Error(`${name} debe estar entre ${lo} y ${hi}.`);
    return v;
  };

  /** Valida y completa el tema. Lanza un Error en español si algo no sirve. */
  function sanitizeTheme(input) {
    const t = { ...DEFAULT_THEME, ...(input && typeof input === 'object' ? input : {}) };
    for (const k of ['accent', 'bg']) if (!HEX.test(String(t[k]))) throw new Error(`El color "${k === 'bg' ? 'fondo' : 'acento'}" debe ser como #aabbcc.`);
    if (t.eyeColor && !HEX.test(String(t.eyeColor))) throw new Error('El color de los ojos debe ser como #aabbcc.');
    const out = {
      accent: t.accent.toLowerCase(), bg: t.bg.toLowerCase(), eyeColor: t.eyeColor ? String(t.eyeColor).toLowerCase() : '',
      eyeStyle: EYES.includes(t.eyeStyle) ? t.eyeStyle : (() => { throw new Error('Estilo de ojos no válido.'); })(),
      shape: SHAPES.includes(t.shape) ? t.shape : (() => { throw new Error('Forma no válida.'); })(),
      scale: Math.round(numIn(t.scale, 1, 0.8, 1.4, 'El tamaño') * 100) / 100,
      opacity: Math.round(numIn(t.opacity, 1, 0.7, 1, 'La opacidad') * 100) / 100,
      glowStrength: Math.round(numIn(t.glowStrength, 0.45, 0, 1, 'El brillo') * 100) / 100,
      offsetY: Math.round(numIn(t.offsetY, 4, 0, 80, 'La distancia al borde')),
      glow: bool(t.glow, true), clockSeconds: bool(t.clockSeconds, false), animations: bool(t.animations, true),
      collapseOnBlur: bool(t.collapseOnBlur, true),
      userName: String(t.userName ?? '').trim().slice(0, 30) || 'S1even',
      openMode: OPEN_MODES.includes(t.openMode) ? t.openMode : (() => { throw new Error('Forma de abrir no válida.'); })(),
      idleLabel: IDLE_LABELS.includes(t.idleLabel) ? t.idleLabel : (() => { throw new Error('Texto de la pastilla no válido.'); })(),
      idleText: String(t.idleText ?? '').trim().slice(0, 24),
      idleAnim: IDLE_ANIMS.includes(t.idleAnim) ? t.idleAnim : (() => { throw new Error('Animación en reposo no válida.'); })(),
      motion: MOTIONS.includes(t.motion) ? t.motion : (() => { throw new Error('Animación al abrir no válida.'); })(),
    };
    if (out.idleLabel === 'texto' && !out.idleText) throw new Error('Escribe el texto que quieres ver en la pastilla.');
    // El texto de la isla es claro: el fondo tiene que ser oscuro y el acento tiene que verse sobre él.
    if (lum(out.bg) > 0.18) throw new Error('El fondo es demasiado claro: el texto es blanco y no se leería. Elige un color más oscuro.');
    if (contrast(out.accent, out.bg) < 3) throw new Error('El color de acento casi no se ve sobre ese fondo. Elige uno más claro o cambia el fondo.');
    if (out.eyeColor && contrast(out.eyeColor, out.bg) < 3) throw new Error('El color de los ojos casi no se ve sobre ese fondo.');
    const dock = Array.isArray(t.dock) ? t.dock : DEFAULT_THEME.dock;
    const seen = []; for (const p of dock) { if (!PAGES[p]) throw new Error(`La app "${p}" no existe.`); if (!seen.includes(p)) seen.push(p); }
    if (!seen.length) throw new Error('Deja al menos una app en la isla.');
    out.dock = seen;
    return out;
  }

  /** Pone el tema como variables CSS en un elemento. */
  function applyTheme(el, theme) {
    const t = theme || DEFAULT_THEME;
    const r = { pildora: ['999px', '36px'], suave: ['24px', '22px'], recto: ['10px', '8px'] }[t.shape] || ['24px', '22px'];
    const s = el.style;
    s.setProperty('--accent-user', t.accent);
    s.setProperty('--eye-user', t.eyeColor || t.accent);
    s.setProperty('--bg', t.bg);
    s.setProperty('--r-pill', r[0]);
    s.setProperty('--r-card', r[1]);
    s.setProperty('--opacity', String(t.opacity));
    s.setProperty('--glow', t.glow ? String(t.glowStrength) : '0');
    el.dataset.eyes = t.eyeStyle;
    el.dataset.anim = t.animations ? 'on' : 'off';
    el.dataset.idle = t.idleAnim || 'respirar';
    el.dataset.motion = t.motion || 'elastica';
  }

  const api = { PAGES, EYES, SHAPES, OPEN_MODES, IDLE_LABELS, IDLE_ANIMS, MOTIONS, DEFAULT_THEME, sanitizeTheme, applyTheme, contrast };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NovaTheme = api;
})(typeof window !== 'undefined' ? window : globalThis);
