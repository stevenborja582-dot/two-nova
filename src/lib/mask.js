'use strict';
// Oculta claves, tokens y contraseñas antes de mostrar o guardar cualquier texto.
const PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-ant-••••'],
  [/\bsk-[A-Za-z0-9]{20,}/g, 'sk-••••'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, 'gh_••••'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, 'github_pat_••••'],
  [/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA••••'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, 'xox-••••'],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, 'AIza••••'],
  [/\bya29\.[0-9A-Za-z_-]{20,}/g, 'ya29.••••'],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, '$1••••'],
  [/(:\/\/[^\s:@/]+:)[^\s@/]+(@)/g, '$1••••$2'],
  [/(--?(?:password|passwd|pwd|token|secret|api[-_]?key)[= ])\S+/gi, '$1••••'],
  [/((?:password|passwd|pwd|secret|token|api[-_]?key|access[-_]?key)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|\S+)/gi, '$1••••'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[clave privada oculta]'],
];

function mask(text) {
  if (text == null) return '';
  let out = String(text);
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

function clip(text, max) {
  const s = String(text ?? '');
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

// Enmascara y recorta. Es lo único que se guarda o se muestra.
function safe(text, max = 240) {
  return clip(mask(text), max);
}

// Enmascara cualquier valor JSON de forma recursiva (para el modo grabación).
function maskDeep(value, depth = 0) {
  if (depth > 8) return '[…]';
  if (typeof value === 'string') return clip(mask(value), 4000);
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => maskDeep(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 80)) {
      out[k] = /pass|secret|token|key|auth|cookie/i.test(k) && typeof v === 'string'
        ? '••••'
        : maskDeep(v, depth + 1);
    }
    return out;
  }
  return value;
}

module.exports = { mask, clip, safe, maskDeep };
