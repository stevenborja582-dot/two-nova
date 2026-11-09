# Recon: TwoCode (Windows 10 y 11)

> Material de referencia: es la investigación sobre el original. Nada de este archivo ni de `screens/` se publica ni se empaqueta. El producto de S1even está descrito en `s1even.md` y `architecture.md`.

Alcance: la isla de escritorio ("Dynamic Island" para Windows) que muestra lo que hacen los agentes de IA de código, pide aprobar permisos y avisa al terminar, más la mascota asistente y las utilidades pequeñas.
Fuera de alcance: los otros productos del estudio (TwoReel, TwoType, TwoBreak).
Para quién: uso personal, y quiere poder modificarla (confirmado el 2026-11-05). No se vende ni se publica.
Fecha: 2026-11-05
Fuentes: solo públicas. No se descargó ni se abrió el instalador, ni se miró su código.

## Fuentes

| # | fuente | URL | leída | notas |
| --- | --- | --- | --- | --- |
| 1 | web del estudio | https://twocode.nl/ | sí | estudio neerlandés pequeño; lista 4 productos; TwoCode figura como "beta gratis" |
| 2 | página del producto | https://twocode.nl/twocode/ | sí | funciones, setup en 3 pasos, contador de PCs, precio de €9.99 |
| 3 | blog (journal) | https://twocode.nl/journal/journal-claude-dynamic-island-windows/ | sí | cómo se usa; menciona anillo de uso, utilidades e idiomas |
| 4 | README en GitHub | https://github.com/levon-z/TwoCode/blob/main/README.md | sí | funciones, instalación por ZIP, atajos, privacidad local |
| 5 | notas de la versión 1.2.0 beta | https://github.com/levon-z/TwoCode/releases/tag/v1.2.0-beta.1 | sí | "Robo", "arréglalo por mí", app de Ajustes aparte |
| 6 | captura de la página de descarga | replica/screens/S01-pagina-descarga.png | sí | la aportó el usuario; muestra instalador `.exe`, cuenta y pago |
| 7 | FAQ, Privacidad, Términos, vídeo demo, versión 1.1.0 | | no | pendientes de leer |

## Contradicciones entre fuentes (hay que resolverlas)

1. **Distribución.** El README y las notas de versión dicen ZIP sin instalador, sin cuenta y sin firma. La captura (6) muestra `TwoCode-Setup.exe`, autoactualización, cuenta y pago de €9.99. Lo más probable es que la web muestre una versión más nueva, pero no está confirmado.
2. **Disponibilidad.** El blog (3) dice que aún no se puede descargar y manda a una lista de espera. La página del producto (2) tiene descarga y un contador de PCs. Probablemente el blog es más antiguo.
3. **Agentes soportados.** La portada (1) solo menciona Claude Code. La página del producto (2) y el README (4) dicen Claude Code y Codex. El blog (3) añade ventanas abiertas de ChatGPT y Claude.
4. **Cuenta.** El blog (3) dice que no hace falta cuenta. La captura (6) dice que la primera pregunta es crear una cuenta.

## Núcleo del producto

Mientras tu IA programa en otra ventana, ves en la isla lo que hace, apruebas o niegas sus permisos con un clic y te avisa cuando termina.

## Pantallas

