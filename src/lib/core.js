'use strict';
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const { safe } = require('./mask');
const { classify, describe } = require('./risk');

const NO_DECISION = null; // el servidor responde vacío y Claude Code muestra su aviso normal

const ALLOW = { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } };
const deny = (message) => ({
  hookSpecificOutput: {
    hookEventName: 'PermissionRequest',
    decision: { behavior: 'deny', message },
  },
});

/**
 * Cerebro del hito 1: recibe lo que manda Claude Code, lleva el estado de cada
 * sesión y gestiona las peticiones de permiso.
 * Regla de oro: si algo falla o se acaba el tiempo, NO se decide nada y Claude Code
 * pregunta como siempre. Nunca se permite nada por defecto.
 */
class Core extends EventEmitter {
  constructor({ store, permissionTimeoutMs = 100_000, capture = null } = {}) {
    super();
    this.store = store;
    this.permissionTimeoutMs = permissionTimeoutMs;
    this.capture = capture; // función (payload) o null
    this.pending = new Map(); // id -> { row, waiters, timer }
  }

  /** Devuelve la respuesta para Claude Code, o null si no hay decisión. */
  async handleHook(payload) {
    if (!payload || typeof payload !== 'object' || typeof payload.hook_event_name !== 'string') {
      throw Object.assign(new Error('payload inválido'), { status: 400 });
    }
    const event = payload.hook_event_name;
    const sessionId = typeof payload.session_id === 'string' && payload.session_id
      ? payload.session_id.slice(0, 200) : 'sin-sesion';
    if (this.capture) {
      try { this.capture(payload); } catch { /* la captura nunca debe romper nada */ }
    }

    this.store.upsertSession({
      id: sessionId,
      cwd: typeof payload.cwd === 'string' ? payload.cwd.slice(0, 500) : null,
      permissionMode: typeof payload.permission_mode === 'string' ? payload.permission_mode : null,
    });

    const toolName = typeof payload.tool_name === 'string' ? payload.tool_name.slice(0, 80) : null;
    const toolUseId = typeof payload.tool_use_id === 'string' ? payload.tool_use_id.slice(0, 200) : null;
    const input = payload.tool_input;

    switch (event) {
      case 'UserPromptSubmit':
        this.store.setStatus(sessionId, 'working');
        this.store.addEvent({ sessionId, hookEvent: event, summary: 'Nueva petición' });
        break;
      case 'PreToolUse':
      case 'PostToolUse': {
        this.store.setStatus(sessionId, 'working');
        const summary = `${toolName || 'herramienta'}: ${describe(toolName, input, 160)}`;
        this.store.addEvent({ sessionId, hookEvent: event, toolName, toolUseId, summary });
        this.store.setStatus(sessionId, 'working', summary);
        break;
      }
      case 'Notification': {
        const msg = safe(payload.message || 'Claude necesita tu atención', 200);
        this.store.setStatus(sessionId, 'waiting', msg);
        this.store.addEvent({ sessionId, hookEvent: event, summary: msg });
        this.emit('attention', { sessionId, message: msg, type: payload.notification_type || null });
        break;
      }
      case 'Stop': {
        const msg = safe(payload.last_assistant_message || 'Terminó', 280);
        this.store.setStatus(sessionId, 'done', msg);
        this.store.addEvent({ sessionId, hookEvent: event, summary: msg });
        this.emit('done', { sessionId, message: msg });
        break;
      }
      case 'SessionEnd':
        this.store.setStatus(sessionId, 'ended');
        this.store.addEvent({ sessionId, hookEvent: event, summary: 'Sesión terminada' });
        break;
      case 'PermissionRequest':
        return this.requestPermission({ sessionId, toolName, toolUseId, input });
      default:
        this.store.addEvent({ sessionId, hookEvent: event, summary: safe(event, 80) });
    }
    this.emitChange();
    return NO_DECISION;
  }

  requestPermission({ sessionId, toolName, toolUseId, input, signal }) {
    // Misma llamada repetida mientras sigue pendiente: comparten la decisión.
    if (toolUseId) {
      for (const entry of this.pending.values()) {
        if (entry.row.toolUseId === toolUseId) {
          return new Promise((resolve) => entry.waiters.push(resolve));
        }
      }
    }
    const id = crypto.randomUUID();
    const row = {
      id, sessionId, toolUseId, toolName: toolName || 'herramienta',
      summary: describe(toolName, input, 4000),
      risk: classify(toolName, input),
      createdAt: new Date().toISOString(),
    };
    this.store.addPermission(row);
    this.store.setStatus(sessionId, 'waiting', `Pide permiso: ${safe(row.summary, 120)}`);

    return new Promise((resolve) => {
      const entry = { row, waiters: [resolve], timer: null };
      entry.timer = setTimeout(() => this.finish(id, 'fallback', NO_DECISION), this.permissionTimeoutMs);
      this.pending.set(id, entry);
      this.emit('permission', { ...row });
      this.emitChange();
    });
  }

  /** Permitir o negar desde la isla. Devuelve false si ya no estaba pendiente. */
  decide(id, decision, reason) {
    if (!this.pending.has(id)) return false;
    if (decision === 'allow') return this.finish(id, 'allowed', ALLOW);
    if (decision === 'deny') {
      return this.finish(id, 'denied', deny(safe(reason || 'Negado desde la isla.', 200)));
    }
    return false;
  }

  /** Claude Code cerró la conexión (lo respondiste en la terminal o se canceló). */
  abandon(id) {
    if (this.pending.has(id)) this.finish(id, 'fallback', NO_DECISION);
  }

  /** Para que el servidor pueda abandonar una petición concreta si la conexión se corta. */
  pendingIdFor(toolUseId) {
    for (const [id, e] of this.pending) if (e.row.toolUseId === toolUseId) return id;
    return null;
  }

  finish(id, status, response) {
    const entry = this.pending.get(id);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    this.store.decidePermission(id, status);
    const stillWaiting = [...this.pending.values()].some((e) => e.row.sessionId === entry.row.sessionId);
    this.store.setStatus(entry.row.sessionId, stillWaiting ? 'waiting' : 'working');
    for (const resolve of entry.waiters) resolve(response);
    this.emit('permission-resolved', { id, status });
    this.emitChange();
    return true;
  }

  /** Al cerrar la app: todo lo pendiente vuelve a Claude Code sin decisión. */
  shutdown() {
    for (const id of [...this.pending.keys()]) this.finish(id, 'fallback', NO_DECISION);
  }

  pendingList() {
    return [...this.pending.values()].map((e) => ({ ...e.row }));
  }

  view() {
    const pending = this.pendingList();
    const sessions = this.store.recentSessions();
    let state = 'idle';
    if (pending.length) state = 'permission';
    else if (sessions.some((s) => s.status === 'waiting')) state = 'attention';
    else if (sessions.some((s) => s.status === 'working')) state = 'working';
    else if (sessions.some((s) => s.status === 'done')) state = 'done';
    const latest = sessions[0] || null;
    return { state, pending, sessions, latest };
  }

  emitChange() { this.emit('change', this.view()); }
}

module.exports = { Core, ALLOW, deny, NO_DECISION };
