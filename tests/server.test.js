'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startApp, request, hook, wait, until } = require('./helpers');

const permPayload = (over = {}) => ({
  hook_event_name: 'PermissionRequest', session_id: 's1', cwd: '/proy',
  tool_name: 'Bash', tool_input: { command: 'npm install' }, tool_use_id: 'toolu_1', ...over,
});

test('health responde sin token pero solo desde host local', async () => {
  const app = await startApp();
  try {
    const ok = await request({ port: app.port, method: 'GET', path: '/health' });
    assert.equal(ok.status, 200);
    const bad = await request({ port: app.port, method: 'GET', path: '/health', host: 'evil.com' });
    assert.equal(bad.status, 403);
  } finally { await app.stop(); }
});

test('rechaza sin token, con token malo, con Origin y con JSON inválido', async () => {
  const app = await startApp();
  try {
    assert.equal((await request({ port: app.port, body: {}, headers: { 'Content-Type': 'application/json' } })).status, 401);
    assert.equal((await request({ port: app.port, body: {}, headers: { 'X-Island-Token': 'x'.repeat(48) } })).status, 401);
    assert.equal((await hook(app, {}, { Origin: 'https://evil.com' })).status, 403);
    assert.equal((await request({ port: app.port, body: '{no json', headers: { 'X-Island-Token': app.token } })).status, 400);
    assert.equal((await hook(app, { sin: 'evento' })).status, 400);
    assert.equal((await request({ port: app.port, method: 'GET', path: '/otra' })).status, 404);
  } finally { await app.stop(); }
});

test('rechaza cuerpos enormes', async () => {
  const app = await startApp();
  try {
    const r = await request({ port: app.port, headers: { 'X-Island-Token': app.token }, body: 'x'.repeat(1_200_000) }).catch((e) => ({ status: 'cortado', e }));
    assert.ok(r.status === 413 || r.status === 'cortado');
  } finally { await app.stop(); }
});

test('eventos de estado devuelven vacío y actualizan la isla', async () => {
  const app = await startApp();
  try {
    const r = await hook(app, { hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Edit', tool_input: { file_path: 'a.js' }, tool_use_id: 't1' });
    assert.equal(r.status, 200);
    assert.equal(r.text, '');
    assert.equal(app.core.view().state, 'working');
    await hook(app, { hook_event_name: 'Stop', session_id: 's1', last_assistant_message: 'Listo, terminé.' });
    assert.equal(app.core.view().state, 'done');
    assert.equal(app.core.view().latest.lastMessage, 'Listo, terminé.');
  } finally { await app.stop(); }
});

test('permiso: Permitir desde la isla devuelve allow', async () => {
  const app = await startApp();
  try {
    const p = hook(app, permPayload());
    assert.ok(await until(() => app.core.pending.size === 1));
    const [req] = app.core.pendingList();
    assert.equal(req.risk, 'medium');
    assert.equal(app.core.view().state, 'permission');
    app.core.decide(req.id, 'allow');
    const r = await p;
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.text).hookSpecificOutput.decision, { behavior: 'allow' });
    assert.equal(app.store.recentPermissions()[0].status, 'allowed');
  } finally { await app.stop(); }
});

test('permiso: Negar devuelve deny con mensaje', async () => {
  const app = await startApp();
  try {
    const p = hook(app, permPayload({ tool_input: { command: 'rm -rf build' }, tool_use_id: 'toolu_2' }));
    assert.ok(await until(() => app.core.pending.size === 1));
    const [req] = app.core.pendingList();
    assert.equal(req.risk, 'high');
    app.core.decide(req.id, 'deny', 'No quiero borrar eso');
    const d = JSON.parse((await p).text).hookSpecificOutput.decision;
    assert.equal(d.behavior, 'deny');
    assert.equal(d.message, 'No quiero borrar eso');
  } finally { await app.stop(); }
});