| ID | pantalla | cómo se llega | propósito | componentes clave | estados vistos |
| --- | --- | --- | --- | --- | --- |
| S01 | Página de descarga (web) | botón "Download for Windows" | guiar la instalación en 4 pasos y avisar de SmartScreen | pasos numerados, tarjetas de SmartScreen, aviso de cuenta y precio | solo lo visto en la captura |
| S02 | Isla en reposo | siempre visible arriba de la pantalla | presencia de la mascota sin estorbar | isla pequeña, ojos de Robo | reposo, parpadeo |
| S03 | Isla ocupada | el agente empieza a trabajar | mostrar actividad en vivo | color de "ocupado", texto del archivo o comando, línea de progreso | ocupado |
| S04 | Petición de permiso | el agente pide algo importante | decidir sin buscar la ventana original | texto del comando, botones Permitir y Negar | pendiente, permitido, negado |
| S05 | Isla terminada o con atención | el agente termina o pregunta | avisar | color de "terminado", sonido, resumen de cambios, aviso de Windows opcional | terminado, pregunta, error |
| S06 | Isla expandida (Claude Code / Codex) | abrir la isla | historial y última respuesta | páginas por agente, historial, colores por estado | ocupado, terminado, error |
| S07 | Anillo de uso | dentro de la isla | ver cuánto del límite de 5 horas de Claude se usó | anillo | aproximado según el original |
| S08 | Mascota asistente sobre una ventana | arrastrar la mascota a cualquier ventana | preguntar qué pasa, con captura de pantalla | mascota, caja de pregunta, respuesta | sin datos de estados de error |
| S09 | "Arréglalo por mí" | desde un error | proponer el arreglo, pedir permiso y escribir el cambio a la vista | propuesta, confirmación, escritura visible | propuesta, aprobado |
| S10 | Isla mediana con Spotify | utilidad Spotify | controlar la música | botones, línea de progreso, selector de dispositivo | reproduciendo, pausa |
| S11 | Utilidades | dentro de la isla | bandeja de archivos, portapapeles, nota rápida, temporizador de enfoque | listas, campos, cuenta atrás | sin datos |
| S12 | Ajustes (app aparte en el menú Inicio) | menú Inicio | activar agentes, personalizar la mascota, idioma | pestaña IA, colores, atuendos, luces, caras | sin datos |
| S13 | Menú de la bandeja | icono de la bandeja | "Empezar con Windows" y salir | menú | sin datos |
| S14 | Primera pregunta: cuenta y licencia | primer arranque (según la captura) | iniciar sesión, crear cuenta o canjear el programa de fundadores | formulario de cuenta, aviso de €9.99 y 3 PCs | solo lo descrito en la captura |
| S15 | Aviso nativo de Windows | al terminar o pedir atención | recordatorio opcional | toast | opcional |

## Flujos

```
F01 Instalar y arrancar
    S01 descarga -> aviso SmartScreen "Más información / Ejecutar de todos modos" -> S02 isla aparece -> S14 cuenta -> S12 conectar IA
    clics del camino feliz: unos 6 (sin contar los de SmartScreen)
    bordes: archivo "poco descargado" en el navegador, SmartScreen, sin Claude Code instalado

F02 Ver trabajar al agente
    S02 -> S03 -> S06
    bordes: dos agentes a la vez, sesión que se cierra a medias

F03 Aprobar o negar un permiso
    S03 -> S04 -> S03 -> S05
    bordes: petición que llega con la isla expandida, varias peticiones seguidas, timeout

F04 Enterarse de que terminó
    S03 -> S05 -> S15
    bordes: terminó con error, terminó con una pregunta

F05 Preguntar a la mascota sobre una ventana
    S02 -> arrastrar -> S08
    bordes: la IA conectada no responde, ventana con contenido sensible

F06 Arreglar un error con la mascota
    S08 -> S09
    bordes: el usuario niega el cambio

F07 Ver el uso del límite de Claude
    S06 -> S07

F08 Usar las utilidades
    S11 / S10 -> teclas de atajo

F09 Personalizar la mascota y los ajustes
    S13 -> S12

F10 Actualizar la app
    GitHub: descargar ZIP y reemplazar carpeta. Captura: se actualiza sola.

F11 Licencia y cuenta
    S14
```

## Componentes

| componente | variantes | estados | usado en |
| --- | --- | --- | --- |
| Isla | pequeña, mediana, expandida | reposo, ocupado, terminado, error, pidiendo permiso | S02 a S11 |
| Mascota | ojos de la isla y personaje completo | feliz, curiosa, concentrada, guiño, enamorada, mareada, parpadeo | S02, S08 |
| Botones Permitir y Negar | principal y secundario | normal, pulsado, deshabilitado | S04, S09 |
| Anillo de uso | sin variantes | normal, casi lleno | S07 |
| Línea de progreso | sin variantes | avanzando, completa | S03, S10 |
| Aviso nativo y sonido | sin variantes | activado, silenciado | S05, S15 |
| Menú de la bandeja | sin variantes | normal | S13 |
| Selectores de personalización | color, atuendo, luces, cara | seleccionado | S12 |

