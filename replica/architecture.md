# Arquitectura: Two-Nova (autor S1even; uso personal, Windows)

Fecha: 2026-11-05 (versión 2: añade voz, escucha, control de la PC y conexión con apps)
Lee: `s1even.md`, `recon.md`, `features.csv`. Escribe: este archivo y `schema.sql`.

## Decisiones de partida

- **Uso personal, un usuario, una PC.** Autor: S1even. No hay cuentas, pagos, licencias ni servidor propio. Se saltan `/replica-entrepreneur`, `/replica-launch` y `/replica-deploy`. La ruta es: `design → build → backend → test → diff`. De `/replica-brand` queda solo la limpieza (`sweep.py`) y la mascota propia.
- **Hecha para modificar.** Cada pieza es un módulo pequeño. Todo el código se escribe desde cero. No se toma ni se bifurca el repositorio del original: su README no declara licencia, y sin licencia no hay permiso para reutilizarlo.
- **Dónde se construye y dónde se prueba.** Aquí se construye en un entorno Linux. La lógica (servidor de hooks, base de datos, máquina de estados, niveles de permiso, conectores) se prueba completa aquí. Lo que depende de tu equipo solo lo puedes validar tú en Windows: el comportamiento real de la ventana, el micrófono, los altavoces, las voces instaladas y el control de mouse y teclado. Cada hito termina con una prueba corta que haces tú.

## Los cinco bloques

Cada bloque se puede usar solo. El bloque 1 funciona sin los demás.

| bloque | qué hace | de qué depende |
| --- | --- | --- |
| 1. Isla y Claude Code | muestra lo que hace Claude Code y te deja permitir o negar | hooks oficiales de Claude Code |
| 2. Voz | habla con 5 o más personalidades | motor de voz local; nube opcional |
| 3. Escucha | te oye cuando pulsas un atajo | motor de reconocimiento local |
| 4. Cerebro y control | piensa, decide y actúa, con permisos por niveles | API de Claude con tu clave |
| 5. Conectores | enlaza tus apps | APIs oficiales con tus cuentas y claves |

## Stack

| capa | elección | por qué |
| --- | --- | --- |
| app de escritorio | Electron + TypeScript | un solo lenguaje web; ventanas transparentes, siempre encima y sin foco; bandeja y atajos globales. Alternativa: Tauri (menos RAM, pero exige Rust) |
| interfaz | HTML + CSS moderno + TypeScript, sin framework (Vite) | pocas pantallas; los tokens van como variables CSS; fácil de retocar |
| estado | máquina de estados pequeña en el proceso principal | determinista y fácil de probar |
| servidor local | `node:http` solo en `127.0.0.1` | recibe los avisos de Claude Code y la vuelta de los inicios de sesión de tus apps |
| datos | SQLite (`better-sqlite3`) en `%APPDATA%` | historial local. Plan B si compilarlo da problemas: un archivo JSON |
| cerebro | API de Claude con tu clave. Modelo por defecto `claude-sonnet-5-5`, cambiable en Ajustes | conversa, usa herramientas y puede usar la herramienta de uso de computadora |
| voz saliente | Piper (local); voces de Windows como respaldo; nube opcional por personalidad | gratis y sin internet; la nube solo si tú la activas |
| escucha | pulsar para hablar + un motor local tipo whisper.cpp (modelo pequeño multilingüe) | el audio no sale de la PC |
| control de pantalla | `desktopCapturer` de Electron para ver; un módulo nativo (por ejemplo nut.js) para mouse y teclado | se elige y se valida en tu PC; es lo último que se construye |
| secretos | `safeStorage` de Electron (almacén de Windows) | claves y tokens cifrados, nunca en texto plano ni en la base |
| conectores | SDK o API oficial de cada servicio; inicio de sesión de escritorio con PKCE por `127.0.0.1` | sin contraseñas en la app |
| pruebas | Vitest (lógica) y Playwright con Electron (interfaz) | corren en el entorno de aquí |
| empaquetado | `electron-builder` (instalador NSIS) compilado en tu PC | un archivo compilado por ti normalmente no lleva la marca de "descargado de internet", así que Windows no muestra el aviso de SmartScreen |

