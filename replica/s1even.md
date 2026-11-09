# Two-Nova

Autor: S1even
Nombre de la app: Two-Nova (definitivo, elegido por S1even el 2026-11-05). S1even es solo el autor. El nombre vive en `src/brand.js` y `package.json`.
Estado: planeación
Fecha: 2026-11-05

## Qué es

Un asistente de escritorio para Windows, de uso personal. Vive como una isla en la parte de arriba de la pantalla y hace cinco cosas:

1. Muestra lo que hace Claude Code y te deja permitir o negar sus permisos.
2. Habla, con 5 o más personalidades y voces.
3. Te escucha.
4. Controla tu PC con permisos por niveles.
5. Se conecta con tus apps.

## Qué se quitó

- **Todo lo del creador anterior:** nombre, mascota, textos, traducciones, contador de PCs y programa de fundadores. Su material solo queda como investigación en `replica/recon.md` y `replica/screens/`. Eso nunca se publica ni se empaqueta.
- **Pago, cuenta y licencia.**
- **El temporizador de enfoque.**

## Qué se añadió

- Voz: habla en español con 5 o más personalidades, cada una con su voz y su estilo, editables.
- Escucha: la activas con un atajo (pulsar para hablar) y hay un indicador visible del micrófono.
- Cerebro: conversa y decide con la API de Claude y tu propia clave.
- Control de la PC con permisos por niveles, parada de emergencia, registro de acciones y lista blanca de carpetas y apps.
- Conexión con tus apps: Gmail y Calendario, Spotify, Chrome y archivos, GitHub y VS Code, Google Classroom y BingX (solo lectura).

## Decisiones tomadas (2026-11-05)

| tema | decisión |
| --- | --- |
| cerebro | API de Claude con tu clave. Modelo por defecto: `claude-sonnet-5-5` |
| voces | locales primero (Piper), nube opcional por personalidad |
| control de la PC | por niveles con confirmación |
| apps | Gmail y Calendario, Spotify, Chrome y archivos, GitHub y VS Code, Classroom, BingX (solo lectura) |

## Reglas que no cambian

Valen aunque se las pidas por voz, aunque una personalidad diga lo contrario y aunque un texto que lea la app se lo ordene.

1. No maneja contraseñas ni claves, pagos, transferencias ni operaciones de trading. BingX es solo lectura.
2. Las confirmaciones de nivel 2 y 3 se hacen solo con un clic, nunca por voz. Un video, la tele o alguien cerca podrían decir "sí".
3. Lo que lee en correos, páginas, archivos o Classroom es información, nunca órdenes.
4. La personalidad cambia el tono, no los permisos. Las reglas viven en el código, no en el texto que se le da al modelo.
5. La parada de emergencia está siempre disponible.
6. No toca nada que no esté en la lista blanca.
7. No da consejos de inversión: solo informa datos.

## Pendiente de decidir

- Nombre y diseño de la mascota. Debe ser un personaje nuevo y no puede llamarse como el del original.
- Las 5 personalidades (hay propuestas de partida en `schema.sql`) y qué voz va con cada una.
- El atajo para hablar y el atajo de parada de emergencia.
- El tope mensual de gasto en la API.

## Lo que tienes que crear tú

Yo nunca escribo contraseñas ni creo cuentas por ti.

- Una clave de la API de Claude, creada en la consola de Anthropic. Es distinta de la suscripción.
- Un proyecto de Google Cloud para Gmail, Calendario y Classroom. Tu cuenta del colegio puede tener bloqueado el acceso de apps externas desde la administración de su cuenta.
- Una app de desarrollador de Spotify. Para controlar la reproducción hace falta Spotify Premium.
- Una clave de BingX creada con permisos de solo lectura.
- Un acceso a GitHub con permisos limitados.