test('FAIL-SAFE: si no respondes a tiempo, respuesta vacía (Claude Code pregunta normal)', async () => {
  const app = await startApp({ timeoutMs: 120 });
  try {
    const r = await hook(app, permPayload({ tool_use_id: 'toolu_3' }));
    assert.equal(r.status, 200);
    assert.equal(r.text, '');
    assert.equal(app.store.recentPermissions()[0].status, 'fallback');
    assert.equal(app.core.pending.size, 0);
  } finally { await app.stop(); }
});

test('FAIL-SAFE: al cerrar la app, lo pendiente vuelve sin decisión', async () => {
  const app = await startApp();
  const p = hook(app, permPayload({ tool_use_id: 'toolu_4' }));
  assert.ok(await until(() => app.core.pending.size === 1));
  app.core.shutdown();
  const r = await p;
  assert.equal(r.text, '');
  await app.stop();
});

test('si Claude Code corta la conexión, la petición sale de la isla', async () => {
  const app = await startApp();
  try {
    const req = http.request({ host: '127.0.0.1', port: app.port, method: 'POST', path: '/hook',
      headers: { 'Content-Type': 'application/json', 'X-Island-Token': app.token } });
    req.on('error', () => {});
    req.end(JSON.stringify(permPayload({ tool_use_id: 'toolu_5' })));
    assert.ok(await until(() => app.core.pending.size === 1));
    req.destroy();
    assert.ok(await until(() => app.core.pending.size === 0), 'la petición debía retirarse');
    assert.equal(app.store.recentPermissions()[0].status, 'fallback');
  } finally { await app.stop(); }
});

test('la misma llamada repetida comparte decisión y no duplica', async () => {
  const app = await startApp();
  try {
    const a = hook(app, permPayload({ tool_use_id: 'toolu_6' }));
    assert.ok(await until(() => app.core.pending.size === 1));
    const b = hook(app, permPayload({ tool_use_id: 'toolu_6' }));
    await wait(50);
    assert.equal(app.core.pending.size, 1);
    app.core.decide(app.core.pendingList()[0].id, 'allow');
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(JSON.parse(ra.text).hookSpecificOutput.decision.behavior, 'allow');
    assert.equal(JSON.parse(rb.text).hookSpecificOutput.decision.behavior, 'allow');
    assert.equal(app.store.recentPermissions().length, 1);
  } finally { await app.stop(); }
});

test('varias peticiones a la vez se resuelven por separado', async () => {
  const app = await startApp();
  try {
    const a = hook(app, permPayload({ tool_use_id: 'a1', tool_input: { command: 'npm test' } }));
    const b = hook(app, permPayload({ tool_use_id: 'b1', tool_input: { command: 'npm run build' } }));
    assert.ok(await until(() => app.core.pending.size === 2));
    const [pa, pb] = app.core.pendingList();
    app.core.decide(pa.id, 'allow');
    app.core.decide(pb.id, 'deny');
    const results = (await Promise.all([a, b])).map((r) => JSON.parse(r.text).hookSpecificOutput.decision.behavior).sort();
    assert.deepEqual(results, ['allow', 'deny']);
  } finally { await app.stop(); }
});

test('decidir dos veces o un id falso no hace nada', async () => {
  const app = await startApp();
  try {
    assert.equal(app.core.decide('no-existe', 'allow'), false);
    const p = hook(app, permPayload({ tool_use_id: 'x9' }));
    assert.ok(await until(() => app.core.pending.size === 1));
    const id = app.core.pendingList()[0].id;
    assert.equal(app.core.decide(id, 'allow'), true);
    assert.equal(app.core.decide(id, 'deny'), false);
    await p;
  } finally { await app.stop(); }
});

test('los secretos no llegan a la base de datos', async () => {
  const app = await startApp();
  try {
    await hook(app, { hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Bash',
      tool_input: { command: 'curl -H "Authorization: Bearer abcdefghijklmnop12345" https://x' }, tool_use_id: 'sec1' });
    const rows = app.store.recentEvents('s1');
    assert.ok(!JSON.stringify(rows).includes('abcdefghijklmnop'));
  } finally { await app.stop(); }
});
