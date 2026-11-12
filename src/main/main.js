'use strict';
const path = require('node:path');
const fs = require('node:fs');
const {
  app, BrowserWindow, Tray, Menu, safeStorage, ipcMain, dialog, screen, shell, Notification, globalShortcut, nativeImage, clipboard,
} = require('electron');

const brand = require('../brand');
const cfgLib = require('../lib/config');
const { Store } = require('../lib/db');
const { Core } = require('../lib/core');
const { createHookServer } = require('../lib/hookServer');
const cc = require('../lib/claudeConfig');
const { maskDeep } = require('../lib/mask');
const { createSecrets } = require('../lib/secrets');
const { PersonalityBook } = require('../lib/personalities');
const { Assistant } = require('../lib/brain');
const { Agenda } = require('../lib/agenda');
const { TrayFiles } = require('../lib/trayFiles');
const { ClipboardHistory } = require('../lib/clipboardHistory');
const { sanitizeTheme } = require('../lib/theme');
const { registerPanelIpc } = require('./ipc');
const { registerIslandIpc } = require('./islandIpc');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

// Tamaño base de la ventana (sin zoom). El tamaño del tema multiplica todo.
const BASE_W = 800;
const BASE_H = 600;
let theme = sanitizeTheme({});
let clipHistory = null;
let clipTimer = null;
let win = null;
let panel = null;
let assistant = null;
let book = null;
let tray = null;
let core = null;
let server = null;
let store = null;
let secrets = null;
let cfg = null;
let dataDir = null;
let quitting = false;

const log = (...a) => {
  try { fs.appendFileSync(path.join(dataDir || app.getPath('userData'), 'log.txt'), `${new Date().toISOString()} ${a.join(' ')}\n`); } catch { /* */ }
};
process.on('uncaughtException', (e) => log('uncaughtException', e.stack || e));
process.on('unhandledRejection', (e) => log('unhandledRejection', e?.stack || e));

// ---------- Modo grabación: guarda los avisos enmascarados para aprender el formato real ----------
// Click-through: en Windows/macOS la ventana deja pasar los clics fuera de la pastilla y aun así recibe el
// movimiento del mouse (forward). Linux no soporta "forward", así que ahí la ventana se queda interactiva.
function setClickThrough(ignore) {
  if (process.platform === 'linux') return;
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!!ignore, { forward: true });
}

function makeCapture() {
  const file = path.join(dataDir, 'captura.jsonl');
  return (payload) => {
    if (!cfg.capture) return;
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 2_000_000) return;
      fs.appendFileSync(file, JSON.stringify({ t: new Date().toISOString(), payload: maskDeep(payload) }) + '\n');
    } catch { /* */ }
  };
}

// ---------- Ventana de la isla ----------
function placeWindow() {
  if (!win || win.isDestroyed()) return;
  const d = screen.getPrimaryDisplay();
  const b = d.bounds;
  // Nunca más ancha que la pantalla: si el tamaño elegido no cabe, se reduce el zoom.
  const zoom = Math.min(theme.scale, (b.width - 16) / BASE_W);
  const w = Math.round(BASE_W * zoom);
  const h = Math.round(BASE_H * zoom);
  win.webContents.setZoomFactor(zoom);
  win.setBounds({ x: Math.round(b.x + (b.width - w) / 2), y: b.y + theme.offsetY, width: w, height: h });
}

function setTheme(clean) {
  theme = clean;
  store.setSetting('theme', clean);
  placeWindow();
  send('isla:theme', clean);
}

// Al abrir el panel de la isla se necesita teclado (notas); cerrado, la ventana vuelve a no robar el foco.
function resizeIsland(expanded) {
  if (!win || win.isDestroyed()) return;
  // Abierta, la ventana acepta teclado (notas) pero solo toma el foco cuando haces clic dentro.
  win.setFocusable(!!expanded);
}

