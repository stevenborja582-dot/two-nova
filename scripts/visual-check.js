// Revisión visual sin Electron: carga la isla en Chromium con una API falsa y saca capturas sobre un escritorio de ejemplo.
// Uso: node scripts/visual-check.js <carpeta-de-capturas>
const { chromium } = require('playwright');
const path = require('node:path');
const out = process.argv[2];
const page0 = 'file://' + path.join(__dirname, '..', 'src', 'renderer', 'index.html');

const sessions = [
  { id: 's1', cwd: 'C:\\Users\\leo\\proyectos\\mi-web', status: 'working', lastMessage: 'Edit: src/app.js' },
  { id: 's2', cwd: 'C:\\Users\\leo\\proyectos\\api', status: 'done', lastMessage: 'Listo: agregué la ruta /health.' },
];
const baseView = { connected: true, state: 'idle', pending: [], latest: null, sessions: [] };
const views = {
  idle: baseView,
  working: { ...baseView, state: 'working', latest: { ...sessions[0], lastMessage: 'Edit: src/components/Header.jsx' }, sessions },
  permission: { ...baseView, state: 'permission', latest: sessions[0], sessions, pending: [{ id: 'p1', sessionId: 's1', toolName: 'Bash', risk: 'medium', summary: 'npm install' }] },
  'permission-alto': { ...baseView, state: 'permission', latest: sessions[0], sessions, pending: [
    { id: 'p2', sessionId: 's1', toolName: 'Bash', risk: 'high', summary: 'rm -rf node_modules dist build && git push --force origin main\n# limpia todo y sube sin preguntar' },
    { id: 'p3', sessionId: 's1', toolName: 'Edit', risk: 'medium', summary: 'src/app.js' }] },
};
const notices = { done: 'Listo: agregué la ruta /health y las pruebas pasan.', attention: 'Claude necesita tu aprobación para continuar.' };
const themes = {
  nova: {},
  medianoche: { accent: '#b69cff', bg: '#0a0614', eyeStyle: 'redondo', shape: 'pildora' },
  atardecer: { accent: '#ff9f5a', bg: '#140a07', eyeColor: '#ffd08a', eyeStyle: 'gato' },
};
const shots = [
  ...Object.keys(views).map((v) => ({ name: v, view: v })),
  { name: 'done', view: 'idle', notice: 'done' }, { name: 'attention', view: 'working', notice: 'attention' },
  ...['home', 'claude', 'music', 'notes', 'agenda', 'tray', 'clipboard'].map((p) => ({ name: `isla-${p}`, view: 'working', expand: p })),
  { name: 'tema-medianoche', view: 'working', expand: 'home', theme: 'medianoche' },
  { name: 'tema-atardecer', view: 'working', expand: 'agenda', theme: 'atardecer' },
];

(async () => {
  const b = await chromium.launch();
  for (const s of shots) {
    const ctx = await b.newContext({ viewport: { width: 800, height: s.expand ? 520 : 330 }, deviceScaleFactor: 2 });
    const pg = await ctx.newPage();
    const errors = [];
    pg.on('pageerror', (e) => errors.push(e.message));
    pg.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await pg.addInitScript(({ view, notice, theme }) => {
      const now = new Date(); const ymd = (d) => d.toISOString().slice(0, 10);
      const ev = [{ id: 'a', title: 'Clase de redes', date: ymd(now), time: '09:00', duration: 90 }, { id: 'b', title: 'Entregar proyecto de CSS', date: ymd(now), time: '15:30', duration: 60 }];
      const files = [{ id: 'f1', name: 'diseño-final.png', dir: false, size: 482113, missing: false }, { id: 'f2', name: 'proyecto-redes', dir: true, size: 0, missing: false }];
      window.isla = {
        getState: () => Promise.resolve(view), decide() {}, setIgnoreMouse() {}, setExpanded() {}, openPanel() {}, soundEnabled: () => false,
        onState() {}, onNotice: (cb) => { if (notice) setTimeout(() => cb(notice), 30); }, onSpeak() {}, onToggle() {},
        theme: { get: () => Promise.resolve(theme), onChange() {} },
        notes: { get: () => Promise.resolve('Ideas de la semana\n[x] Terminar el menú del celular\n[ ] Practicar Grid\n[ ] Subir el portafolio'), save: () => Promise.resolve(true) },
        agenda: { list: () => Promise.resolve(ev), add: () => Promise.resolve(true), remove: () => Promise.resolve(true) },
        tray: { list: () => Promise.resolve(files), add: () => Promise.resolve(files), remove: () => Promise.resolve(files), clear: () => Promise.resolve([]), open() {}, reveal() {}, startDrag() {}, pathForFile: () => '' },
        clip: { state: () => Promise.resolve({ enabled: true, items: [{ id: 'c1', text: 'npm install express', pinned: true }, { id: 'c2', text: 'https://developer.mozilla.org/es/docs/Web/CSS/grid', pinned: false }] }), setEnabled() {}, copy() {}, pin() {}, clear() {}, onChange: () => () => {} },
        stats: () => Promise.resolve({ tasksDone: 12, today: 3, streak: 4, recent: [{ cwd: 'C:\\proyectos\\api', summary: 'Agregué la ruta /health y las pruebas pasan.', createdAt: new Date().toISOString() }] }),
      };
    }, { view: views[s.view], notice: s.notice ? { kind: s.notice, text: notices[s.notice] } : null, theme: themes[s.theme || 'nova'] });
    await pg.goto(page0);
    await pg.waitForTimeout(200);
    if (s.expand) { await pg.click('.head'); await pg.waitForSelector('.dash:not([hidden])'); await pg.click(`.dock [data-page="${s.expand}"]`); }
    await pg.evaluate(() => { document.documentElement.style.background = 'linear-gradient(135deg,#2b3a67 0%,#5b3f8c 55%,#c2677a 100%)'; });
    await pg.waitForTimeout(900);
    await pg.screenshot({ path: path.join(out, `${s.name}.png`) });
    if (errors.length) console.log(s.name, 'ERRORES:', errors);
    await ctx.close();
  }
  await b.close();
  console.log('capturas listas');
})();