## Modelo de datos inferido

```
Sesion         agente (claude-code | codex), estado (ocupado | terminado | error | esperando), actividad actual
               evidencia: S03, S05, S06
               confianza: alta
EventoActividad  tipo (archivo leído | archivo editado | comando), detalle, hora, sesion_id
               evidencia: S03, README
               confianza: media
PeticionPermiso  sesion_id, comando o herramienta, decision (permitida | negada | pendiente), hora
               evidencia: S04, README (ejemplo "npm install")
               confianza: alta
VentanaDeUso   proveedor, porcentaje usado de las 5 horas
               evidencia: S07
               confianza: baja (el original dice que es aproximado y no se sabe de dónde sale el dato)
Ajustes        agentes activos, idioma (en | nl), empezar con Windows, atajos
               evidencia: S12, S13, README
               confianza: media
AparienciaMascota  color, atuendo, luces, cara
               evidencia: S12, blog
               confianza: media
Licencia       cuenta, dispositivos usados (máximo 3), compra de €9.99
               evidencia: S14 (captura)
               confianza: media
Nota, ElementoPortapapeles, ArchivoEnBandeja   contenido, hora
               evidencia: S11, README
               confianza: guess
```

Relaciones: Sesion 1-n EventoActividad, Sesion 1-n PeticionPermiso, Ajustes 1-1 AparienciaMascota, Licencia 1-n dispositivos.

## Matriz de funciones

Ver `features.csv`. Must: 8, should: 9, could: 9, skip: 4. Validada con `parity.py`: 26 funciones contadas, puntaje 0 (nada construido todavía).

## Fuera de alcance (no se debe o no se puede clonar)

- El personaje Robo, su arte, atuendos y sonidos, y el nombre TwoCode.
- Todo el texto de la web y de la app, incluidas las traducciones.
- El contador de PCs y el programa de fundadores: son datos propios del original, y no se inventa prueba social.
- Los otros productos del estudio.
- Lo que cuelgue de las cuentas de terceros (Spotify, Claude, Codex): se usa solo por sus APIs oficiales y con las claves del propio usuario.

## Tamaño

Pantallas 15, flujos 11, entidades 8. Tamaño del original: M (unas pocas semanas para el núcleo, que son S02 a S07 más Ajustes).

Nota del 2026-11-05: con la voz, la escucha, el control de la PC y las apps que se añadieron a S1even, el proyecto completo pasa a tamaño L. Cada bloque se puede usar solo; ver `architecture.md`.

Partes difíciles:
1. **Permisos de ida y vuelta.** La respuesta Permitir o Negar tiene que llegar al agente. Hay que averiguar la vía oficial de Claude Code antes de prometerlo.
2. **Ventana siempre visible.** Un panel que no robe el foco, funcione con varios monitores y no se interponga en pantallas completas.
3. **Detectar el estado del agente.** Saber con fiabilidad cuándo está ocupado, terminó o espera una decisión.
4. **Anillo de uso.** No se sabe de dónde sale el dato en el original. Puede no existir una fuente oficial.
5. **Seguir ventanas de ChatGPT y Claude.** Frágil, depende de lo que expongan esas apps.
6. **Firma del instalador.** Sin firma, Windows muestra el aviso de SmartScreen.

## Ideas para mejorar (hipótesis, no evidencia)

Salen de las limitaciones que el propio original declara en sus páginas. Son puntos de partida para `/replica-entrepreneur`, que las validará con reseñas reales antes de comprometerse.

- Sin aviso de "Windows protegió tu PC": al compilarla tú en tu PC, normalmente no aparece.
- Interfaz en español (el original solo ofrece inglés y neerlandés).
- Más agentes además de Claude Code y Codex.
- Permisos con contexto: mostrar el comando completo, marcar el riesgo y recordar decisiones.
- Todo en local y comprobable, porque el código es tuyo.
- Sin cuenta ni pago, porque es de uso personal.
