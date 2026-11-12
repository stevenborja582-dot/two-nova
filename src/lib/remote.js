'use strict';
// Control remoto desde el celular: un servidor pequeño dentro de la app.
// Seguridad (en este orden):
//  1) Apagado por defecto: solo corre si lo activas en el panel.
//  2) Solo acepta conexiones de tu red local, de Tailscale (100.64.0.0/10) o de la propia PC.
//  3) Emparejar pide un código de 6 cifras que vale 5 minutos y se quema tras 5 intentos fallidos.
//  4) Cada celular recibe su propio token; aquí solo se guarda su huella (hash). Se puede revocar.
//  5) Cada permiso (energía, archivos) se puede apagar por separado.
//  6) Apagar/reiniciar espera 30 segundos y se puede cancelar.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream');
const { Transform } = require('node:stream');

const DEFAULT_PORT = 47810;
const MAX_FILE = 1024 * 1024 * 1024; // 1 GB por archivo
const MAX_JSON = 20 * 1024;
const PAIR_TTL_MS = 5 * 60 * 1000;
const POWER_DELAY_SEC = 30;
const MAX_DEVICES = 8;

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const eq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/** ¿Esta dirección viene de un lugar permitido? (red local, Tailscale o la propia PC) */
function allowedAddress(addr) {
  let a = String(addr || '');
  if (a.startsWith('::ffff:')) a = a.slice(7);
  if (a === '::1' || a === '127.0.0.1') return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a);
  if (m) {
    const [o1, o2] = [Number(m[1]), Number(m[2])];
    if (o1 === 127 || o1 === 10) return true;
    if (o1 === 192 && o2 === 168) return true;
    if (o1 === 172 && o2 >= 16 && o2 <= 31) return true;
    if (o1 === 100 && o2 >= 64 && o2 <= 127) return true; // Tailscale
    return false;
  }
  const v6 = a.toLowerCase();
  return v6.startsWith('fe80:') || v6.startsWith('fd7a:115c:a1e0:') || /^f[cd][0-9a-f]{2}:/.test(v6);
}

/** Direcciones de esta PC que el celular podría usar (Tailscale primero). */
function localAddresses(interfaces = require('node:os').networkInterfaces()) {
  const out = [];
  for (const [name, list] of Object.entries(interfaces || {})) {
    for (const i of list || []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      const o = i.address.split('.').map(Number);
      const tailscale = o[0] === 100 && o[1] >= 64 && o[1] <= 127;
      out.push({ ip: i.address, label: tailscale ? 'Tailscale (desde cualquier lugar)' : 'Red local (mismo WiFi)', tailscale, iface: name });
    }
  }
  return out.sort((a, b) => Number(b.tailscale) - Number(a.tailscale));
}