Electron consume más memoria que Tauri. Con la isla siempre abierta, más el reconocimiento y la voz locales, se mide el consumo en el corte vertical y se decide con datos.

## Bloque 1: cómo se conecta con Claude Code

Fuente: https://code.claude.com/docs/en/hooks, leída el 2026-11-05 (cerca de 100.000 de 109.549 caracteres).

**Confirmado:**

- Existe el evento `PermissionRequest`: salta cuando una llamada necesita decisión. Se responde con `hookSpecificOutput.decision.behavior` igual a `allow` o `deny`.
- Un hook puede ser de tipo `http`: Claude Code hace un POST con el JSON del evento. Una respuesta 2xx con JSON se toma como decisión; una 2xx vacía significa "sin decisión".
- Si la conexión falla, el servidor responde distinto de 2xx o se acaba el tiempo, **no se bloquea nada** y Claude Code muestra su aviso normal. Solo bloquea con `onFailure: "block"` (requiere Claude Code 2.1.295 o superior). Nosotros no lo usamos.
- El tiempo de espera por defecto de un hook http es 600 segundos.
- `headers` acepta valores literales o variables de entorno listadas en `allowedEnvVars`.
- Los hooks se configuran en `~/.claude/settings.json`, `.claude/settings.json` o `.claude/settings.local.json`.
- `SessionStart` solo admite hooks `command` o `mcp_tool`, no `http`.
- `Notification` trae tipos como `permission_prompt`, `idle_prompt`, `agent_needs_input` y `agent_completed`, y no decide nada.
- `Stop` entrega `last_assistant_message`.
- `PreToolUse` salta antes que `PermissionRequest`.
- Los hooks corren con los permisos de tu usuario de Windows.

**No confirmado (se verifica en el corte vertical):**

1. Los campos exactos que recibe `PermissionRequest`.
2. Los campos de `Notification` más allá de `message`.
3. Si `PreToolUse` y `PermissionRequest` disparan ambos para la misma llamada.
4. Qué eventos aceptan hooks http, además de `SessionStart`.
5. Si Codex tiene un sistema parecido (no lo leí).
6. Si existe una fuente oficial para el anillo de uso de las 5 horas.

Para no suponer, el **modo grabación** guarda una copia de los avisos reales (con secretos enmascarados) en un archivo local, y con esas muestras se escriben los lectores.

**Regla de oro: si algo falla, Claude Code muestra su aviso de siempre.** La isla nunca niega ni aprueba por accidente, y nunca aprueba sola.

```
Claude Code --POST /hook--> servidor local (127.0.0.1)
                                  |
                           máquina de estados --> isla (ocupado / pide permiso / terminó)
                                  ^                        |
            respuesta JSON <------+---- clic en Permitir o Negar
(sin respuesta a tiempo: 2xx vacía --> sale el aviso normal de Claude Code)
```

Como `SessionStart` no admite http, la sesión se crea al recibir el primer evento de cualquier tipo.

## Bloque 4: cerebro y control de la PC

### El cerebro

