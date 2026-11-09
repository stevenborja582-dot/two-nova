'use strict';
// Servidor local que recibe los avisos de Claude Code.
// Solo escucha en 127.0.0.1, exige un token y rechaza peticiones de navegadores.
const http = require('node:http');
const crypto = require('node:crypto');

const MAX_BODY = 1_000_000;

function tokenOk(received, expected) {
  if (typeof received !== 'string') return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createHookServer({ core, token, port, appName = 'isla' }) {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  const server = http.createServer((req, res) => {
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
      res.end(body);
    };

    // Defensa contra páginas web (DNS rebinding y peticiones entre sitios)
    if (!allowedHosts.has(String(req.headers.host || '').toLowerCase())) return send(403, 'host no permitido');
    if (req.headers.origin) return send(403, 'origen no permitido');

    const url = new URL(req.url, 'http://127.0.0.1');

    if (req.method === 'GET' && url.pathname === '/health') {
      return send(200, JSON.stringify({ ok: true, app: appName }), { 'Content-Type': 'application/json' });
    }

    if (req.method === 'POST' && url.pathname === '/hook') {
      if (!tokenOk(req.headers['x-island-token'], token)) return send(401, 'token inválido');

      const chunks = [];
      let size = 0;
      let aborted = false;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { aborted = true; send(413, 'demasiado grande'); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('error', () => { aborted = true; });
      req.on('end', async () => {
        if (aborted) return;
        let payload;
        try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, 'JSON inválido'); }

        let closedEarly = false;
        res.on('close', () => { closedEarly = !res.writableEnded; });

        try {
          const pendingBefore = new Set(core.pending.keys());
          const answer = core.handleHook(payload);
          // Si Claude Code corta la conexión (respondiste en la terminal), se retira la petición.
          const onClose = () => {
            if (!closedEarly) return;
            for (const id of core.pending.keys()) if (!pendingBefore.has(id)) core.abandon(id);
          };
          res.on('close', onClose);
          const decision = await answer;
          if (closedEarly || res.writableEnded) return;
          if (decision) return send(200, JSON.stringify(decision), { 'Content-Type': 'application/json' });
          return send(200, ''); // 2xx vacío = sin decisión: Claude Code pregunta como siempre
        } catch (e) {
          if (res.writableEnded) return;
          return send(e.status || 500, e.status ? String(e.message) : 'error interno');
        }
      });
      return;
    }

    return send(404, 'no existe');
  });

  server.requestTimeout = 0; // los permisos esperan decisión; el tiempo lo controla el núcleo
  server.headersTimeout = 10_000;

  return {
    server,
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    }),
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
    address: () => server.address(),
  };
}

module.exports = { createHookServer };
