# Instalar Two-Nova en Windows

Autor: S1even. Todo corre en tu PC. No hay cuenta, pago ni servidor propio.

## Forma fácil: el instalador .exe

1. Haz doble clic en `Two-Nova-Setup-0.3.0.exe`.
2. Si Windows muestra "Windows protegió tu PC": clic en **Más información** y luego **Ejecutar de todos modos**. Sale porque el programa no tiene firma digital de pago; lo hiciste tú, así que es normal.
3. Siguiente → Siguiente → Instalar → Abrir Two-Nova.

Se instala solo para tu usuario (no pide administrador) en `%LOCALAPPDATA%\Programs\Two-Nova`, crea un acceso en el escritorio y en el menú Inicio, y se desinstala desde Configuración → Aplicaciones.

No quieres instalar nada: usa `Two-Nova 0.3.0.exe` (portable), que se abre con doble clic. Tarda unos segundos más en abrir.

No necesitas Node.js para esto. Sí necesitas **Claude Code** instalado si quieres que la isla lo vigile.

## Si el .exe no se descarga (son más de 100 MB)

Usa el código fuente, que pesa menos de 1 MB:

1. Instala Node.js (versión LTS) desde https://nodejs.org/es.
2. Descomprime `Two-Nova-codigo-0.3.1.zip` en una carpeta fija, por ejemplo `C:\Two-Nova`.
3. Doble clic en `INSTALAR-FACIL.bat`. Descarga lo necesario, crea el acceso "Two-Nova" en el escritorio y abre la app. Si se corta el internet, vuelve a abrirlo y continúa.

No muevas ni borres esa carpeta después: la app corre desde ahí.

## Primer uso (3 pasos)

1. **Conectar con Claude Code.** La primera vez la app te lo pregunta. Verás qué archivo se cambia y qué se añade, y se guarda una copia de respaldo antes. Después cierra y abre Claude Code. (Más tarde: icono de la bandeja → Conectar/Desconectar.)
2. **Poner tu clave de la API de Claude.** Icono de la bandeja → *Abrir Two-Nova* → **Ajustes** → pega tu clave (`sk-ant-…`) → *Guardar clave*. Se guarda cifrada con el almacén de Windows y nunca vuelve a mostrarse completa. La creas en https://console.anthropic.com. Ahí también puedes poner un límite de gasto.
3. **Conversar.** Pestaña **Conversación**, elige una personalidad y escribe. Si "Leer en voz alta" está activo, te contesta con su voz.

## Las 5 personalidades

Mayordomo, Compa, Profe, Coach y Seco. Cada una tiene su voz preferida, velocidad y tono, y todo se puede editar o crear más (hasta 12). Cambian **cómo habla**, nunca lo que puede hacer: las reglas están en el código y no en el texto de estilo.

Las voces son las **voces en español que ya trae tu Windows** (por ejemplo Sabina, Raúl, Helena, Pablo). Si solo tienes una o dos, las personalidades se distinguen por velocidad y tono. Para más voces: Configuración de Windows → Hora e idioma → Voz → Agregar voces.

## La isla completa (versión 0.3)

Haz clic en la isla (o `Ctrl+Alt+Espacio`) y se abre como un tablero con un reloj grande y una barra de apps abajo:

| App | Qué hace |
| --- | --- |
| Inicio | Saludo, reloj, estado de Claude Code y cuántos trabajos terminó hoy |
| Claude | Sesiones de Claude Code y lo último que terminó |
| Música | Solo el diseño: Spotify se conecta en un siguiente hito |
| Notas | Nota rápida; una línea que empieza con `[ ]` se vuelve una tarea que marcas con un círculo |
| Agenda | Tus eventos (vista día y mes). Google Calendar llega en un siguiente hito |
| Bandeja | Arrastra archivos para tenerlos a mano; abrir, mostrar en la carpeta, arrastrar a otra app |
| Portapapeles | Historial de lo que copias. Apagado por defecto, solo en memoria y sin guardar claves |

Si Claude pide permiso mientras la isla está abierta, el permiso pasa al frente y no pierdes nada.

**Cambiarle la cara:** icono de la bandeja → *Abrir Two-Nova* → **Apariencia**. Colores, ojos, forma, tamaño, opacidad, distancia al borde, qué apps salen y en qué orden. Hay vista previa en vivo y no cambia tu isla hasta que pulsas *Guardar cambios*. Rechaza fondos claros para que el texto siempre se lea.

**Cómo se abre y se mueve:** en *Apariencia → Cómo se abre y cómo se mueve* eliges si la isla se abre al pasar el mouse (por defecto; se cierra sola al irte) o con clic, la animación en reposo, el estilo de movimiento y qué texto sale en la pastilla (la hora, el estado, un saludo, tu propio texto o nada). Un clic en la pastilla la deja fija abierta.

## La isla y los permisos

La isla aparece arriba al centro. Cuando Claude Code pide permiso ves el comando completo, su nivel de riesgo y los botones **Permitir** y **Negar** (o `Ctrl+Alt+Y` / `Ctrl+Alt+N`). Si la isla está cerrada o no decides en 100 segundos, Claude Code te pregunta en su terminal como siempre. La isla nunca permite nada por su cuenta.

## Qué todavía NO hace

- No te escucha (el micrófono llega en el siguiente hito).
- No controla la PC ni se conecta con Gmail, Google Calendar, Spotify, GitHub, Classroom, etc. Por ahora el cerebro **solo conversa**. En *Conexiones* ya están esas apps, marcadas como "Próximamente".
- La app Música de la isla es solo el diseño por ahora.

## Si algo falla

- La isla no reacciona a los permisos: bandeja → activa *Modo grabación*, usa Claude Code un rato, y mándame el archivo `captura.jsonl` (bandeja → *Abrir carpeta de datos*). Tiene las claves ocultas. También está `log.txt`.
- No suena la voz: revisa en Ajustes → "Voces disponibles" cuántas voces en español encontró.
- "La clave no es válida": pégala de nuevo en Ajustes.
- "Llegaste al tope mensual": en Ajustes sube el tope de tokens.

## Si prefieres compilarlo tú (Windows)

Necesitas Node.js 22 o más nuevo. En PowerShell:

```powershell
cd C:\Users\TU-USUARIO\proyectos\two-nova
npm install
npm start          # abre la app para probar
npm test           # pruebas automáticas
npm run dist       # crea el instalador en la carpeta dist
```

Al compilarlo tú mismo en tu PC, Windows normalmente no muestra el aviso de SmartScreen.

## Desinstalar

Configuración → Aplicaciones → Two-Nova → Desinstalar (te pregunta si borrar también tus datos y la clave guardada). Antes, si quieres, bandeja → *Desconectar de Claude Code* para quitar los avisos de la configuración de Claude Code.

## Seguridad en pocas palabras

- El servidor de la isla solo escucha en `127.0.0.1` (tu PC), pide un token y rechaza peticiones de páginas web.
- La clave de la API va cifrada con Windows. Solo lo que escribes en el chat viaja a la API de Claude.
- Los comandos se guardan con claves y tokens ocultos, durante 30 días.
- Los hooks de Claude Code corren con tus permisos: no actives hooks de gente que no conoces.

## Subir a GitHub (PowerShell)

```powershell
git init
git add .
git commit -m "Two-Nova 0.3: isla con dock de apps, panel y editor de apariencia"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/two-nova.git
git push -u origin main
```

Hazlo **privado** si no quieres compartirlo. No subas la carpeta `dist` (ya está en `.gitignore`).
