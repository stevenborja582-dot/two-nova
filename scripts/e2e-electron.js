// Prueba de punta a punta con la app real (Electron) y Claude Code simulado por HTTP.
// Uso (Linux): xvfb-run -a node scripts/e2e-electron.js <carpeta-de-capturas>
const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const apiCalls = [];
const fakeApi = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => {
    const gemini = req.url.includes(':generateContent');
    apiCalls.push({ gemini, url: req.url, key: req.headers['x-goog-api-key'] || req.headers['x-api-key'], body: JSON.parse(b || '{}') });
    res.writeHead(200, { 'content-type': 'application/json' });
    const text = 'Claro, aquí estoy. Dime en qué te ayudo con tu proyecto.';
    res.end(JSON.stringify(gemini
      ? { candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 24 } }
      : { content: [{ type: 'text', text }], usage: { input_tokens: 120, output_tokens: 24 } })); });
});

const shots = process.argv[2] || os.tmpdir();
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'isla-e2e-'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'isla-home-'));
const port = 47900 + Math.floor(Math.random() * 90);
const token = 'e'.repeat(48);
fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({ port, token, askedConnect: true, sound: false, nativeNotifications: false, permissionTimeoutSec: 8 }));

const post = (payload, timeout = 15000) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path: '/hook', method: 'POST', timeout,
    headers: { 'Content-Type': 'application/json', 'X-Island-Token': token } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, text: t }));
  });
  req.on('error', reject); req.end(JSON.stringify(payload));
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((r) => fakeApi.listen(0, '127.0.0.1', r));
  const app = await electron.launch({
    executablePath: require('electron'),
    args: ['.', '--no-sandbox', '--password-store=basic', `--user-data-dir=${data}`],
    env: { ...process.env, TWO_NOVA_TEST_FAKE_CRYPTO: '1', TWO_NOVA_API_BASE: `http://127.0.0.1:${fakeApi.address().port}`, TWO_NOVA_GEMINI_BASE: `http://127.0.0.1:${fakeApi.address().port}`, HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData') },
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await wait(1500);
  const state = () => win.locator('.island').getAttribute('data-state');
  const results = [];
  const ok = (name) => { results.push(name); console.log('OK  ', name); };

  assert.equal(await state(), 'idle'); ok('arranca en reposo');

  // La ventana no debe robar el foco ni salir en la barra de tareas
  const props = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return { focusable: w.isFocusable(), top: w.isAlwaysOnTop(), visible: w.isVisible(), b: w.getBounds() };
  });
  assert.equal(props.focusable, false); assert.equal(props.top, true); assert.equal(props.visible, true);
  ok('ventana siempre visible y sin robar el foco');

  await post({ hook_event_name: 'PreToolUse', session_id: 'e2e', cwd: '/proyectos/mi-web', tool_name: 'Edit', tool_input: { file_path: 'src/app.js' }, tool_use_id: 't1' });
  await wait(300);
  assert.equal(await state(), 'working'); ok('muestra "trabajando" al recibir actividad');
  await win.screenshot({ path: path.join(shots, 'e2e-working.png') });

  // Permitir
  let p1 = post({ hook_event_name: 'PermissionRequest', session_id: 'e2e', cwd: '/proyectos/mi-web', tool_name: 'Bash', tool_input: { command: 'npm install' }, tool_use_id: 'p1' });
  await win.waitForSelector('.permission:not([hidden])');
  assert.match(await win.locator('.cmd').textContent(), /npm install/);
  await win.screenshot({ path: path.join(shots, 'e2e-permission.png') });
  await win.click('.btn-allow');
  const r1 = await p1;
  assert.equal(JSON.parse(r1.text).hookSpecificOutput.decision.behavior, 'allow'); ok('Permitir en la isla -> Claude Code recibe allow');

  // Negar, riesgo alto
  let p2 = post({ hook_event_name: 'PermissionRequest', session_id: 'e2e', tool_name: 'Bash', tool_input: { command: 'rm -rf /' }, tool_use_id: 'p2' });
  await win.waitForSelector('.permission:not([hidden])');
  assert.equal(await win.locator('.chip.risk').getAttribute('data-risk'), 'high');
  await win.click('.btn-deny');
  assert.equal(JSON.parse((await p2).text).hookSpecificOutput.decision.behavior, 'deny'); ok('Negar en la isla -> Claude Code recibe deny (riesgo alto marcado)');

  // Atajo global
  let p3 = post({ hook_event_name: 'PermissionRequest', session_id: 'e2e', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_use_id: 'p3' });
  await win.waitForSelector('.permission:not([hidden])');
  const reg = await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Control+Alt+Y'));
  console.log(reg ? 'OK   atajo global registrado mientras hay permiso pendiente' : 'AVISO atajo global no se pudo registrar en este entorno (Linux/Xvfb)');
  await win.click('.btn-allow'); await p3;
  await wait(200);
  const regAfter = await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Control+Alt+Y'));
  assert.equal(regAfter, false); ok('los atajos se liberan al terminar el permiso');

  // Fail-safe: sin respuesta (8 s) -> vacío
  const t0 = Date.now();
  const p4 = await post({ hook_event_name: 'PermissionRequest', session_id: 'e2e', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'p4' });
  assert.equal(p4.status, 200); assert.equal(p4.text, ''); assert.ok(Date.now() - t0 >= 7500);
  ok('sin respuesta a tiempo -> respuesta vacía (Claude Code pregunta como siempre)');
  await wait(300);
  assert.notEqual(await state(), 'permission'); ok('la isla retira la petición vencida');

  // Terminó
  await post({ hook_event_name: 'Stop', session_id: 'e2e', last_assistant_message: 'Listo: instalé las dependencias y las pruebas pasan.' });
  await win.waitForSelector('.notice:not([hidden])');
  assert.equal(await state(), 'done'); ok('muestra "terminó" con resumen');
  await win.screenshot({ path: path.join(shots, 'e2e-done.png') });

  // Seguridad básica sobre la app real
  const bad = await new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/hook', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => resolve(res.statusCode));
    req.end('{}');
  });
  assert.equal(bad, 401); ok('rechaza peticiones sin token');

  // ---------- Panel de Two-Nova ----------
  await win.click('.notice-close');
  await win.waitForFunction(() => document.querySelector('.island').dataset.state === 'idle');

  // ---------- Abrir y cerrar con el mouse ----------
  assert.match(await win.locator('.island .title').textContent(), /^\d\d:\d\d$/); ok('en reposo la pastilla muestra la hora');
  // Mueve el puntero REAL del sistema (X11 con XTest) sobre/fuera de la pastilla, como lo haría una persona.
  const realMove = async (cssX, cssY) => {
    const { bx, by, z } = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; const b = w.getBounds(); return { bx: b.x, by: b.y, z: w.webContents.getZoomFactor() }; });
    const r = spawnSync('python3', [path.join(__dirname, 'xmove.py'), String(bx + cssX * z), String(by + cssY * z)], { env: process.env });
    if (r.status !== 0) throw new Error('no pude mover el puntero real: ' + r.stderr);
  };
  const pill = await win.locator('.island').boundingBox();
  await realMove(pill.x + pill.width / 2, pill.y + 20);
  await win.waitForSelector('.dash:not([hidden])', { timeout: 3000 }); ok('al pasar el mouse la isla se abre sola');
  await realMove(4, 590);
  await win.waitForSelector('.dash', { state: 'hidden', timeout: 4000 }); ok('al irse el mouse la isla se cierra sola');

  // ---------- Isla expandida (dashboard con apps) ----------
  // Clic en la pastilla con la isla abierta por el mouse = fijarla; ya no se cierra al irse el mouse.
  await realMove(pill.x + pill.width / 2, pill.y + 20);
  await win.waitForSelector('.dash:not([hidden])');
  await win.click('.head', { force: true });
  await realMove(4, 590);
  await wait(1400);
  assert.equal(await win.locator('.dash').isVisible(), true); ok('un clic en la pastilla fija la isla abierta aunque el mouse se vaya');
  assert.equal(await win.locator('.dock [role="tab"]').count(), 7); ok('al abrir la isla aparece el dock con 7 apps');
  await wait(700);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocusable()), true); ok('abierta, la isla acepta teclado (para notas)');
  await win.screenshot({ path: path.join(shots, 'e2e-isla-inicio.png') });

  // Notas: escribir, guardar, y que el círculo marque la tarea
  await win.click('.dock [data-page="notes"]');
  await win.fill('.notes textarea', 'Mi nota\n[ ] Entregar tarea de redes\n[ ] Practicar CSS');
  await win.waitForSelector('.notes .check');
  assert.equal(await win.locator('.notes .check').count(), 2);
  await win.locator('.notes .check').first().click();
  assert.equal(await win.locator('.notes .check').first().getAttribute('aria-pressed'), 'true'); ok('notas: la lista de tareas se marca con un clic');
  await wait(800);
  assert.match(await win.evaluate(() => window.isla.notes.get()), /\[x\] Entregar tarea de redes/); ok('la nota se guarda');
  await win.screenshot({ path: path.join(shots, 'e2e-isla-notas.png') });

  // Agenda local
  await win.click('.dock [data-page="agenda"]');
  await win.click('button[aria-label="Agregar evento"]');
  await win.fill('.form input[type="text"]', 'Clase de redes');
  await win.click('.form .btn-primary');
  await win.waitForSelector('.list li .t');
  assert.equal(await win.locator('.list li .t').first().textContent(), 'Clase de redes'); ok('agenda: crear un evento');
  await win.screenshot({ path: path.join(shots, 'e2e-isla-agenda.png') });

  // Bandeja de archivos y portapapeles (por la API real de la isla)
  const sample = path.join(data, 'ejemplo.txt'); fs.writeFileSync(sample, 'hola');
  const trayItems = await win.evaluate((f) => window.isla.tray.add([f]), sample);
  assert.equal(trayItems.length, 1); assert.equal(trayItems[0].name, 'ejemplo.txt'); ok('bandeja: guarda la ruta del archivo');
  await win.click('.dock [data-page="tray"]');
  await win.waitForSelector('.list li .t');
  await win.screenshot({ path: path.join(shots, 'e2e-isla-bandeja.png') });
  await win.click('.dock [data-page="clipboard"]');
  assert.equal((await win.evaluate(() => window.isla.clip.state())).enabled, false); ok('portapapeles: apagado por defecto');
  await win.locator('label.switch input').check();
  await app.evaluate(({ clipboard }) => clipboard.writeText('texto de prueba para el historial'));
  await win.waitForSelector('.list li .grow', { timeout: 5000 });
  ok('portapapeles: al activarlo guarda lo copiado');
  await app.evaluate(({ clipboard }) => clipboard.writeText('sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'));
  await wait(1600);
  const clipState = await win.evaluate(() => window.isla.clip.state());
  assert.ok(!clipState.items.some((i) => i.text.includes('sk-ant'))); ok('portapapeles: no guarda lo que parece una clave');
  await win.screenshot({ path: path.join(shots, 'e2e-isla-portapapeles.png') });
  await win.click('.dock [data-page="claude"]');
  await win.screenshot({ path: path.join(shots, 'e2e-isla-claude.png') });
  await win.click('.dock [data-page="music"]');
  await win.screenshot({ path: path.join(shots, 'e2e-isla-musica.png') });

  // Un permiso con la isla abierta: pasa al frente y se cierra el dashboard
  const pOpen = post({ hook_event_name: 'PermissionRequest', session_id: 'e2e', tool_name: 'Bash', tool_input: { command: 'npm run build' }, tool_use_id: 'p9' });
  await win.waitForSelector('.permission:not([hidden])');
  assert.equal(await win.locator('.dash').isHidden(), true); ok('un permiso nuevo tapa el dashboard y se ve primero');
  await wait(200);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocusable()), false); ok('mientras pide permiso, la ventana no roba el foco');
  await win.click('.btn-allow'); await pOpen;
  await win.waitForSelector('.dash:not([hidden])'); ok('al responder, la isla vuelve a como estaba');

  // Abrir el panel desde el botón de la isla
  await win.waitForSelector('.open-panel:visible');
  const [panel] = await Promise.all([app.waitForEvent('window'), win.click('.open-panel')]);
  await panel.waitForLoadState('domcontentloaded');
  panel.on('pageerror', (e) => console.log('ERROR EN EL PANEL:', e.message));
  await panel.waitForSelector('#chips .chip', { state: 'attached' });
  await panel.waitForSelector('#home-cards .card');
  await panel.screenshot({ path: path.join(shots, 'e2e-panel-inicio.png') });
  await panel.click('#tab-connections');
  await panel.waitForSelector('#connections .card');
  assert.equal(await panel.locator('#connections .card').count(), 7); ok('Conexiones: Claude Code real y 6 apps marcadas como próximamente');
  await panel.screenshot({ path: path.join(shots, 'e2e-panel-conexiones.png') });

  // Celular: activar, emparejar con el código de la pantalla y usar la API real
  await panel.waitForSelector('#remote-enable', { state: 'attached' });
  assert.equal(await panel.locator('#remote-enable').isChecked(), false); ok('el control remoto del celular viene apagado');
  await panel.check('#remote-enable');
  await panel.waitForSelector('#remote-pair');
  await panel.click('#remote-pair');
  await panel.waitForSelector('#pair-code');
  const pairCode = (await panel.locator('#pair-code').textContent()).replace(/\s/g, '');
  assert.match(pairCode, /^\d{6}$/);
  const rport = Number((await panel.locator('.phone-card .addr code').first().textContent()).split(':')[1]);
  const rcall = (method, p, { token, body } = {}) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request({ host: '127.0.0.1', port: rport, method, path: p, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(data ? { 'content-length': Buffer.byteLength(data) } : {}) } }, (res) => { let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(t || '{}') })); });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
  assert.equal((await rcall('GET', '/v1/status')).status, 401); ok('el celular sin emparejar no entra');
  assert.equal((await rcall('POST', '/v1/pair', { body: { code: pairCode === '000000' ? '111111' : '000000', name: 'x' } })).status, 403);
  const paired = await rcall('POST', '/v1/pair', { body: { code: pairCode, name: 'Honor de prueba' } });
  assert.equal(paired.status, 200); ok('se empareja con el código que muestra el panel');
  assert.equal((await rcall('GET', '/v1/status', { token: paired.json.token })).json.host.length > 0, true);
  await panel.waitForFunction(() => /Honor de prueba/.test(document.getElementById('phone-card').textContent), null, { timeout: 8000 }); ok('el panel muestra el celular emparejado');
  await panel.uncheck('#remote-power');
  await panel.waitForFunction(() => !document.getElementById('remote-power').checked);
  const powerDenied = await rcall('POST', '/v1/power', { token: paired.json.token, body: { action: 'lock' } });
  assert.equal(powerDenied.status, 403); ok('con el permiso de energía apagado, el celular no puede bloquear ni apagar');
  await panel.screenshot({ path: path.join(shots, 'e2e-panel-celular.png') });
  await panel.click('.devices .btn');
  await panel.waitForFunction(() => /Ninguno todavía/.test(document.getElementById('phone-card').textContent));
  assert.equal((await rcall('GET', '/v1/status', { token: paired.json.token })).status, 401); ok('al quitar el celular, deja de tener acceso');
  await panel.uncheck('#remote-enable');
  await panel.waitForFunction(() => !document.getElementById('remote-pair'));
  await panel.screenshot({ path: path.join(shots, 'e2e-panel-conexiones.png') });

  // Apariencia: cambiar y que la isla real lo muestre
  await panel.click('#tab-look');
  await panel.waitForSelector('#f-accent');
  await panel.waitForFunction(() => document.querySelector('#preview').contentDocument?.querySelector('.island'));
  await wait(700);
  await panel.screenshot({ path: path.join(shots, 'e2e-panel-apariencia.png') });
  await panel.selectOption('#f-eyestyle', 'gato');
  await panel.selectOption('#f-shape', 'pildora');
  await panel.fill('#f-accent-hex', '#ff9f5a');
  const pv = panel.frameLocator('#preview').locator('.island');
  await pv.waitFor();
  await panel.waitForFunction(() => document.querySelector('#preview').contentDocument.querySelector('.island').dataset.eyes === 'gato');
  ok('vista previa en vivo: cambia al editar');
  await panel.selectOption('#f-idlelabel', 'nada');
  await panel.waitForFunction(() => document.querySelector('#preview').contentDocument.querySelector('.island').dataset.nolabel === 'true');
  ok('quitar el texto de la pastilla: queda solo con los ojos');
  await panel.selectOption('#f-idlelabel', 'texto');
  await panel.waitForFunction(() => /Escribe el texto/.test(document.getElementById('look-msg').textContent)); ok('si eliges tu propio texto, exige escribirlo');
  await panel.fill('#f-idletext', 'Black Hole');
  await panel.waitForFunction(() => document.querySelector('#preview').contentDocument.querySelector('.island .title').textContent === 'Black Hole'); ok('tu propio texto aparece en la pastilla');
  await panel.selectOption('#f-idleanim', 'latido');
  await panel.waitForFunction(() => document.querySelector('#preview').contentDocument.querySelector('.island').dataset.idle === 'latido'); ok('cambiar la animación en reposo');
  assert.equal(await win.locator('.island').getAttribute('data-eyes'), 'ovalo'); ok('sin guardar, la isla real no cambia');
  await panel.click('#look-save');
  await panel.waitForFunction(() => /Guardado/.test(document.getElementById('look-msg').textContent));
  await win.waitForFunction(() => document.querySelector('.island').dataset.eyes === 'gato');
  assert.equal(await win.evaluate(() => getComputedStyle(document.querySelector('.island')).getPropertyValue('--accent-user').trim()), '#ff9f5a'); ok('al guardar, la isla real cambia de inmediato');
  // un fondo claro se rechaza con mensaje claro
  await panel.fill('#f-bg-hex', '#ffffff');
  await panel.waitForFunction(() => /demasiado claro/.test(document.getElementById('look-msg').textContent));
  assert.equal(await panel.locator('#look-save').isDisabled(), true); ok('un fondo claro (texto ilegible) se rechaza con aviso');
  await panel.screenshot({ path: path.join(shots, 'e2e-panel-apariencia-error.png') });
  await panel.click('#look-reset');
  await panel.waitForFunction(() => /original/.test(document.getElementById('look-msg').textContent));
  await win.waitForFunction(() => document.querySelector('.island').dataset.eyes === 'ovalo'); ok('volver a lo original funciona');

  await panel.click('#tab-chat');
  await panel.waitForSelector('#chips .chip');
  assert.equal(await panel.locator('#chips .chip').count(), 5); ok('el panel abre con las 5 personalidades');

  // sin clave: mensaje claro
  await panel.fill('#input', 'Hola');
  await panel.click('#send');
  await panel.waitForSelector('#chat-error:not([hidden])');
  assert.match(await panel.locator('#chat-error').textContent(), /Falta la clave/); ok('sin clave: avisa en español');
  await panel.screenshot({ path: path.join(shots, 'e2e-panel-sinclave.png') });

  // guardar clave (cifrada) y conversar
  await panel.click('#tab-settings');
  assert.equal(await panel.locator('#provider').inputValue(), 'gemini'); ok('el cerebro por defecto es Gemini');
  await panel.fill('#key-input', 'AIzaSy-PRUEBA-1234567890');
  await panel.click('#key-save');
  await panel.waitForFunction(() => /Clave guardada/.test(document.getElementById('key-status').textContent));
  assert.ok(!fs.readFileSync(path.join(data, 'secrets.json'), 'utf8').includes('PRUEBA-1234567890')); ok('la clave se guarda cifrada (no en texto plano)');
  assert.ok(!(await panel.content()).includes('PRUEBA-1234567890')); ok('la clave completa nunca vuelve a la pantalla');
  await panel.screenshot({ path: path.join(shots, 'e2e-panel-ajustes.png') });

  await panel.click('#tab-chat');
  await panel.click('#chips .chip:nth-child(3)'); // Profe
  await panel.fill('#input', '¿Me ayudas con mi tarea de matemáticas?');
  await panel.click('#send');
  await panel.waitForSelector('.msg.bot:not(.pending)');
  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].key, 'AIzaSy-PRUEBA-1234567890');
  assert.ok(apiCalls[0].gemini && apiCalls[0].url.includes('/models/gemini-3.1-flash-lite:generateContent'));
  const sys = apiCalls[0].body.systemInstruction.parts[0].text;
  assert.ok(sys.includes('Profe') && sys.includes('SOLO conversas')); ok('Gemini recibe la clave, la personalidad y las reglas fijas');
  // cambiar a Claude: cada cerebro tiene su propia clave
  await panel.click('#tab-settings');
  await panel.selectOption('#provider', 'claude');
  await panel.waitForFunction(() => /Aún no hay clave/.test(document.getElementById('key-status').textContent));
  assert.equal(await panel.locator('#model').inputValue(), 'claude-sonnet-5-5'); ok('cada cerebro tiene su propia clave y su propio modelo');
  await panel.selectOption('#provider', 'gemini');
  await panel.waitForFunction(() => /Clave guardada/.test(document.getElementById('key-status').textContent));
  await panel.click('#tab-chat');
  await panel.screenshot({ path: path.join(shots, 'e2e-panel-chat.png') });

  await panel.click('#tab-people');
  await panel.waitForSelector('.person');
  await panel.screenshot({ path: path.join(shots, 'e2e-panel-personalidades.png'), fullPage: false });

  // editar y guardar una personalidad; una idéntica se rechaza
  await panel.fill('#name-profe', 'Profe Leo');
  await panel.locator('.person').nth(2).locator('button', { hasText: 'Guardar' }).click();
  await panel.waitForFunction(() => document.querySelector('#chips').textContent.includes('Profe Leo'));
  ok('editar una personalidad la guarda');
  await panel.click('#tab-settings');
  await panel.waitForFunction(() => /144 de/.test(document.getElementById('usage-text').textContent.replace(/\s|\./g, '')) || /144/.test(document.getElementById('usage-text').textContent));
  ok('el contador de tokens suma el uso');

  // la página del panel no puede abrir canales de otra ventana
  const denied = await win.evaluate(() => typeof window.nova);
  assert.equal(denied, 'undefined'); ok('la isla no tiene acceso a las funciones del panel');

  // Cierre: lo pendiente vuelve sin decisión
  const p5 = post({ hook_event_name: 'PermissionRequest', session_id: 'e2e', tool_name: 'Bash', tool_input: { command: 'pwd' }, tool_use_id: 'p5' });
  await win.waitForSelector('.permission:not([hidden])');
  await app.close();
  const r5 = await p5.catch(() => ({ status: 'cortado', text: '' }));
  assert.ok(r5.text === '' ); ok('al cerrar la app, lo pendiente vuelve sin decisión');

  // El archivo de Claude Code del usuario no se tocó
  assert.ok(!fs.existsSync(path.join(home, '.claude', 'settings.json'))); ok('no tocó la configuración de Claude Code por su cuenta');
  fakeApi.close();
  console.log(`\n${results.length} comprobaciones pasadas`);
})().catch((e) => { console.error('FALLÓ:', e.message); process.exit(1); });
