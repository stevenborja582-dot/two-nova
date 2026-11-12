'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { Store } = require('../src/lib/db');
const { TrayFiles } = require('../src/lib/trayFiles');
const { RemoteControl, allowedAddress, safeName } = require('../src/lib/remote');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nova-remote-'));
const freePort = () => new Promise((r) => { const s = http.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

async function mk(extra = {}) {
  const store = new Store();
  const port = await freePort();
  store.setSetting('remote', { port, enabled: true });
  const dir = tmp();
  const calls = []; const notes = []; const clip = [];
  const r = new RemoteControl({
    store, inboxDir: path.join(dir, 'in'), outboxDir: path.join(dir, 'out'), trayFiles: new TrayFiles(store),
    clipboard: { writeText: async (t) => { clip.push(t); } }, exec: async (cmd, args) => { calls.push([cmd, ...args]); },
    notify: (k, d) => notes.push([k, d]), hostname: 'PC-TEST', platform: 'win32', ...extra,
  });
  await r.start();
  const call = (method, p, { token, body, headers = {}, raw } = {}) => new Promise((resolve, reject) => {
    const data = raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(data !== undefined ? { 'content-length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      const ch = []; res.on('data', (c) => ch.push(c));
      res.on('end', () => { const buf = Buffer.concat(ch); let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch { /* binario */ } resolve({ status: res.statusCode, json, buf, headers: res.headers }); });
    });
    req.on('error', reject); if (data !== undefined) req.write(data); req.end();
  });
  const pair = async (name = 'Honor X7a') => { const { code } = r.startPairing(); const res = await call('POST', '/v1/pair', { body: { code, name } }); return res.json.token; };
  return { r, call, pair, dir, calls, notes, clip, store, stop: () => r.stop() };
}

test('red: solo local, Tailscale y la propia PC', () => {
  for (const ok of ['127.0.0.1', '::1', '::ffff:192.168.1.20', '10.0.0.5', '172.16.4.4', '172.31.9.9', '100.64.0.1', '100.101.102.103', '100.127.255.255', 'fe80::1', 'fd7a:115c:a1e0::1']) assert.ok(allowedAddress(ok), ok);
  for (const bad of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '100.63.0.1', '11.0.0.1', '2001:db8::1', '', undefined]) assert.ok(!allowedAddress(bad), String(bad));
});

test('nombres de archivo: sin rutas ni caracteres peligrosos', () => {
  assert.equal(safeName('../../Windows/system32/x.dll'), '.._.._Windows_system32_x.dll'.replace(/^\.+/, ''));
  assert.equal(safeName('foto: <1>.jpg'), 'foto_ _1_.jpg');
  assert.equal(safeName('CON.txt'), 'archivo-CON.txt');
  assert.equal(safeName(''), 'archivo');
  assert.ok(safeName('a'.repeat(500)).length <= 120);
});

test('emparejar: código bueno da token; sin emparejar todo da 401; el token no se guarda', async () => {
  const t = await mk();
  try {
    assert.equal((await t.call('GET', '/v1/status')).status, 401);
    assert.equal((await t.call('GET', '/v1/status', { token: 'a'.repeat(64) })).status, 401);
    const token = await t.pair();
    assert.match(token, /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(t.store.getSetting('remote')).includes(token));
    const s = await t.call('GET', '/v1/status', { token });
    assert.equal(s.status, 200); assert.equal(s.json.host, 'PC-TEST');
    assert.equal(t.r.view().devices.length, 1);
    assert.deepEqual(t.notes[0], ['paired', { name: 'Honor X7a' }]);
    // el código ya no sirve una segunda vez
    assert.equal((await t.call('POST', '/v1/pair', { body: { code: '000000', name: 'x' } })).status, 403);
  } finally { await t.stop(); }
});

test('emparejar: 5 intentos malos queman el código; vence a los 5 minutos', async () => {
  let clock = 1_000_000;
  const t = await mk({ now: () => clock });
  try {
    const { code } = t.r.startPairing();
    const wrong = code === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) assert.equal((await t.call('POST', '/v1/pair', { body: { code: wrong, name: 'x' } })).status, 403);
    const late = await t.call('POST', '/v1/pair', { body: { code, name: 'x' } });
    assert.equal(late.status, 403); assert.match(late.json.error, /No hay un emparejamiento/);
    const { code: c2 } = t.r.startPairing();
    clock += 5 * 60 * 1000 + 1;
    assert.equal((await t.call('POST', '/v1/pair', { body: { code: c2, name: 'x' } })).status, 403);
    assert.equal(t.r.pairingView(), null);
  } finally { await t.stop(); }
});

test('emparejar: no se puede pedir código con el control apagado ni pasar de 8 celulares; revocar corta el acceso', async () => {
  const t = await mk();
  try {
    const token = await t.pair();
    assert.equal((await t.call('GET', '/v1/status', { token })).status, 200);
    t.r.revoke(t.r.view().devices[0].id);
    assert.equal((await t.call('GET', '/v1/status', { token })).status, 401);
    for (let i = 0; i < 8; i++) await t.pair(`cel ${i}`);
    assert.throws(() => t.r.startPairing(), /Ya hay 8/);
  } finally { await t.stop(); }
  const off = await mk(); await off.stop();
  assert.throws(() => off.r.startPairing(), /activa el control remoto/);
});