function startClipboardWatch() {
  clearInterval(clipTimer);
  let busy = false;
  // En esta versión de Electron el portapapeles responde de forma asíncrona.
  clipTimer = setInterval(async () => {
    if (!clipHistory.enabled || busy) return;
    busy = true;
    try { if (clipHistory.push(await clipboard.readText())) send('isla:clip', clipHistory.view()); } catch (e) { log('clipboard', e.message); } finally { busy = false; }
  }, 1000);
}

function createWindow() {
  win = new BrowserWindow({
    width: BASE_W, height: BASE_H, show: false,
    frame: false, transparent: true, resizable: false, movable: false, hasShadow: false,
    skipTaskbar: true, focusable: false, alwaysOnTop: true, fullscreenable: false, minimizable: false, maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
  setClickThrough(true);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', placeWindow);
  win.once('ready-to-show', () => { placeWindow(); win.showInactive(); });
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(ev, placeWindow);
}

// ---------- Ventana de Two-Nova (chat, personalidades y ajustes) ----------
function openPanel(section) {
  const goto = () => { if (section) panel?.webContents.send('nova:goto', section); };
  if (panel && !panel.isDestroyed()) { if (panel.isMinimized()) panel.restore(); panel.show(); panel.focus(); goto(); return; }
  panel = new BrowserWindow({
    width: 960, height: 680, minWidth: 380, minHeight: 480, show: false, title: brand.appName,
    backgroundColor: '#0b0d12', autoHideMenuBar: true,
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'panelPreload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
    },
  });
  panel.setMenuBarVisibility(false);
  panel.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  panel.webContents.on('will-navigate', (e) => e.preventDefault());
  panel.loadFile(path.join(__dirname, '..', 'renderer', 'panel.html'));
  panel.once('ready-to-show', () => panel.show());
  panel.webContents.once('did-finish-load', goto);
  panel.on('closed', () => { panel = null; });
}

// Que Two-Nova hable los avisos (opcional, apagado por defecto).
function speakEvent(text) {
  try {
    if (!assistant.settings().speakEvents) return;
    const p = book.get(book.activeId());
    const index = Math.max(0, book.list().findIndex((x) => x.id === p.id));
    send('isla:speak', { text, personality: p, index });
  } catch { /* hablar es un extra: nunca debe romper nada */ }
}

const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };

// ---------- Atajos globales: solo existen mientras hay un permiso pendiente ----------
function syncShortcuts() {
  const pending = core.pendingList().length > 0;
  const has = globalShortcut.isRegistered('Control+Alt+Y');
  if (pending && !has) {
    globalShortcut.register('Control+Alt+Y', () => { const p = core.pendingList()[0]; if (p) core.decide(p.id, 'allow'); });
    globalShortcut.register('Control+Alt+N', () => { const p = core.pendingList()[0]; if (p) core.decide(p.id, 'deny'); });
  } else if (!pending && has) {
    globalShortcut.unregister('Control+Alt+Y');
    globalShortcut.unregister('Control+Alt+N');
  }
}

// ---------- Avisos de Windows ----------
function toast(title, body) {
  if (!cfg.nativeNotifications || !Notification.isSupported()) return;
  try { new Notification({ title, body, silent: true }).show(); } catch { /* */ }
}

// ---------- Bandeja ----------
function connectionStatus() {
  try { return cc.status(cc.defaultSettingsPath(), cfg.port); } catch (e) { return { connected: false, error: e.message }; }
}

async function doConnect() {
  const file = cc.defaultSettingsPath();
  try {
    const p = cc.preview(file, cfg);
    const r = await dialog.showMessageBox({
      type: 'question', buttons: ['Conectar', 'Cancelar'], defaultId: 0, cancelId: 1,
      title: `Conectar ${brand.appName} con Claude Code`,
      message: `${brand.appName} añadirá avisos en la configuración de Claude Code.`,
      detail: `Archivo: ${p.file}\nEventos: ${p.adds.join(', ')}\n\n` +
        'Antes de cambiar nada se guarda una copia de respaldo. Tus otras configuraciones no se tocan.\n' +
        'Puedes quitarlo cuando quieras desde la bandeja. Después abre Claude Code de nuevo.',
    });
    if (r.response !== 0) return;
    const res = cc.connect(file, cfg);
    await dialog.showMessageBox({ type: 'info', title: brand.appName, message: 'Conectado.',
      detail: `Respaldo: ${res.backupFile || '(no había archivo previo)'}\nAbre Claude Code de nuevo para que lo lea.` });
  } catch (e) {
    dialog.showErrorBox(brand.appName, e.message);
  }
  buildTray();
}