/** Nombre de archivo seguro para Windows (sin rutas, sin caracteres raros). */
function safeName(name) {
  let n = String(name ?? '').replace(/[\\/]/g, '_').replace(/[<>:"|?*\u0000-\u001f]/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 120);
  if (!n || /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(n)) n = `archivo${n ? `-${n}` : ''}`;
  return n;
}

function uniquePath(dir, name) {
  const ext = path.extname(name); const base = path.basename(name, ext);
  let p = path.join(dir, name); let i = 2;
  while (fs.existsSync(p)) { p = path.join(dir, `${base} (${i})${ext}`); i++; }
  return p;
}

const POWER = {
  lock: { cmd: 'rundll32.exe', args: ['user32.dll,LockWorkStation'], text: 'Pantalla bloqueada.' },
  sleep: { cmd: 'rundll32.exe', args: ['powrprof.dll,SetSuspendState', '0', '1', '0'], text: 'Suspendiendo la PC.' },
  restart: { cmd: 'shutdown.exe', args: ['/r', '/t', String(POWER_DELAY_SEC), '/c', 'Two-Nova: reinicio pedido desde tu celular'], delay: true, text: `Reiniciando en ${POWER_DELAY_SEC} segundos.` },
  shutdown: { cmd: 'shutdown.exe', args: ['/s', '/t', String(POWER_DELAY_SEC), '/c', 'Two-Nova: apagado pedido desde tu celular'], delay: true, text: `Apagando en ${POWER_DELAY_SEC} segundos.` },
  cancel: { cmd: 'shutdown.exe', args: ['/a'], text: 'Apagado cancelado.' },
};

class RemoteControl {
  constructor({ store, inboxDir, outboxDir, trayFiles, clipboard, exec, notify = () => {}, hostname = 'PC', version = '', platform = process.platform, now = () => Date.now() }) {
    Object.assign(this, { store, inboxDir, outboxDir, trayFiles, clipboard, notify, hostname, version, platform, now });
    this.exec = exec;
    this.server = null;
    this.pairing = null; // { code, expires, tries }
    this.pending = null; // { action, at }
    this.lastSeenSave = new Map();
  }

  // ---------- estado guardado ----------
  cfg() {
    const c = this.store.getSetting('remote', {}) || {};
    return {
      enabled: !!c.enabled, port: Number(c.port) || DEFAULT_PORT,
      power: c.power !== false, files: c.files !== false,
      devices: Array.isArray(c.devices) ? c.devices : [],
    };
  }
  save(patch) { this.store.setSetting('remote', { ...this.cfg(), ...patch }); }

  view() {
    const c = this.cfg();
    return {
      enabled: c.enabled, running: !!this.server?.listening, port: c.port, power: c.power, files: c.files,
      devices: c.devices.map((d) => ({ id: d.id, name: d.name, created: d.created, lastSeen: d.lastSeen })),
      pairing: this.pairingView(), inbox: this.inboxDir, outbox: this.outboxDir,
    };
  }
  pairingView() {
    if (!this.pairing || this.pairing.expires <= this.now()) return null;
    return { code: this.pairing.code, expiresAt: this.pairing.expires };
  }

  setPermissions({ power, files }) {
    const patch = {};
    if (power !== undefined) patch.power = !!power;
    if (files !== undefined) patch.files = !!files;
    this.save(patch);
    return this.view();
  }

  // ---------- emparejar ----------
  startPairing() {
    if (!this.server?.listening) throw new Error('Primero activa el control remoto.');
    if (this.cfg().devices.length >= MAX_DEVICES) throw new Error(`Ya hay ${MAX_DEVICES} celulares emparejados. Quita alguno primero.`);
    this.pairing = { code: String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'), expires: this.now() + PAIR_TTL_MS, tries: 5 };
    return this.pairingView();
  }
  cancelPairing() { this.pairing = null; }

  completePairing(code, name) {
    const p = this.pairing;
    if (!p || p.expires <= this.now()) { this.pairing = null; return { error: 'No hay un emparejamiento activo. Pide un código nuevo en la PC.', status: 403 }; }
    if (!eq(String(code ?? ''), p.code)) {
      p.tries -= 1;
      if (p.tries <= 0) this.pairing = null;
      return { error: p.tries > 0 ? 'Código incorrecto.' : 'Demasiados intentos. Pide un código nuevo en la PC.', status: 403 };
    }
    this.pairing = null;
    const token = crypto.randomBytes(32).toString('hex');
    const device = { id: crypto.randomBytes(6).toString('hex'), name: String(name || 'Celular').replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 40) || 'Celular', hash: sha256(token), created: this.now(), lastSeen: this.now() };
    this.save({ devices: [...this.cfg().devices, device] });
    this.notify('paired', { name: device.name });
    return { token, device: { id: device.id, name: device.name } };
  }

  revoke(id) {
    this.save({ devices: this.cfg().devices.filter((d) => d.id !== id) });
    return this.view();
  }

  authenticate(header) {
    const m = /^Bearer ([0-9a-f]{64})$/.exec(String(header || ''));
    if (!m) return null;
    const h = sha256(m[1]);
    const c = this.cfg();
    const d = c.devices.find((x) => eq(x.hash, h));
    if (!d) return null;
    const t = this.now();
    if (t - (this.lastSeenSave.get(d.id) || 0) > 60_000) { this.lastSeenSave.set(d.id, t); this.save({ devices: c.devices.map((x) => (x.id === d.id ? { ...x, lastSeen: t } : x)) }); }
    return d;
  }

  // ---------- acciones ----------
  async power(action, device) {
    const spec = POWER[action];
    if (!spec) throw Object.assign(new Error('Acción no válida.'), { status: 400 });
    if (!this.cfg().power) throw Object.assign(new Error('El control de energía está apagado en la PC.'), { status: 403 });
    if (!this.exec && this.platform !== 'win32') throw Object.assign(new Error('Esto solo funciona en Windows.'), { status: 501 });
    if (action === 'cancel') this.pending = null;
    else if (spec.delay) this.pending = { action, at: this.now() + POWER_DELAY_SEC * 1000 };
    try { await this.run(spec.cmd, spec.args); } catch (e) { this.pending = null; throw Object.assign(new Error('Windows no pudo hacerlo.'), { status: 500 }); }
    this.notify('power', { action, delaySec: spec.delay ? POWER_DELAY_SEC : 0, device: device?.name || 'tu celular', text: spec.text });
    return { ok: true, text: spec.text, delaySec: spec.delay ? POWER_DELAY_SEC : 0 };
  }

  run(cmd, args) {
    if (this.exec) return this.exec(cmd, args);
    return new Promise((resolve, reject) => require('node:child_process').execFile(cmd, args, { windowsHide: true, timeout: 15000 }, (e) => (e ? reject(e) : resolve())));
  }

  listFiles() {
    const out = [];
    try {
      for (const f of fs.readdirSync(this.outboxDir, { withFileTypes: true })) {
        if (!f.isFile()) continue;
        const st = fs.statSync(path.join(this.outboxDir, f.name));
        out.push({ id: `o_${Buffer.from(f.name).toString('base64url')}`, name: f.name, size: st.size, source: 'carpeta' });
      }
    } catch { /* la carpeta aún no existe */ }
    for (const t of this.trayFiles?.list?.() || []) if (!t.missing && !t.dir) out.push({ id: `t_${t.id}`, name: t.name, size: t.size || 0, source: 'bandeja' });
    return out;
  }

  /** Busca por id (nunca por una ruta que mande el celular). */
  resolveFile(id) {
    const s = String(id || '');
    if (s.startsWith('o_')) {
      let name; try { name = Buffer.from(s.slice(2), 'base64url').toString('utf8'); } catch { return null; }
      if (!name || name !== path.basename(name)) return null;
      const p = path.join(this.outboxDir, name);
      return fs.existsSync(p) && fs.statSync(p).isFile() ? { path: p, name } : null;
    }
    if (s.startsWith('t_')) {
      const f = this.trayFiles?.find?.(s.slice(2));
      return f && !f.missing && fs.existsSync(f.path) && fs.statSync(f.path).isFile() ? { path: f.path, name: path.basename(f.path) } : null;
    }
    return null;
  }

  // ---------- servidor ----------
  start() {
    if (this.server) return Promise.resolve(this.view());
    const c = this.cfg();
    this.server = http.createServer((req, res) => this.handle(req, res).catch((e) => this.fail(res, e)));
    this.server.requestTimeout = 0; // las subidas grandes pueden tardar
    return new Promise((resolve, reject) => {
      this.server.once('error', (e) => { this.server = null; reject(new Error(e.code === 'EADDRINUSE' ? `El puerto ${c.port} ya está en uso.` : `No pude abrir el puerto: ${e.message}`)); });
      this.server.listen(c.port, '0.0.0.0', () => resolve(this.view()));
    });
  }
  stop() {
    this.pairing = null;
    const s = this.server; this.server = null;
    return new Promise((r) => { if (!s) return r(); s.closeAllConnections?.(); s.close(() => r()); });
  }
  address() { return this.server?.address?.() || null; }

  async setEnabled(on) {
    this.save({ enabled: !!on });
    if (on) await this.start(); else await this.stop();
    return this.view();
  }

  json(res, status, body) {
    const data = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data), 'cache-control': 'no-store' });
    res.end(data);
  }
  fail(res, e) {
    if (res.headersSent) { try { res.destroy(); } catch { /* */ } return; }
    if (e.status === 413) res.setHeader('connection', 'close');
    this.json(res, e.status || 500, { error: e.status ? e.message : 'Algo salió mal en la PC.' });
  }

  readJson(req) {
    return new Promise((resolve, reject) => {
      let n = 0; let over = false; const chunks = [];
      // Si se pasa del límite se responde 413 y se descarta lo que siga llegando (sin cortar el socket antes de contestar).
      req.on('data', (c) => { if (over) return; n += c.length; if (n > MAX_JSON) { over = true; chunks.length = 0; reject(Object.assign(new Error('Mensaje demasiado grande.'), { status: 413 })); } else chunks.push(c); });
      req.on('end', () => { if (over) return; try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('JSON no válido.'), { status: 400 })); } });
      req.on('error', reject);
    });
  }

  async handle(req, res) {
    // CORS: el celular usa token (no cookies), así que permitir el origen de la app es seguro.
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'authorization, content-type, x-filename');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    if (!allowedAddress(req.socket.remoteAddress)) return this.json(res, 403, { error: 'Esta red no está permitida.' });
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const url = new URL(req.url, 'http://x');
    const route = url.pathname;

    if (req.method === 'POST' && route === '/v1/pair') {
      const body = await this.readJson(req);
      const r = this.completePairing(body.code, body.name);
      if (r.error) return this.json(res, r.status, { error: r.error });
      return this.json(res, 200, { token: r.token, device: r.device, host: this.hostname });
    }

    const device = this.authenticate(req.headers.authorization);
    if (!device) return this.json(res, 401, { error: 'Este celular no está emparejado. Empareja de nuevo.' });
    const c = this.cfg();

    if (req.method === 'GET' && route === '/v1/status') {
      return this.json(res, 200, { host: this.hostname, platform: this.platform, version: this.version, time: this.now(), power: c.power, files: c.files, pending: this.pending && this.pending.at > this.now() ? this.pending : null });
    }
    if (req.method === 'POST' && route === '/v1/power') {
      const body = await this.readJson(req);
      return this.json(res, 200, await this.power(String(body.action || ''), device));
    }
    if (route === '/v1/clipboard' && req.method === 'POST') {
      if (!c.files) return this.json(res, 403, { error: 'El envío de archivos y texto está apagado en la PC.' });
      const body = await this.readJson(req);
      const text = typeof body.text === 'string' ? body.text.slice(0, 20000) : '';
      if (!text) return this.json(res, 400, { error: 'No hay texto.' });
      await this.clipboard.writeText(text);
      this.notify('text', { device: device.name, chars: text.length });
      return this.json(res, 200, { ok: true });
    }
    if (route === '/v1/files' && req.method === 'GET') {
      if (!c.files) return this.json(res, 403, { error: 'El envío de archivos está apagado en la PC.' });
      return this.json(res, 200, { files: this.listFiles() });
    }
    if (route === '/v1/files' && req.method === 'POST') {
      if (!c.files) return this.json(res, 403, { error: 'El envío de archivos está apagado en la PC.' });
      return this.receive(req, res, device);
    }
    const dl = /^\/v1\/files\/([A-Za-z0-9_-]{1,300})$/.exec(route);
    if (dl && req.method === 'GET') {
      if (!c.files) return this.json(res, 403, { error: 'El envío de archivos está apagado en la PC.' });
      const f = this.resolveFile(dl[1]);
      if (!f) return this.json(res, 404, { error: 'No encuentro ese archivo.' });
      const st = fs.statSync(f.path);
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': st.size, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}` });
      return pipeline(fs.createReadStream(f.path), res, () => {});
    }
    return this.json(res, 404, { error: 'Eso no existe.' });
  }

  receive(req, res, device) {
    let name;
    try { name = safeName(decodeURIComponent(String(req.headers['x-filename'] || ''))); } catch { name = safeName(''); }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_FILE) { res.setHeader('connection', 'close'); this.json(res, 413, { error: 'El archivo pesa más de 1 GB.' }); req.resume(); return Promise.resolve(); }
    fs.mkdirSync(this.inboxDir, { recursive: true });
    const tmp = path.join(this.inboxDir, `.recibiendo-${crypto.randomBytes(5).toString('hex')}.part`);
    let size = 0;
    const counter = new Transform({ transform: (chunk, _e, cb) => { size += chunk.length; if (size > MAX_FILE) cb(Object.assign(new Error('grande'), { status: 413 })); else cb(null, chunk); } });
    return new Promise((resolve) => {
      pipeline(req, counter, fs.createWriteStream(tmp, { flags: 'wx' }), (err) => {
        if (err) {
          fs.rmSync(tmp, { force: true });
          this.fail(res, err.status === 413 ? Object.assign(new Error('El archivo pesa más de 1 GB.'), { status: 413 }) : Object.assign(new Error('Se cortó la subida.'), { status: 400 }));
          return resolve();
        }
        if (size === 0) { fs.rmSync(tmp, { force: true }); this.json(res, 400, { error: 'El archivo está vacío.' }); return resolve(); }
        const dest = uniquePath(this.inboxDir, name);
        fs.renameSync(tmp, dest);
        this.notify('file', { device: device.name, name: path.basename(dest), size });
        this.json(res, 200, { ok: true, name: path.basename(dest), size });
        resolve();
      });
    });
  }
}

module.exports = { RemoteControl, allowedAddress, safeName, localAddresses, DEFAULT_PORT, POWER_DELAY_SEC, MAX_FILE };
