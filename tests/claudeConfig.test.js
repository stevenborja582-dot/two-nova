'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cc = require('../src/lib/claudeConfig');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'isla-')), '.claude', 'settings.json');
const opts = { port: 47653, token: 't'.repeat(48) };

test('conectar crea el archivo si no existe y desconectar lo deja sin hooks', () => {
  const f = tmp();
  const r = cc.connect(f, opts);
  assert.equal(r.backupFile, null);
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.deepEqual(Object.keys(data.hooks).sort(), Object.keys(cc.EVENTS).sort());
  assert.equal(data.hooks.PermissionRequest[0].hooks[0].type, 'http');
  assert.equal(cc.status(f, opts.port).connected, true);
  cc.disconnect(f);
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).hooks, undefined);
  assert.equal(cc.status(f, opts.port).connected, false);
});

test('conserva tu configuración y tus hooks, y hace respaldo', () => {
  const f = tmp();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const original = {
    model: 'sonnet', permissions: { allow: ['Bash(ls:*)'] },
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: 'echo listo' }] }],
      PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'prettier' }] }],
    },
  };
  fs.writeFileSync(f, JSON.stringify(original));
  const r = cc.connect(f, opts);
  assert.ok(r.backupFile && fs.existsSync(r.backupFile));
  assert.deepEqual(JSON.parse(fs.readFileSync(r.backupFile, 'utf8')), original);
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.equal(data.model, 'sonnet');
  assert.deepEqual(data.permissions, original.permissions);
  assert.equal(data.hooks.Stop.length, 2); // el tuyo + el de la app
  assert.deepEqual(data.hooks.PostToolUse, original.hooks.PostToolUse);
  cc.disconnect(f);
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), original);
});

test('conectar dos veces no duplica', () => {
  const f = tmp();
  cc.connect(f, opts);
  cc.connect(f, { ...opts, port: 50000 });
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const ev of Object.keys(cc.EVENTS)) assert.equal(data.hooks[ev].length, 1);
  assert.ok(data.hooks.Stop[0].hooks[0].url.includes(':50000/'));
});

test('un archivo que no es JSON válido no se toca', () => {
  const f = tmp();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const raw = '{ // comentario\n "model": "x" }';
  fs.writeFileSync(f, raw);
  assert.throws(() => cc.connect(f, opts), /No lo toqué/);
  assert.equal(fs.readFileSync(f, 'utf8'), raw);
});

test('desconectar sin nada conectado no modifica el archivo', () => {
  const f = tmp();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, '{"model":"x"}');
  const r = cc.disconnect(f);
  assert.equal(r.removed, false);
  assert.equal(fs.readFileSync(f, 'utf8'), '{"model":"x"}');
});

test('vista previa no escribe nada', () => {
  const f = tmp();
  const p = cc.preview(f, opts);
  assert.equal(p.exists, false);
  assert.ok(!fs.existsSync(f));
  assert.ok(p.adds.includes('PermissionRequest'));
});

test('nunca se usa SessionStart con http', () => {
  assert.ok(!('SessionStart' in cc.EVENTS));
});
