'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Store } = require('../src/lib/db');
const T = require('../src/lib/theme');
const { Agenda } = require('../src/lib/agenda');
const { TrayFiles } = require('../src/lib/trayFiles');
const { ClipboardHistory } = require('../src/lib/clipboardHistory');

test('tema: valores por defecto válidos y completos', () => {
  const t = T.sanitizeTheme({});
  assert.equal(t.dock.length, 7);
  assert.equal(t.userName, 'S1even');
});

test('tema: nuevas opciones (abrir con el mouse, texto, animaciones)', () => {
  const t = T.sanitizeTheme({});
  assert.equal(t.openMode, 'hover'); assert.equal(t.idleLabel, 'hora'); assert.equal(t.idleAnim, 'respirar'); assert.equal(t.motion, 'elastica');
  assert.equal(T.sanitizeTheme({ idleLabel: 'texto', idleText: '  Black Hole  ' }).idleText, 'Black Hole');
  assert.throws(() => T.sanitizeTheme({ idleLabel: 'texto', idleText: '' }), /Escribe el texto/);
  assert.throws(() => T.sanitizeTheme({ openMode: 'telepatia' }), /abrir/);
  assert.throws(() => T.sanitizeTheme({ idleAnim: 'explotar' }), /Animación/);
  assert.throws(() => T.sanitizeTheme({ motion: 'rapidisima' }), /Animación/);
  assert.equal(T.sanitizeTheme({ idleLabel: 'nada' }).idleLabel, 'nada');
  // un tema viejo (guardado antes de estas opciones) se completa con los valores nuevos
  assert.equal(T.sanitizeTheme({ accent: '#8fb0ff', dock: ['home'] }).openMode, 'hover');
});

test('tema: rechaza colores malos, fondo claro y acento invisible', () => {
  assert.throws(() => T.sanitizeTheme({ accent: 'azul' }), /acento/);
  assert.throws(() => T.sanitizeTheme({ bg: '#ffffff' }), /demasiado claro/);
  assert.throws(() => T.sanitizeTheme({ accent: '#101018', bg: '#0b0d12' }), /no se ve/);
  assert.throws(() => T.sanitizeTheme({ eyeColor: '#0c0e13' }), /ojos/);
  assert.throws(() => T.sanitizeTheme({ scale: 3 }), /tamaño/);
  assert.throws(() => T.sanitizeTheme({ eyeStyle: 'laser' }), /ojos/);
  assert.throws(() => T.sanitizeTheme({ dock: [] }), /al menos una/);
  assert.throws(() => T.sanitizeTheme({ dock: ['home', 'virus'] }), /no existe/);
});

test('tema: quita repetidos del dock y respeta el orden', () => {
  assert.deepEqual(T.sanitizeTheme({ dock: ['notes', 'home', 'notes'] }).dock, ['notes', 'home']);
});

test('tema: applyTheme pone variables CSS', () => {
  const el = { style: { props: {}, setProperty(k, v) { this.props[k] = v; } }, dataset: {} };
  T.applyTheme(el, T.sanitizeTheme({ accent: '#ff8800', shape: 'pildora', eyeStyle: 'gato' }));
  assert.equal(el.style.props['--accent-user'], '#ff8800');
  assert.equal(el.style.props['--r-pill'], '999px');
  assert.equal(el.dataset.eyes, 'gato');
});

test('agenda: agrega, ordena, filtra y borra eventos', () => {
  const a = new Agenda(new Store());
  a.add({ title: 'Clase de redes', date: '2026-11-06', time: '10:00', duration: 90 });
  const first = a.add({ title: 'Ensayo', date: '2026-11-05', time: '15:00' });
  assert.equal(a.all()[0].title, 'Ensayo');
  assert.equal(a.range('2026-11-05', '2026-11-05').length, 1);
  a.remove(first.id);
  assert.equal(a.all().length, 1);
  assert.throws(() => a.add({ title: '', date: '2026-11-05', time: '10:00' }), /título/);
  assert.throws(() => a.add({ title: 'x', date: '2026-13-45', time: '10:00' }), /fecha/);
  assert.throws(() => a.add({ title: 'x', date: '2026-11-05', time: '25:00' }), /hora/);
});

test('bandeja: guarda rutas, evita repetidos, ignora relativas y avisa si falta', () => {
  const files = { '/a/doc.pdf': { isDirectory: () => false, isFile: () => true, size: 10 } };
  const fake = { existsSync: (p) => p in files, statSync: (p) => { if (!(p in files)) throw new Error('no'); return files[p]; } };
  const t = new TrayFiles(new Store(), fake);
  let l = t.add(['/a/doc.pdf', '/a/doc.pdf', 'relativa.txt', '/no/existe']);
  assert.equal(l.length, 1);
  assert.equal(l[0].name, 'doc.pdf');
  delete files['/a/doc.pdf'];
  assert.equal(t.list()[0].missing, true);
  t.remove(l[0].id);
  assert.equal(t.list().length, 0);
});

test('portapapeles: apagado por defecto, no guarda secretos, fija y limpia', () => {
  const c = new ClipboardHistory();
  assert.equal(c.push('hola'), false);
  c.setEnabled(true);
  assert.equal(c.push('hola'), true);
  assert.equal(c.push('hola'), false);
  assert.equal(c.push('sk-ant-api03-abcdefghijklmnop1234'), false);
  assert.equal(c.push('password=secreto123'), false);
  c.push('segundo'); c.push('tercero');
  c.pin(c.items.find((i) => i.text === 'hola').id);
  c.clear();
  assert.deepEqual(c.items.map((i) => i.text), ['hola']);
  c.setEnabled(false);
  assert.equal(c.view().items.length, 0);
});

test('estadísticas: tareas terminadas, hoy y racha (con zona horaria)', () => {
  const s = new Store();
  s.upsertSession({ id: 'a', cwd: '/p/mi-web' });
  const add = (iso) => s.db.prepare(`insert into events (session_id, hook_event, summary, created_at) values ('a','Stop','Listo',?)`).run(iso);
  add('2026-11-05T20:00:00.000Z'); add('2026-11-05T22:30:00.000Z'); add('2026-11-04T18:00:00.000Z'); add('2026-11-03T18:00:00.000Z'); add('2026-10-30T18:00:00.000Z');
  const now = Date.parse('2026-11-05T23:00:00.000Z');
  const st = s.doneStats(360, now); // El Salvador: UTC-6
  assert.equal(st.tasksDone, 5);
  assert.equal(st.today, 2);
  assert.equal(st.streak, 3);
  assert.equal(s.recentDone(2).length, 2);
  assert.equal(s.recentDone(1)[0].cwd, '/p/mi-web');
});
