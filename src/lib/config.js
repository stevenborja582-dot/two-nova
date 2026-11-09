'use strict';
// Configuración de la app (puerto, token, opciones). Vive en la carpeta de datos de la app.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const brand = require('../brand');

const DEFAULTS = {
  port: brand.defaultPort,
  token: null,
  sound: true,
  nativeNotifications: true,
  capture: false, // modo grabación: guarda payloads enmascarados para aprender el formato real
  autoStart: false,
  permissionTimeoutSec: 100,
};

function load(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'config.json');
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* primera vez */ }
  cfg = { ...DEFAULTS, ...cfg };
  if (!cfg.token || cfg.token.length < 32) cfg.token = crypto.randomBytes(24).toString('hex');
  save(dir, cfg);
  return cfg;
}

function save(dir, cfg) {
  const file = path.join(dir, 'config.json');
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

module.exports = { load, save, DEFAULTS };
