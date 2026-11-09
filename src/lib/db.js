'use strict';
// Base de datos local (SQLite integrado en Node, sin instalar nada extra).
// Aquí solo se guardan resúmenes enmascarados: nunca el comando crudo ni claves.
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
pragma foreign_keys = on;
create table if not exists settings (
  key text primary key, value text not null,
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create table if not exists sessions (
  id text primary key,
  agent text not null check (agent in ('claude-code','codex')),
  cwd text, title text, permission_mode text,
  status text not null default 'idle'
    check (status in ('idle','working','waiting','done','error','ended')),
  last_message text,
  started_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_event_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ended_at text
);
create index if not exists sessions_last_event on sessions (last_event_at desc);
create table if not exists events (
  id integer primary key autoincrement,
  session_id text not null references sessions (id) on delete cascade,
  hook_event text not null, tool_name text, tool_use_id text,
  summary text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index if not exists events_session_time on events (session_id, created_at);
create table if not exists permission_requests (
  id text primary key,
  session_id text not null references sessions (id) on delete cascade,
  tool_use_id text, tool_name text not null, summary text not null,
  risk text not null default 'unknown' check (risk in ('low','medium','high','unknown')),
  status text not null default 'pending'
    check (status in ('pending','allowed','denied','expired','fallback')),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  decided_at text,
  check ((status = 'pending') = (decided_at is null))
);
create unique index if not exists permission_one_per_call
  on permission_requests (tool_use_id) where tool_use_id is not null;
create index if not exists permission_session_time on permission_requests (session_id, created_at);
`;

const now = () => new Date().toISOString();

class Store {
  constructor(file = ':memory:') {
    this.db = new DatabaseSync(file);
    this.db.exec(SCHEMA);
  }

  upsertSession({ id, cwd, permissionMode, agent = 'claude-code' }) {
    this.db.prepare(`
      insert into sessions (id, agent, cwd, permission_mode, status, started_at, last_event_at)
      values (?, ?, ?, ?, 'idle', ?, ?)
      on conflict(id) do update set
        cwd = coalesce(excluded.cwd, sessions.cwd),
        permission_mode = coalesce(excluded.permission_mode, sessions.permission_mode),
        last_event_at = excluded.last_event_at,
        ended_at = null,
        status = case when sessions.status = 'ended' then 'idle' else sessions.status end
    `).run(id, agent, cwd ?? null, permissionMode ?? null, now(), now());
  }

  setStatus(id, status, lastMessage) {
    this.db.prepare(`
      update sessions set status = ?, last_event_at = ?,
        last_message = coalesce(?, last_message),
        ended_at = case when ? = 'ended' then ? else ended_at end
      where id = ?
    `).run(status, now(), lastMessage ?? null, status, now(), id);
  }

  addEvent({ sessionId, hookEvent, toolName, toolUseId, summary }) {
    this.db.prepare(`
      insert into events (session_id, hook_event, tool_name, tool_use_id, summary, created_at)
      values (?, ?, ?, ?, ?, ?)
    `).run(sessionId, hookEvent, toolName ?? null, toolUseId ?? null, summary, now());
  }

  addPermission({ id, sessionId, toolUseId, toolName, summary, risk }) {
    const insert = (tid) => this.db.prepare(`
      insert into permission_requests (id, session_id, tool_use_id, tool_name, summary, risk, created_at)
      values (?, ?, ?, ?, ?, ?, ?)
    `).run(id, sessionId, tid, toolName, summary, risk, now());
    try {
      insert(toolUseId ?? null);
    } catch (e) {
      // El mismo tool_use_id ya se registró antes (un reintento): se guarda sin él.
      if (/UNIQUE/i.test(String(e.message))) insert(null); else throw e;
    }
  }

  decidePermission(id, status) {
    this.db.prepare(`
      update permission_requests set status = ?, decided_at = ? where id = ? and status = 'pending'
    `).run(status, now(), id);
  }

  expirePendingOnStart() {
    this.db.prepare(`
      update permission_requests set status = 'expired', decided_at = ? where status = 'pending'
    `).run(now());
    this.db.prepare(`update sessions set status = 'idle' where status in ('working','waiting')`).run();
  }

  recentSessions(limit = 8) {
    return this.db.prepare(`
      select id, cwd, status, last_message as lastMessage, last_event_at as lastEventAt
      from sessions where status <> 'ended' order by last_event_at desc limit ?
    `).all(limit);
  }

  recentEvents(sessionId, limit = 20) {
    return this.db.prepare(`
      select hook_event as hookEvent, tool_name as toolName, summary, created_at as createdAt
      from events where session_id = ? order by id desc limit ?
    `).all(sessionId, limit);
  }

  recentPermissions(limit = 20) {
    return this.db.prepare(`
      select id, session_id as sessionId, tool_name as toolName, summary, risk, status, created_at as createdAt
      from permission_requests order by created_at desc limit ?
    `).all(limit);
  }

  /** Tareas terminadas (cada aviso "Stop" de Claude Code), sacadas del historial. */
  doneStats(tzOffsetMin = 0, nowMs = Date.now()) {
    const rows = this.db.prepare(`select created_at from events where hook_event = 'Stop' order by id desc limit 5000`).all();
    const day = (ms) => new Date(ms - tzOffsetMin * 60000).toISOString().slice(0, 10);
    const today = day(nowMs);
    const days = new Set(rows.map((r) => day(Date.parse(r.created_at))));
    const todayCount = rows.filter((r) => day(Date.parse(r.created_at)) === today).length;
    let streak = 0; let cursor = nowMs;
    if (!days.has(day(cursor))) cursor -= 86400000; // si hoy aún no hay, la racha puede venir de ayer
    while (days.has(day(cursor))) { streak += 1; cursor -= 86400000; }
    return { tasksDone: rows.length, today: todayCount, streak };
  }

  recentDone(limit = 20) {
    return this.db.prepare(`
      select e.summary, e.created_at as createdAt, s.cwd
      from events e join sessions s on s.id = e.session_id
      where e.hook_event = 'Stop' order by e.id desc limit ?
    `).all(limit);
  }

  // Borra historial viejo (por defecto, más de 30 días).
  purge(days = 30) {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    this.db.prepare(`delete from events where created_at < ?`).run(cutoff);
    this.db.prepare(`delete from permission_requests where created_at < ? and status <> 'pending'`).run(cutoff);
    this.db.prepare(`delete from sessions where last_event_at < ? and id not in (select session_id from permission_requests where status='pending')`).run(cutoff);
  }

  getSetting(key, fallback = null) {
    const row = this.db.prepare('select value from settings where key = ?').get(key);
    if (!row) return fallback;
    try { return JSON.parse(row.value); } catch { return fallback; }
  }

  setSetting(key, value) {
    this.db.prepare(`
      insert into settings (key, value, updated_at) values (?, ?, ?)
      on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at
    `).run(key, JSON.stringify(value), now());
  }

  close() { this.db.close(); }
}

module.exports = { Store };
