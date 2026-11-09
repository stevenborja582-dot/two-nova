#!/usr/bin/env node
'use strict';
// Conectar o desconectar Claude Code desde la terminal (sin abrir la app).
//   npm run conectar      npm run desconectar      npm run estado
const path = require('node:path');
const os = require('node:os');
const cfgLib = require('../src/lib/config');
const cc = require('../src/lib/claudeConfig');
const brand = require('../src/brand');

const dataDir = process.env.ISLA_DATA_DIR
  || path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), brand.appName);
const file = process.env.CLAUDE_SETTINGS || cc.defaultSettingsPath();
const cmd = process.argv[2] || 'estado';

try {
  const cfg = cfgLib.load(dataDir);
  if (cmd === 'conectar') {
    const p = cc.preview(file, cfg);
    console.log(`Voy a añadir avisos de ${brand.appName} en: ${p.file}`);
    console.log(`Eventos: ${p.adds.join(', ')}`);
    console.log('Se hace una copia de respaldo antes. Tus otras configuraciones no se tocan.');
    const r = cc.connect(file, cfg);
    console.log(`Listo. Respaldo: ${r.backupFile || '(no había archivo previo)'}`);
    console.log('Abre Claude Code de nuevo para que lea la configuración.');
  } else if (cmd === 'desconectar') {
    const r = cc.disconnect(file);
    console.log(r.removed ? `Quité las entradas de ${brand.appName}. Respaldo: ${r.backupFile}` : 'No había nada que quitar.');
  } else {
    const s = cc.status(file, cfg.port);
    console.log(s.connected ? `Conectado (${s.events.join(', ')})` : 'No conectado');
    if (s.stalePort) console.log('Aviso: el puerto guardado en Claude Code no coincide con el de la app. Vuelve a conectar.');
    console.log(`Archivo: ${file}`);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
