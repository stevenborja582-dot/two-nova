-- Esquema SQLite de la app (autor: S1even). Una sola persona, una sola PC, datos locales.
-- Tiempos: texto ISO-8601 en UTC. La interfaz los muestra en hora local.
-- Aquí NO se guardan claves ni tokens: van cifrados con el almacén de Windows.
-- Las reglas de seguridad principales viven en el código; las restricciones de
-- esta base son una segunda barrera por si el código falla.

pragma foreign_keys = on;

-- Ajustes: clave y valor (JSON). Idioma, atajos, modelo de la API, tope de gasto,
-- interruptor del modo grabación, guardar o no las transcripciones, etc.
create table settings (
  key        text primary key,
  value      text not null,
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ============ Bloque 1: isla y Claude Code ============

-- Una fila por sesión de un agente. El id es el session_id que manda el agente.
create table sessions (
  id              text primary key,
  agent           text not null check (agent in ('claude-code', 'codex')),
  cwd             text,
  title           text,
  permission_mode text,
  status          text not null default 'idle'
                    check (status in ('idle', 'working', 'waiting', 'done', 'error', 'ended')),
  last_message    text,   -- recortado y sin secretos
  started_at      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_event_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ended_at        text,
  check (ended_at is null or ended_at >= started_at)
);
create index sessions_last_event on sessions (last_event_at desc);

-- Historial de actividad. Solo un resumen enmascarado, nunca el comando crudo.
create table events (
  id          integer primary key autoincrement,
  session_id  text not null references sessions (id) on delete cascade,
  hook_event  text not null,
  tool_name   text,
  tool_use_id text,
  summary     text not null,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index events_session_time on events (session_id, created_at);
create index events_tool_use on events (tool_use_id);

-- Peticiones de permiso de Claude Code. 'fallback' = no se respondió a tiempo y
-- Claude Code mostró su aviso normal. Un índice único evita registrar dos veces
-- la misma llamada.
create table permission_requests (
  id          text primary key,   -- uuid generado por la app
  session_id  text not null references sessions (id) on delete cascade,
  tool_use_id text,
  tool_name   text not null,
  summary     text not null,
  risk        text not null default 'unknown'
                check (risk in ('low', 'medium', 'high', 'unknown')),
  status      text not null default 'pending'
                check (status in ('pending', 'allowed', 'denied', 'expired', 'fallback')),
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  decided_at  text,
  check ((status = 'pending') = (decided_at is null))
);
create unique index permission_one_per_call
  on permission_requests (tool_use_id) where tool_use_id is not null;
create index permission_session_time on permission_requests (session_id, created_at);

-- ============ Bloques 2 y 3: voz, escucha y conversación ============

-- Personalidades: cada una con su voz y su estilo. La personalidad cambia el tono,
-- nunca los permisos. Se piden 5 o más, y ninguna puede repetir la misma
-- combinación de voz, velocidad y tono.
create table personalities (
  id             text primary key,
  name           text not null,
  voice_provider text not null default 'piper'
                   check (voice_provider in ('piper', 'windows', 'cloud')),
  voice_id       text not null,      -- 'por-asignar' hasta elegir la voz real
  rate           real not null default 1.0 check (rate between 0.5 and 2.0),
  pitch          real not null default 1.0 check (pitch between 0.5 and 2.0),
  style_prompt   text not null,
  color          text not null
                   check (color glob '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
  greeting       text,
  sort_order     integer not null default 0,
  enabled        integer not null default 1 check (enabled in (0, 1))
);
create unique index personalities_voz_unica
  on personalities (voice_provider, voice_id, rate, pitch);

create table conversations (
  id             text primary key,   -- uuid
  personality_id text references personalities (id) on delete set null,
  started_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ended_at       text
);

-- Transcripciones. El audio NUNCA se guarda. Guardar el texto es opcional
-- (Ajustes) y se purga con el tiempo.
create table messages (
  id              integer primary key autoincrement,
  conversation_id text not null references conversations (id) on delete cascade,
  role            text not null check (role in ('user', 'assistant', 'tool')),
  body            text not null,
  created_at      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index messages_conversation on messages (conversation_id, created_at);

-- ============ Bloque 4: control de la PC ============

-- Lista blanca: lo único que la app puede tocar.
create table allowlist (
  id         integer primary key autoincrement,
  kind       text not null check (kind in ('folder', 'app', 'site')),
  value      text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (kind, value)
);

-- Permisos temporales concedidos con un clic. Solo niveles 1 y 2: el nivel 3
-- nunca se concede por adelantado, se confirma acción por acción.
create table grants (
  id         text primary key,   -- uuid
  tool       text not null,
  scope      text,
  level      integer not null check (level in (1, 2)),
  expires_at text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revoked_at text
);
create index grants_activos on grants (tool, expires_at);

-- Registro de todo lo que la app propone o hace.
-- confirmed_by solo admite 'clic' o 'permiso_vigente': no existe la opción 'voz',
-- así que una confirmación por voz no se puede registrar.
create table action_log (
  id              integer primary key autoincrement,
  conversation_id text references conversations (id) on delete set null,
  tool            text not null,
  level           integer not null check (level between 0 and 3),
  summary         text not null,
  origin          text not null default 'usuario'
                    check (origin in ('usuario', 'contenido_externo')),
  status          text not null default 'propuesta'
                    check (status in ('propuesta', 'confirmada', 'negada', 'ejecutada', 'fallida', 'cancelada')),
  confirmed_by    text check (confirmed_by in ('clic', 'permiso_vigente')),
  created_at      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at     text,
  error           text,
  -- niveles 2 y 3: nada se confirma, ejecuta ni falla sin una confirmación registrada
  check (level < 2 or status in ('propuesta', 'negada', 'cancelada') or confirmed_by is not null),
  -- nivel 3: solo con clic en esa acción, nunca con un permiso vigente
  check (level < 3 or confirmed_by is null or confirmed_by = 'clic')
);
create index action_log_time on action_log (created_at desc);

-- ============ Bloque 5: conectores ============

-- Estado de cada app conectada. Aquí no hay tokens ni claves.
-- BingX solo puede ser de solo lectura: la base rechaza cualquier otra cosa.
create table connectors (
  id           text primary key
                 check (id in ('gmail', 'calendar', 'classroom', 'spotify', 'github', 'bingx', 'chrome', 'files', 'vscode')),
  status       text not null default 'desconectado'
                 check (status in ('desconectado', 'conectado', 'error')),
  account      text,
  scopes       text not null default '[]',
  read_only    integer not null default 1 check (read_only in (0, 1)),
  connected_at text,
  check (id <> 'bingx' or read_only = 1)
);

-- ============ Utilidades ============

create table notes (
  id         integer primary key autoincrement,
  body       text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Historial del portapapeles: sensible, apagado por defecto desde Ajustes.
create table clipboard_items (
  id         integer primary key autoincrement,
  content    text not null,
  pinned     integer not null default 0 check (pinned in (0, 1)),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index clipboard_created on clipboard_items (created_at desc);

-- ============ Datos iniciales (editables) ============

-- Cinco personalidades de partida. Las voces reales se asignan al instalar las
-- voces locales; hasta entonces cada una se distingue por velocidad y tono.
insert into personalities (id, name, voice_id, rate, pitch, style_prompt, color, greeting, sort_order) values
  ('mayordomo', 'Mayordomo', 'por-asignar', 0.95, 0.95,
   'Formal, preciso y breve. Sin bromas.',
   '#4A5568', 'A sus órdenes.', 1),
  ('compa', 'Compa', 'por-asignar', 1.10, 1.05,
   'Casual y bromista, como un amigo cercano. Frases cortas y naturales.',
   '#F6AD55', '¿Qué hacemos?', 2),
  ('profe', 'Profe', 'por-asignar', 0.90, 1.00,
   'Paciente y claro. Explica paso a paso y comprueba que se entendió. Pensado para las tareas del colegio.',
   '#48BB78', 'Vamos con calma, paso a paso.', 3),
  ('coach', 'Coach', 'por-asignar', 1.15, 1.00,
   'Directo y motivador. Va al grano y empuja a terminar lo pendiente.',
   '#ED8936', 'Vamos, a terminar lo pendiente.', 4),
  ('seco', 'Seco', 'por-asignar', 0.95, 0.85,
   'Humor seco y sarcasmo suave. Muy breve. Nunca bromea con los avisos de permisos.',
   '#A0AEC0', 'Aquí estoy. Qué emoción.', 5);

-- Las apps nacen desconectadas y en solo lectura.
insert into connectors (id) values
  ('gmail'), ('calendar'), ('classroom'), ('spotify'), ('github'),
  ('bingx'), ('chrome'), ('files'), ('vscode');