async function doDisconnect() {
  try {
    const r = cc.disconnect(cc.defaultSettingsPath());
    await dialog.showMessageBox({ type: 'info', title: brand.appName,
      message: r.removed ? 'Desconectado.' : 'No había nada que quitar.',
      detail: r.backupFile ? `Respaldo: ${r.backupFile}` : '' });
  } catch (e) { dialog.showErrorBox(brand.appName, e.message); }
  buildTray();
}

function toggle(key) {
  cfg[key] = !cfg[key];
  cfgLib.save(dataDir, cfg);
  if (key === 'autoStart') app.setLoginItemSettings({ openAtLogin: cfg.autoStart });
  send('isla:settings', { sound: cfg.sound });
  buildTray();
}

function buildTray() {
  const st = connectionStatus();
  const menu = Menu.buildFromTemplate([
    { label: `${brand.appName} — por ${brand.author}`, enabled: false },
    { label: 'Abrir Two-Nova (chat y ajustes)', click: () => openPanel() },
    { label: 'Mostrar u ocultar la isla (Ctrl+Alt+Espacio)', click: () => send('isla:toggle') },
    { label: st.connected ? '● Conectada a Claude Code' : '○ No conectada a Claude Code', enabled: false },
    { type: 'separator' },
    st.connected
      ? { label: 'Desconectar de Claude Code…', click: doDisconnect }
      : { label: 'Conectar con Claude Code…', click: doConnect },
    ...(st.connected && st.stalePort ? [{ label: 'Reconectar (el puerto cambió)…', click: doConnect }] : []),
    { type: 'separator' },
    { label: 'Sonido', type: 'checkbox', checked: cfg.sound, click: () => toggle('sound') },
    { label: 'Avisos de Windows', type: 'checkbox', checked: cfg.nativeNotifications, click: () => toggle('nativeNotifications') },
    { label: 'Empezar con Windows', type: 'checkbox', checked: cfg.autoStart, click: () => toggle('autoStart') },
    { label: 'Modo grabación (para depurar)', type: 'checkbox', checked: cfg.capture, click: () => toggle('capture') },
    { label: 'Abrir carpeta de datos', click: () => shell.openPath(dataDir) },
    { type: 'separator' },
    { label: 'Salir', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'tray.png'));
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip(brand.appName);
  tray.on('click', () => openPanel());
  buildTray();
}

// ---------- Arranque ----------
app.whenReady().then(async () => {
  if (!gotLock) return;
  dataDir = app.getPath('userData');
  cfg = cfgLib.load(dataDir);
  store = new Store(path.join(dataDir, 'isla.db'));
  store.expirePendingOnStart();
  store.purge(30);
  core = new Core({ store, permissionTimeoutMs: cfg.permissionTimeoutSec * 1000, capture: makeCapture() });
  book = new PersonalityBook(store);
  try { theme = sanitizeTheme(store.getSetting('theme', {})); } catch { theme = sanitizeTheme({}); }
  clipHistory = new ClipboardHistory();
  // Solo para pruebas automáticas: permite apuntar a un servidor falso en esta misma PC. Nunca a internet.
  const testBase = /^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.TWO_NOVA_API_BASE || '') ? process.env.TWO_NOVA_API_BASE : undefined;
  // Linux de pruebas no tiene almacén de claves: solo con el servidor falso local se usa un cifrado de mentira.
  const fakeCrypto = testBase && process.env.TWO_NOVA_TEST_FAKE_CRYPTO === '1'
    ? { isEncryptionAvailable: () => true, encryptString: (t) => Buffer.from(t).reverse(), decryptString: (b) => Buffer.from(b).reverse().toString() }
    : null;
  secrets = createSecrets({ dir: dataDir, safeStorage: fakeCrypto || safeStorage });
  const testGemini = /^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.TWO_NOVA_GEMINI_BASE || '') ? process.env.TWO_NOVA_GEMINI_BASE : undefined;
  assistant = new Assistant({ store, secrets, book, baseUrl: testBase, geminiBaseUrl: testGemini });
  server = createHookServer({ core, token: cfg.token, port: cfg.port, appName: 'isla' });

  try {
    await server.listen();
  } catch (e) {
    dialog.showErrorBox(brand.appName,
      `No pude abrir el puerto local ${cfg.port} (${e.code || e.message}).\n` +
      'Probablemente ya hay otra copia abierta u otro programa lo usa.\n' +
      `Cambia "port" en ${path.join(dataDir, 'config.json')} y vuelve a conectar.`);
    app.exit(1);
    return;
  }

  registerPanelIpc({
    ipcMain, assistant, book, secrets,
    isPanel: (wc) => !!panel && !panel.isDestroyed() && wc === panel.webContents,
    claudeCode: { status: connectionStatus, connect: doConnect, disconnect: doDisconnect },
  });
  const isIsland = (wc) => !!win && !win.isDestroyed() && wc === win.webContents;
  registerIslandIpc({
    ipcMain, isIsland, isPanel: (wc) => !!panel && !panel.isDestroyed() && wc === panel.webContents,
    store, agenda: new Agenda(store), trayFiles: new TrayFiles(store), clipHistory, shell, clipboard,
    getTheme: () => theme, setTheme, resizeIsland, openPanel, send,
    startDrag: (wc, file) => { const icon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'tray.png')); wc.startDrag({ file, icon: icon.isEmpty() ? nativeImage.createEmpty() : icon }); },
  });
  ipcMain.handle('isla:state', () => core.view());
  ipcMain.handle('isla:settings', () => ({ sound: cfg.sound }));
  ipcMain.on('isla:mouse', (_e, ignore) => { setClickThrough(!!ignore); });
  ipcMain.on('isla:decide', (_e, id, decision) => {
    if (typeof id !== 'string' || (decision !== 'allow' && decision !== 'deny')) return;
    core.decide(id, decision);
  });

  core.on('change', (v) => { send('isla:state', v); syncShortcuts(); });
  core.on('permission', (p) => {
    toast('Claude pide permiso', `${p.toolName}: ${p.summary.slice(0, 120)}`);
    speakEvent(`Claude pide permiso para ${p.toolName}.${p.risk === 'high' ? ' Ojo: riesgo alto.' : ''}`);
  });
  core.on('done', ({ message }) => { send('isla:notice', { kind: 'done', text: message }); toast('Claude terminó', message); speakEvent(`Claude terminó. ${message.slice(0, 160)}`); });
  core.on('attention', ({ message }) => { send('isla:notice', { kind: 'attention', text: message }); toast('Claude te necesita', message); speakEvent('Claude te necesita.'); });

  createWindow();
  createTray();
  startClipboardWatch();
  globalShortcut.register('Control+Alt+Space', () => send('isla:toggle'));

  // Primera vez: ofrecer la conexión con vista previa.
  if (!cfg.askedConnect && !connectionStatus().connected) {
    cfg.askedConnect = true; cfgLib.save(dataDir, cfg);
    setTimeout(doConnect, 800);
  }
});

app.on('second-instance', () => { placeWindow(); win?.showInactive(); if (app.isReady()) openPanel(); });
app.on('window-all-closed', (e) => { if (!quitting) e.preventDefault?.(); });
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => {
  clearInterval(clipTimer);
  globalShortcut.unregisterAll();
  try { core?.shutdown(); } catch { /* */ }
  try { store?.close(); } catch { /* */ }
  try { server?.server.close(); } catch { /* */ }
});
