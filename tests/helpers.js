'use strict';
const http = require('node:http');
const { Store } = require('../src/lib/db');
const { Core } = require('../src/lib/core');
const { createHookServer } = require('../src/lib/hookServer');

async function startApp({ timeoutMs = 2000 } = {}) {
  const store = new Store();
  const core = new Core({ store, permissionTimeoutMs: timeoutMs });
  const token = 'a'.repeat(48);
  // puerto 0 no sirve porque el Host debe coincidir: se busca uno libre primero
  const port = await freePort();
  const srv = createHookServer({ core, token, port });
  await srv.listen();
  return { store, core, token, port, srv, stop: async () => { core.shutdown(); await srv.close(); store.close(); } };
}

function freePort() {
  return new Promise((resolve) => {
    const s = http.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

function request({ port, method = 'POST', path = '/hook', headers = {}, body, host }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { ...(host ? { Host: host } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
    req.__req = req;
    resolve.req = req;
  });
}

const hook = (app, payload, extra = {}) => request({
  port: app.port,
  headers: { 'Content-Type': 'application/json', 'X-Island-Token': app.token, ...extra },
  body: payload,
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 1500) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await wait(10); } return false; };

module.exports = { startApp, request, hook, wait, until };