- Usa la API de Claude con tu clave. Responde por streaming y llama a **herramientas** con esquema JSON.
- Las herramientas directas son el camino principal: abrir una app, subir el volumen, poner una canción, leer la agenda. Son rápidas, baratas y predecibles.
- El **uso de pantalla** (ver y pulsar como una persona) es el último recurso. La documentación de la API lo describe como una herramienta del lado del cliente: la app tiene que implementar cada acción y el bucle del agente. Está disponible en los modelos Claude 5.5 con `computer_toolset_20260801`, sin cabecera beta (fuente: https://platform.claude.com/docs/en/build-with-claude/computer-use.md, leída el 2026-11-05, 100.000 de 120.292 caracteres).
- Cada captura cuesta aproximadamente entre 1.000 y 1.800 tokens de entrada, según esa documentación. Por eso hay un límite de pasos por tarea y un tope mensual configurable.
- **Quién decide los permisos es el código, no el modelo.** Cada herramienta declara su nivel y el ejecutor decide si hay que pedir confirmación. El modelo no puede cambiar niveles ni saltarse la lista blanca.
- El modelo nunca ve tus claves: las herramientas las usan por dentro.

### Los niveles

| nivel | qué entra | cómo se confirma |
| --- | --- | --- |
| 0 | conversar y responder | no hace falta |
| 1 | abrir apps y páginas de la lista blanca, música y volumen, ver la agenda, las tareas de Classroom, el estado de GitHub y los precios de BingX | no hace falta; todo queda en el registro |
| 2 | crear o editar archivos en carpetas permitidas, mover a la papelera, redactar borradores, crear eventos, commits locales, mouse y teclado sobre la pantalla | un clic en Permitir en la isla; se puede conceder por tiempo limitado (por defecto 1 hora) para una herramienta concreta |
| 3 | enviar correos o mensajes, entregar tareas, `git push`, instalar programas, borrar, cambiar ajustes del sistema, ejecutar comandos de terminal | un clic en cada acción, mostrando el contenido exacto; no se puede conceder por adelantado |
| nunca | contraseñas y claves, pagos y transferencias, comprar, vender o retirar en BingX, desactivar antivirus o firewall, borrar de forma permanente, tocar lo que no está en la lista blanca, cambiar sus propios permisos | no existe la herramienta |

Reglas de las confirmaciones:

- **Solo por clic, nunca por voz.** Un video, la tele o una persona cerca podrían decir "sí". La base de datos ni siquiera admite registrar una confirmación por voz.
- **Contenido externo.** Si el modelo propone una acción después de leer un correo, una página, un archivo o una tarea de Classroom, la acción se marca con "origen: contenido externo" y pide confirmación aunque sea de nivel 1. Ese contenido es información, nunca órdenes.
- **Parada de emergencia.** Un botón en la isla y un atajo global cancelan la acción en curso, detienen la voz, cierran el micrófono y revocan los permisos temporales.
- **Registro.** Todo lo que la app propone o hace queda en `action_log`: qué, cuándo, con qué nivel y quién confirmó.
- **Uso de pantalla en tu PC real.** La documentación recomienda una máquina virtual, pocos privilegios y confirmación humana en decisiones importantes. Aquí no hay máquina virtual, así que se añade: una lista de ventanas que nunca se capturan ni se tocan (gestor de contraseñas, bancos, BingX), un borde visible mientras controla, y solo desde el nivel 2.

## Bloque 2: voz y personalidades

- **Motor.** Piper, local y gratuito. Hay voces en español de Argentina, España y México (la carpeta de voces lo confirma). Los nombres y la cantidad exacta de voces no los pude ver; se confirman al descargarlas. Cada voz trae su propia licencia y hay que revisarla.
- **Cinco o más personalidades.** Cada una es un perfil editable: nombre, voz, velocidad, tono, estilo, color de la mascota y saludo. El esquema trae cinco de partida (Mayordomo, Compa, Profe, Coach y Seco) y rechaza dos perfiles con la misma combinación de voz, velocidad y tono. Si no salen cinco voces de Piper que te gusten, el resto usa voces de Windows o una voz en la nube.
- **Nube opcional.** Cada personalidad puede apuntar a un proveedor en la nube con tu propia clave. Eso envía el texto a un tercero y se activa solo por personalidad.
- **La personalidad solo cambia el tono.** Los avisos de permisos siempre se dicen y se muestran con claridad, y los permisos no dependen de la personalidad.
- **Cambiar de personalidad:** por voz ("pásate a Profe"), con un atajo o desde Ajustes.
- **Fluidez.** La respuesta del modelo llega por frases y cada frase se convierte en voz mientras llega la siguiente. Si empiezas a hablar, la voz se corta.

## Bloque 3: escucha

- **Pulsar para hablar** con un atajo global configurable. El micrófono solo está abierto mientras lo pulsas, con un indicador visible en la isla y un sonido de aviso.
- **Reconocimiento local** con un modelo multilingüe pequeño. El audio no se guarda y no sale de la PC. Si más adelante quieres un servicio en la nube, es una opción aparte.
- **Mientras habla, no escucha**, para que no se oiga a sí mismo.
- **Palabra de activación** ("Hola Two-Nova"): opcional y apagada por defecto, porque deja el micrófono abierto.
- Guardar el texto de las conversaciones es opcional y se purga con el tiempo. El audio nunca se guarda.

## Bloque 5: conectores

Todos usan la vía oficial, con tus cuentas y tus claves. Tú creas las cuentas y las claves; la app nunca escribe contraseñas por ti.

| app | vía | permisos mínimos | lo que pide confirmación | avisos |
| --- | --- | --- | --- | --- |
| Gmail y Calendario | APIs de Google, inicio de sesión de escritorio con PKCE | leer correo, crear borradores, leer y crear eventos | enviar correos (nivel 3), crear eventos (nivel 2) | en modo de prueba de Google los permisos pueden caducar a la semana (por verificar al crear el proyecto) |
| Classroom | API de Classroom | solo lectura al inicio | entregar una tarea (nivel 3) | tu cuenta del colegio es distinta de tu Gmail y su administración puede bloquear apps externas. Si lo bloquea, se lee desde el navegador con tu supervisión |
| Spotify | API web de Spotify | leer estado y controlar reproducción | ninguna (nivel 1) | controlar la reproducción exige Spotify Premium |
| Chrome y archivos | abrir URLs con el sistema; archivos con la lista blanca de carpetas | solo lo que esté en la lista blanca | crear o editar archivos (nivel 2), borrar (nivel 3) | solo las carpetas que tú permitas |
| GitHub y VS Code | `git`, el comando `code` y la API de GitHub con un acceso limitado | ver estado, abrir proyectos, commits locales | `git push` (nivel 3) | acceso de GitHub con los permisos mínimos |
| BingX | API de BingX con una clave de **solo lectura** | precios, saldo y alertas | no hay nada que confirmar: **no existe ninguna herramienta para operar, transferir ni retirar** | al crear la clave en BingX hay que marcar solo lectura (por confirmar que permita esa opción). No da consejos de inversión |

Por qué BingX es solo lectura: mover dinero no se deshace. Un reconocimiento de voz equivocado, una voz del ambiente o un texto escondido en una página podrían disparar una orden. La base de datos rechaza marcar BingX como no solo lectura.

## Esquema

Archivo: `schema.sql` (SQLite). 13 tablas, probadas aquí.

| grupo | tablas |
| --- | --- |
| general | `settings` |
| isla y Claude Code | `sessions`, `events`, `permission_requests` |
| voz y conversación | `personalities`, `conversations`, `messages` |
| control de la PC | `allowlist`, `grants`, `action_log` |
| conectores | `connectors` |
| utilidades | `notes`, `clipboard_items` |

- **Dueño de los datos:** no hay columna de usuario, porque la base es de una sola persona y vive en su PC.
- **Reglas de acceso:** no hay políticas por fila. Protege que el servidor solo escucha en `127.0.0.1` con un token secreto. Las reglas de seguridad principales viven en el código, y la base añade una segunda barrera: nivel 3 nunca con permiso vigente, nunca una confirmación por voz, BingX siempre solo lectura y cinco o más personalidades con voces distintas.
- **Secretos:** claves y tokens no están en la base; van cifrados con el almacén de Windows.
- **Tiempos:** texto ISO-8601 en UTC; la interfaz los muestra en hora local.

## API local

| método y ruta | qué hace | quién | entrada | salida | flujo |
| --- | --- | --- | --- | --- | --- |
| `POST /hook` | recibe cualquier evento de Claude Code | solo `127.0.0.1` con la cabecera `X-Island-Token` | JSON del hook | 2xx vacía (solo observar), o 2xx con JSON de decisión en `PermissionRequest`, que espera tu clic | F02, F03, F04 |
| `GET /health` | confirmar que la isla está viva (botón "Probar conexión") | local, con token | nada | `{ok, version}` | F01 |
| `GET /oauth/callback` | recibe la vuelta del inicio de sesión de una app | el navegador, solo en `127.0.0.1` | `code` y `state` | página de "listo, puedes cerrar esto". Se rechaza si el `state` no coincide | conectores |

Llamadas hacia afuera: API de Claude, APIs de Google, Spotify, GitHub y BingX (lectura). Webhooks de entrada: solo el de Claude Code.

Canales internos (interfaz y proceso principal, no son HTTP):

| grupo | canales | pantallas |
| --- | --- | --- |
| isla | `state:subscribe`, `window:setSize` | S02 a S07 |
| permisos de Claude Code | `permission:decide` | S04 |
| hooks | `hooks:preview`, `hooks:install`, `hooks:uninstall` | S12 |
| historial | `history:list` | S06 |
| ajustes | `settings:get`, `settings:set`, `capture:toggle` | S12 |
| voz y escucha | `voice:speak`, `voice:stop`, `listen:start`, `listen:stop`, `personality:list`, `personality:set` | isla |
| cerebro | `brain:send` | isla |
| control | `action:confirm`, `action:cancel`, `panic:stop`, `grants:list`, `grants:revoke`, `allowlist:list`, `allowlist:add`, `allowlist:remove`, `actions:list` | confirmación, Ajustes, registro |
| conectores | `connector:connect`, `connector:disconnect`, `connector:status` | Ajustes |

Tareas programadas:

- Purgar historial viejo y transcripciones (por defecto 30 días, configurable) al arrancar y cada 24 horas.
- Expirar peticiones de permiso pendientes pasado el tiempo límite (por defecto 120 segundos): se responde 2xx vacía y sale el aviso normal.
- Cerrar sesiones sin eventos desde hace un rato.
- Caducar los permisos temporales.
- Renovar los tokens de las apps conectadas.

## Las partes que muerden

**Claude Code y la isla**

- **Fallar con seguridad.** Prueba obligatoria: apagar la isla con una petición pendiente y comprobar que Claude Code muestra su aviso.
- **Eventos duplicados y desordenados.** Se deduplica por `tool_use_id`.
- **Esquemas sin confirmar.** Lectores tolerantes y modo grabación.
- **Modos de permiso.** Con `acceptEdits` o `bypassPermissions` no llegan peticiones para lo ya aprobado; la isla solo observa y lo indica.
- **Versión de Claude Code.** El instalador de hooks comprueba la versión antes de escribir.
- **Tocar `~/.claude/settings.json`.** Solo con un botón explícito, con vista previa, copia de seguridad y entradas marcadas como propias, para desinstalar sin tocar nada más.

**Voz, escucha y control**

- **Audio del ambiente.** Por eso pulsar para hablar y confirmar solo con clic.
- **Instrucciones escondidas en correos, páginas o archivos.** El contenido leído es información; las acciones que propone el modelo tras leerlo llevan etiqueta y piden confirmación.
- **Personalidad contra seguridad.** La personalidad no puede relajar permisos, porque las reglas están en el código.
- **Uso de pantalla en tu PC real.** Lista de ventanas bloqueadas, borde visible, parada de emergencia y nivel 2 como mínimo.
- **Secretos.** Cifrados con el almacén de Windows, nunca en registros, en la base ni en lo que ve el modelo.
- **Costo.** Capturas de pantalla caras, límite de pasos y tope mensual.
- **Recursos.** Electron, el reconocimiento de voz y la voz local a la vez. Se miden en reposo y en uso, y se eligen modelos pequeños.
- **Retraso al hablar.** Se mide con respuesta por frases; es la prueba más sensible del hito de voz.
- **Privacidad.** Al modelo le llegan tus transcripciones y, con control de pantalla, capturas. El audio no sale de la PC.
- **Permisos de Google.** Verificar el modo de prueba, y que el administrador del colegio no bloquee Classroom.
- **Spotify.** Sin Premium no se puede controlar la reproducción.
- **BingX.** Solo lectura, y sin consejos de inversión.

**Ventana de Windows**

- No robar el foco, varios monitores, escalado DPI y pantallas completas. Se prueba en tu PC.

## Estructura de carpetas

```
src/main/        servidor local, base de datos, máquina de estados, ventanas, bandeja, ejecutor de permisos
src/preload/     puente seguro entre la interfaz y el proceso principal
src/renderer/    isla, confirmaciones y ajustes (HTML, CSS, TS)
src/adapters/    un módulo por agente de código (claude-code, codex)
src/brain/       conversación con la API de Claude, herramientas y bucle del agente
src/voice/       voz saliente y escucha
src/control/     niveles, lista blanca, permisos temporales, registro, parada de emergencia
src/connectors/  un módulo por app (gmail, calendar, classroom, spotify, github, bingx, chrome, files, vscode)
src/widgets/     utilidades pequeñas (portapapeles, nota, bandeja de archivos)
src/shared/      tipos, constantes y marca (brand.ts)
assets/          mascota y sonidos propios
tests/           unitarias y de interfaz
```

Para que sea fácil de modificar, cada pieza cumple una interfaz pequeña:

- Adaptador: `parse(evento) → EventoInterno`, `respond(decisión) → respuesta`, `install()` y `uninstall()`.
- Conector: `id`, `scopes`, `connect()`, `disconnect()` y una lista de herramientas, cada una con su `level`.
- Herramienta: `name`, `level`, `schema`, `describe(args)` (el texto exacto que se muestra al confirmar) y `run(args)`.
- Widget: `id`, `title`, `render()`, `onEvent()`.

Añadir una app o una herramienta nueva es añadir una carpeta o un archivo, sin tocar el resto. Una herramienta nueva sin nivel declarado no se puede registrar.

## Orden de construcción

1. **Corte vertical de la isla** (pantallas S02 a S05; tablas `sessions`, `events`, `permission_requests`; rutas `/hook` y `/health`). Ventana de la isla, servidor local, hooks conectados a mano y modo grabación; estados reposo, ocupado y terminado; petición de permiso Permitir o Negar de ida y vuelta. Éxito: pedirle a Claude Code un `npm install` y aprobarlo desde la isla; apagar la app y ver que sale el aviso normal.
2. **Imprescindibles de la isla** (S12 mínimo): Ajustes con Conectar y Desconectar, colores de estado, todo en local, instalador y arranque con Windows.
3. **Voz.** Tablas `personalities`, `settings`. Instalar las voces, asignar una a cada personalidad, hacer hablar a la mascota con frases de prueba. Éxito: cinco personalidades que suenan distintas y la voz que se corta cuando pulsas el atajo. Lo pruebas tú en tu PC.
4. **Escucha y cerebro.** Pulsar para hablar, reconocimiento local y conversación con la API de Claude, **sin control todavía**. Éxito: una conversación hablada con cada personalidad.
5. **Control por niveles con herramientas directas.** Lista blanca, niveles, tarjeta de confirmación, registro, permisos temporales y parada de emergencia. Primeras herramientas: abrir apps y volumen. Éxito: una acción de nivel 3 no se ejecuta sin clic, y la parada de emergencia corta una acción en curso.
6. **Conectores, uno por uno**, en este orden: Spotify, Chrome y archivos, GitHub y VS Code, Gmail y Calendario, Classroom, BingX en solo lectura.
7. **Uso de pantalla** (último, nivel 2 como mínimo).
8. **Extras:** historial y vista expandida (S06), atajo global, aviso nativo, Codex, mascota con estados y personalización, idioma español e inglés, utilidades. El anillo de uso solo si aparece una fuente oficial.
