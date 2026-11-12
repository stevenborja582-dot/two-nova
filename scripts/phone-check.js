'use strict';
// Prueba la app del celular (phone/www) en un Chromium con pantalla de celular,
// contra un RemoteControl real (con comandos falsos). El sitio y la PC están en puertos distintos: así se prueba CORS.
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const http = require('node:http');
const { chromium } = require('playwright');
const { Store } = require('../src/lib/db');
const { TrayFiles } = require('../src/lib/trayFiles');
const { RemoteControl } = require('../src/lib/remote');

const out = process.argv[2] || path.join(os.tmpdir(), 'phone-shots'); fs.mkdirSync(out, { recursive: true });
const www = path.join(__dirname, '..', 'phone', 'www');
const freePort = () => new Promise((r) => { const s = http.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
let fails = 0; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-chk-'));
  const store = new Store(); const rport = await freePort(); store.setSetting('remote', { port: rport, enabled: true });
  const calls = []; const clip = [];
  const outbox = path.join(tmp, 'out'); fs.mkdirSync(outbox, { recursive: true }); fs.writeFileSync(path.join(outbox, 'apuntes.txt'), 'hola desde la PC');
  const r = new RemoteControl({ store, inboxDir: path.join(tmp, 'in'), outboxDir: outbox, trayFiles: new TrayFiles(store), clipboard: { writeText: async (t) => { clip.push(t); } }, exec: async (c, a) => { calls.push([c, ...a]); }, notify: () => {}, hostname: 'S1EVEN-PC', platform: 'win32', version: '0.4.0' });
  await r.start();
  const site = http.createServer((q, s) => { const f = path.join(www, q.url === '/' ? 'index.html' : q.url.split('?')[0]); if (!f.startsWith(www) || !fs.existsSync(f)) { s.writeHead(404).end(); return; } s.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }).end(fs.readFileSync(f)); });
  const sport = await freePort(); await new Promise((res) => site.listen(sport, '127.0.0.1', res));

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' && !/status of (401|403)/.test(m.text())) errors.push(m.text()); }); // 401/403 son los rechazos que provoco a propósito
  await page.goto(`http://127.0.0.1:${sport}/`);

  ok(await page.locator('#screen-pair').isVisible(), 'sin emparejar: se ve la pantalla de emparejar');
  await page.screenshot({ path: path.join(out, '1-emparejar.png') });

  // código malo
  await page.fill('#host', `127.0.0.1:${rport}`); await page.fill('#code', '000000'); await page.click('#pair-btn');
  await page.waitForFunction(() => /código|inválido|incorrecto|vencid/i.test(document.getElementById('pair-msg').textContent));
  ok(true, `código malo: «${await page.textContent('#pair-msg')}»`);
  await page.screenshot({ path: path.join(out, '2-codigo-malo.png') });

  // código bueno (la dirección sin puerto usa 47810, así que se escribe completa)
  const { code } = r.startPairing(); await page.fill('#code', code); await page.click('#pair-btn');
  await page.waitForSelector('#screen-main:not([hidden])');
  await page.waitForFunction(() => document.getElementById('host-state-text').textContent === 'Conectada');
  ok(await page.textContent('#host-name') === 'S1EVEN-PC', 'emparejó y muestra el nombre de la PC');
  ok(r.cfg().devices.length === 1, 'la PC registró el celular');
  await page.screenshot({ path: path.join(out, '3-control.png') });

  // normalizar dirección
  ok(await page.evaluate(() => window.__twonova.normalizeHost('http://100.64.1.2/')) === '100.64.1.2:47810', 'dirección sin puerto → 47810');
  ok(await page.evaluate(() => window.__twonova.normalizeHost('mal host!')) === '', 'dirección inválida se rechaza');

  // energía: bloquear
  await page.click('[data-power="lock"]'); ok(await page.locator('#sheet').isVisible(), 'pide confirmar antes de bloquear');
  await page.screenshot({ path: path.join(out, '4-confirmar.png') });
  await page.click('#sheet-no'); ok(calls.length === 0, 'No → no ejecuta nada');
  await page.click('[data-power="lock"]'); await page.click('#sheet-yes');
  await page.waitForFunction(() => !document.getElementById('toast').hidden);
  ok(calls.length === 1, `Sí → ejecuta bloquear (${calls[0] && calls[0].join(' ')})`);

  // apagar con cuenta regresiva y cancelar
  await page.click('[data-power="shutdown"]'); await page.click('#sheet-yes');
  await page.waitForSelector('#pending:not([hidden])');
  ok(/Apagando/.test(await page.textContent('#pending-title')) && /\d+ segundos/.test(await page.textContent('#pending-sub')), `aviso de apagado: «${await page.textContent('#pending-sub')}»`);
  await page.screenshot({ path: path.join(out, '5-apagando.png') });
  await page.click('#pending-cancel'); await page.waitForSelector('#pending', { state: 'hidden' });
  ok(!r.pending, 'cancelar quita el apagado pendiente');

  // archivos: subir
  await page.click('#nav-files');
  const up = path.join(tmp, 'tarea.txt'); fs.writeFileSync(up, 'contenido de prueba');
  await page.setInputFiles('#file-input', up);
  await page.waitForFunction(() => /enviado/.test(document.getElementById('uploads').textContent));
  const got = fs.readdirSync(path.join(tmp, 'in'));
  ok(got.includes('tarea.txt') && fs.readFileSync(path.join(tmp, 'in', 'tarea.txt'), 'utf8') === 'contenido de prueba', 'el archivo subido llegó completo a la PC');
  // texto
  await page.fill('#text-input', 'enlace importante'); await page.click('#text-send');
  await page.waitForFunction(() => /portapapeles/.test(document.getElementById('toast').textContent));
  ok(clip[0] === 'enlace importante', 'el texto llegó al portapapeles de la PC');
  // bajar
  await page.click('#files-refresh'); await page.waitForSelector('#remote-files li');
  ok(/apuntes\.txt/.test(await page.textContent('#remote-files')), 'lista los archivos de la PC');
  await page.screenshot({ path: path.join(out, '6-archivos.png'), fullPage: false });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#remote-files .btn')]);
  ok(fs.readFileSync(await dl.path(), 'utf8') === 'hola desde la PC', 'bajar un archivo de la PC funciona (modo navegador)');

  // ajustes
  await page.click('#nav-settings'); ok(/0\.4\.0/.test(await page.textContent('#set-version')), 'ajustes muestra la versión');
  await page.screenshot({ path: path.join(out, '7-ajustes.png') });

  // recarga: sigue emparejado
  await page.reload(); await page.waitForSelector('#screen-main:not([hidden])'); ok(true, 'tras recargar sigue emparejado');

  // desde la PC se revoca → el celular vuelve a emparejar
  r.revoke(r.cfg().devices[0].id);
  await page.waitForSelector('#screen-pair:not([hidden])', { timeout: 9000 }); ok(true, 'si la PC lo desempareja, el celular vuelve a pedir código');

  // sin horizontal scroll y objetivos táctiles
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth); ok(!overflow, 'sin scroll horizontal');
  ok(errors.length === 0, `sin errores de consola${errors.length ? ': ' + errors.join(' | ') : ''}`);

  // PC apagada → "sin conexión"
  const { code: c2 } = r.startPairing(); await page.fill('#host', `127.0.0.1:${rport}`); await page.fill('#code', c2); await page.click('#pair-btn');
  await page.waitForSelector('#screen-main:not([hidden])'); r.stop();
  await page.waitForFunction(() => /Sin conexión/.test(document.getElementById('host-state-text').textContent), null, { timeout: 12000 });
  ok(true, 'si la PC se apaga, la app lo dice'); await page.screenshot({ path: path.join(out, '8-sin-conexion.png') });

  await browser.close(); site.close();
  console.log(fails ? `\n${fails} fallos` : '\nTodo bien'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
