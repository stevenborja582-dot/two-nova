'use strict';
// Conecta y desconecta Claude Code de forma segura.
// Solo toca ~/.claude/settings.json: hace copia de respaldo, conserva todo lo demás
// y marca sus entradas para poder quitarlas sin tocar las tuyas.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const brand = require('../brand');

// Eventos con aviso por HTTP. SessionStart no admite http en Claude Code, así que no se usa.
const EVENTS = {
  PermissionRequest: { timeout: 120 }, // espera tu decisión; si no, Claude Code pregunta solo
  PreToolUse: { timeout: 5 },
  UserPromptSubmit: { timeout: 5 },
  Notification: { timeout: 5 },
  Stop: { timeout: 5 },
};

const defaultSettingsPath = (home = os.homedir()) => path.join(home, '.claude', 'settings.json');

const hookUrl = (port) => `http://127.0.0.1:${port}/hook?${brand.hookTag}`;
const TAGS = [brand.hookTag, ...(brand.legacyHookTags || [])];
const isOurs = (h) => !!h && h.type === 'http' && typeof h.url === 'string' && TAGS.some((t) => h.url.includes(`/hook?${t}`));

function readSettings(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return { exists: false, data: {}, raw: '' };
    throw e;
  }
  if (!raw.trim()) return { exists: true, data: {}, raw };
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('no es un objeto');
    return { exists: true, data, raw };
  } catch (e) {
    // No se toca un archivo que no se pueda leer con seguridad (por ejemplo, con comentarios).
    throw Object.assign(new Error(`No pude leer ${file} como JSON (${e.message}). No lo toqué.`), { code: 'BAD_JSON' });
  }
}

function withoutOurs(hooks) {
  const out = {};
  for (const [event, groups] of Object.entries(hooks || {})) {
    if (!Array.isArray(groups)) { out[event] = groups; continue; }
    const kept = [];
    for (const g of groups) {
      if (!g || !Array.isArray(g.hooks)) { kept.push(g); continue; }
      const rest = g.hooks.filter((h) => !isOurs(h));
      if (rest.length) kept.push({ ...g, hooks: rest });
    }
    if (kept.length) out[event] = kept;
  }
  return out;
}

function buildNext(data, { port, token }) {
  const hooks = withoutOurs(data.hooks);
  for (const [event, opts] of Object.entries(EVENTS)) {
    const entry = {
      hooks: [{
        type: 'http',
        url: hookUrl(port),
        headers: { 'X-Island-Token': token },
        timeout: opts.timeout,
      }],
    };
    hooks[event] = [...(hooks[event] || []), entry];
  }
  return { ...data, hooks };
}

function status(file, port) {
  const { exists, data } = readSettings(file);
  const events = [];
  for (const [event, groups] of Object.entries(data.hooks || {})) {
    if (!Array.isArray(groups)) continue;
    if (groups.some((g) => g && Array.isArray(g.hooks) && g.hooks.some(isOurs))) events.push(event);
  }
  const text = JSON.stringify(data.hooks || {});
  const stalePort = port != null && events.length > 0 && !text.includes(`127.0.0.1:${port}/hook?${brand.hookTag}`);
  return { exists, connected: events.length > 0, events, stalePort };
}

/** Vista previa: qué eventos se añadirán y qué archivo se tocará. No escribe nada. */
function preview(file, { port, token }) {
  const { exists, data } = readSettings(file);
  const next = buildNext(data, { port, token });
  return {
    file, exists,
    adds: Object.keys(EVENTS),
    keepsOtherHooks: Object.entries(next.hooks).filter(([e]) => !EVENTS[e]).map(([e]) => e),
    alreadyConnected: status(file, port).connected,
  };
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.isla-tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function backup(file, raw) {
  if (!raw) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = `${file}.isla-backup-${stamp}`;
  fs.writeFileSync(dest, raw);
  return dest;
}

function connect(file, { port, token }) {
  const { data, raw } = readSettings(file);
  const next = buildNext(data, { port, token });
  const backupFile = backup(file, raw);
  writeAtomic(file, JSON.stringify(next, null, 2) + '\n');
  return { file, backupFile, events: Object.keys(EVENTS) };
}

function disconnect(file) {
  const { exists, data, raw } = readSettings(file);
  if (!exists || !data.hooks) return { file, backupFile: null, removed: false };
  const before = JSON.stringify(data.hooks);
  const hooks = withoutOurs(data.hooks);
  if (JSON.stringify(hooks) === before) return { file, backupFile: null, removed: false };
  const next = { ...data };
  if (Object.keys(hooks).length) next.hooks = hooks; else delete next.hooks;
  const backupFile = backup(file, raw);
  writeAtomic(file, JSON.stringify(next, null, 2) + '\n');
  return { file, backupFile, removed: true };
}

module.exports = { EVENTS, defaultSettingsPath, preview, connect, disconnect, status, readSettings, isOurs };