test('energía: apagar y reiniciar esperan 30 s, se pueden cancelar; bloquear es inmediato; respeta el permiso', async () => {
  const t = await mk();
  try {
    const token = await t.pair();
    const p = (action) => t.call('POST', '/v1/power', { token, body: { action } });
    let r = await p('shutdown');
    assert.equal(r.status, 200); assert.equal(r.json.delaySec, 30);
    assert.deepEqual(t.calls.at(-1).slice(0, 4), ['shutdown.exe', '/s', '/t', '30']);
    assert.equal((await t.call('GET', '/v1/status', { token })).json.pending.action, 'shutdown');
    r = await p('cancel');
    assert.deepEqual(t.calls.at(-1), ['shutdown.exe', '/a']);
    assert.equal((await t.call('GET', '/v1/status', { token })).json.pending, null);
    await p('restart'); assert.equal(t.calls.at(-1)[1], '/r');
    await p('lock'); assert.equal(t.calls.at(-1)[0], 'rundll32.exe');
    await p('sleep'); assert.ok(t.calls.at(-1).includes('powrprof.dll,SetSuspendState'));
    assert.equal((await p('formatear')).status, 400);
    assert.equal(t.notes.filter((n) => n[0] === 'power').length, 5);
    t.r.setPermissions({ power: false });
    const n = t.calls.length;
    assert.equal((await p('shutdown')).status, 403);
    assert.equal(t.calls.length, n);
  } finally { await t.stop(); }
});

test('archivos: el celular manda un archivo, se guarda sin pisar otros y con nombre seguro', async () => {
  const t = await mk();
  try {
    const token = await t.pair();
    const up = (name, content) => t.call('POST', '/v1/files', { token, raw: content, headers: { 'x-filename': encodeURIComponent(name), 'content-type': 'application/octet-stream' } });
    const a = await up('Tarea de redes.pdf', 'contenido A');
    assert.equal(a.status, 200); assert.equal(a.json.name, 'Tarea de redes.pdf');
    const b = await up('Tarea de redes.pdf', 'contenido B');
    assert.equal(b.json.name, 'Tarea de redes (2).pdf');
    assert.equal(fs.readFileSync(path.join(t.dir, 'in', 'Tarea de redes.pdf'), 'utf8'), 'contenido A');
    const evil = await up('..\\..\\Windows\\evil.bat', 'x');
    assert.equal(evil.status, 200);
    assert.ok(fs.existsSync(path.join(t.dir, 'in', evil.json.name)) && !evil.json.name.includes('..\\'));
    assert.equal((await up('vacio.txt', '')).status, 400);
    assert.deepEqual(fs.readdirSync(path.join(t.dir, 'in')).filter((f) => f.endsWith('.part')), []);
    assert.equal(t.notes.filter((n) => n[0] === 'file').length, 3);
    t.r.setPermissions({ files: false });
    assert.equal((await up('x.txt', 'x')).status, 403);
  } finally { await t.stop(); }
});

test('archivos: el celular baja lo de la carpeta "para el cel" y de la bandeja, solo por id', async () => {
  const t = await mk();
  try {
    const token = await t.pair();
    fs.mkdirSync(path.join(t.dir, 'out'), { recursive: true });
    fs.writeFileSync(path.join(t.dir, 'out', 'foto.png'), 'PNGDATA');
    const secret = path.join(t.dir, 'secreto.txt'); fs.writeFileSync(secret, 'no me muestres');
    const tray = path.join(t.dir, 'bandeja.txt'); fs.writeFileSync(tray, 'de la bandeja');
    new TrayFiles(t.store).add([tray]);
    const list = (await t.call('GET', '/v1/files', { token })).json.files;
    assert.deepEqual(list.map((f) => f.name).sort(), ['bandeja.txt', 'foto.png']);
    for (const f of list) {
      const d = await t.call('GET', `/v1/files/${f.id}`, { token });
      assert.equal(d.status, 200); assert.equal(d.buf.toString(), f.name === 'foto.png' ? 'PNGDATA' : 'de la bandeja');
      assert.match(d.headers['content-disposition'], /attachment/);
    }
    // ids inventados o intentos de salir de la carpeta
    const evilId = `o_${Buffer.from('../secreto.txt').toString('base64url')}`;
    assert.equal((await t.call('GET', `/v1/files/${evilId}`, { token })).status, 404);
    assert.equal((await t.call('GET', '/v1/files/t_noexiste', { token })).status, 404);
    assert.equal((await t.call('GET', `/v1/files/${encodeURIComponent(secret)}`, { token })).status, 404);
    assert.equal((await t.call('GET', '/v1/files/o_x')).status, 401);
  } finally { await t.stop(); }
});

test('texto: llega al portapapeles de la PC; límite de tamaño; JSON malo', async () => {
  const t = await mk();
  try {
    const token = await t.pair();
    assert.equal((await t.call('POST', '/v1/clipboard', { token, body: { text: 'hola desde el cel' } })).status, 200);
    assert.deepEqual(t.clip, ['hola desde el cel']);
    assert.equal((await t.call('POST', '/v1/clipboard', { token, body: { text: '' } })).status, 400);
    assert.equal((await t.call('POST', '/v1/clipboard', { token, raw: '{no json' })).status, 400);
    assert.equal((await t.call('POST', '/v1/clipboard', { token, raw: JSON.stringify({ text: 'x'.repeat(30000) }) })).status, 413);
    assert.equal((await t.call('GET', '/v1/nada', { token })).status, 404);
  } finally { await t.stop(); }
});

test('activar y apagar: el servidor se abre y se cierra, y recuerda el permiso de cada cosa', async () => {
  const t = await mk();
  try {
    assert.equal(t.r.view().running, true);
    await t.r.setEnabled(false);
    assert.equal(t.r.view().running, false); assert.equal(t.r.view().enabled, false);
    await t.r.setEnabled(true);
    assert.equal(t.r.view().running, true);
    t.r.setPermissions({ files: false });
    assert.deepEqual([t.r.view().power, t.r.view().files], [true, false]);
  } finally { await t.stop(); }
});
