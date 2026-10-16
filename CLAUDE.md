# Atril — guía para Claude Code

Atril es un editor de partituras (coro SATB, piano, instrumentos) hecho por Daniel con Claude.
Escribe, maqueta, reproduce, solfea, transpone, detecta acordes y exporta (PDF, MusicXML, SVG, MP3/MP4/WAV, pistas de ensayo).
Nació como artefacto de claude.ai; **este repo es la migración a una app independiente**: sin cuentas, sin servidores, sin IA obligatoria.

Idioma: la app y los mensajes al usuario van en **español (Chile)**. El código y sus comentarios pueden seguir en español.

## Objetivo (en orden)

1. **Web local / PWA** — funciona abriendo `index.html` servido localmente o desde GitHub Pages, y se puede instalar sin conexión.
2. **Sin dependencias de Claude** — guardar y abrir archivos `.atril`, compartir por archivo o por enlace (la partitura viaja dentro del enlace).
3. **App de escritorio con Tauri 2** — `.exe` para Windows, diálogos nativos, doble clic en un `.atril` lo abre.
4. **Lectura de PDF local con Audiveris** (open source, PDF → MusicXML), llamado desde Tauri. La skill de Claude (`skills/leer-partitura/`) queda como opción aparte para fotos o casos difíciles.

## Estado actual del código

Todo vive en **`index.html`** (un solo archivo, ~3.600 líneas: CSS + HTML + JS sin build). Las librerías están en `vendor/`, las fuentes en `fonts/`, los sonidos en `snd/`. No hay bundler: se mantiene así a propósito (independencia); npm solo trae las herramientas (Playwright, CLI de Tauri). Si se divide en módulos, usar ES modules nativos (`<script type="module">`) sin herramientas de build.

### Mapa del código (buscar por nombre de función)

| Área | Funciones clave |
|---|---|
| Modelo | `score` (estado global), `migrate`, `buildModel`, `meterTable` (compases/tonalidad/tempo/dinámica por compás), `voiceEnd` |
| Dibujo | `render`, `topStaveMarks` (casillas, segno, coda, D.C./D.S., tempo), `measureOverlays` (×n, dinámicas, cifrado de acordes), `decorate` |
| Edición | `commit` (undo), `onKey`, `cursor`, `insertNote`…, `setMark`, `syncProps`, `syncMeterFields` |
| Letra | `lyricInfo`, `commitSyllable`, `pasteVerseDialog`, `splitLyricText` |
| Interpretación | `playOrder` (desenrolla repeticiones/casillas/saltos), `performance` (línea de tiempo con tempo y dinámica), `performanceClicks` |
| Audio | `ensureAudio`, `makeChain`, `playNote`, `startPlayback`, `highlight`, `renderAudio` (OfflineAudioContext), `encodeMp3` (lamejs), codificación AAC/Opus con WebCodecs + mp4-muxer/webm-muxer, `audioDialog` |
| Sonidos | `BUILTIN`, `BANK_ROOTS`, `loadSound` (lee `snd/<banco>/<midi>.mp3`), samples propios del usuario en IndexedDB (`instruments`, `decodeInst`) |
| Acordes | `CHORD_T`, `nameChord`, `measureChords`, `chordAtTick`, `chordText` (inglés/latino) |
| Transponer | `intervalForKeys`, `fifthsForSemis`, `transposeKey`, `transposeScore`, `transposeDialog` |
| Guardar | archivos `.atril`: `saveFile` (File System Access o descarga), `openDialog` + `openRecent` (recientes en IndexedDB, `RECENT`), `openScore`, `saveDraft` (borrador en localStorage), `fileHandle`/`fileName`/`dirty` |
| Compartir | enlace con la partitura adentro: `shareDialog`, `shareLink`, `packScore`/`unpackScore` (`#s=` + deflate-raw + base64url), `openFromHash` (al cargar y en `hashchange`), `linkBase` (usa `<meta name="atril-url">` cuando se comparte desde el equipo), borrador anterior en `LS_PREV` |
| Exportar | `exportPDF` (jsPDF), `exportSVG`, `toMusicXML`, `exportMXL`, `offer` → `browserDownload` |
| Importar | `importFile` (.atril/.json abre con su archivo; .musicxml, .xml, .mxl, .zip importa), `fromMusicXML` |
| Lectura de PDF | escritorio: `omrDialog`, `readWithAudiveris`, `audiverisMissingDialog`, `findAudiveris`; navegador: `webOmrDialog`. JSON compacto de la skill (`.atril-omr.json`): `importFile` → `openOmrJson` → `mergeOmr` + `buildFromOmr` (formato en `omrPrompt`). Sin uso por ahora: `detectSystems`, `cropBlob` |
| Escritorio (Tauri) | `desktop` (null en el navegador): `read`/`write` por ruta, `pickOpen`/`pickSave`, `setTitle`; `openPath`, `stashDraft`. En escritorio `fileHandle` es la ruta (texto). Lado Rust en `src-tauri/src/lib.rs`: `leer`, `escribir`, `elegir_abrir`, `elegir_guardar`, `archivo_inicial`, evento `abrir-archivo` |
| Partitura incrustada | `<script type="application/json" id="atril-embed">` → `start()` la abre en vez del ejemplo |

### Formato de datos

```
score = { v:2, id, title, composer, tempo, time:"4/4", key:<quintas -7..7>,
  pickup?:<negras>,                                 // anacrusa: duración del primer compás (0.5 = corchea); ese compás no se numera
  changes:[{m, time?, key?}],                      // cambios a mitad de obra (m = índice de compás)
  marks:{ [m]: {repStart, repEnd:n, volta:[1,2], segno, coda, toCoda, fine,
               jump:"DC"|"DCalFine"|"DCalCoda"|"DS"|"DSalFine"|"DSalCoda", tempo, dyn,
               swing:"8"|"16"|"no"} },             // swing desde ese compás ("no" = recto); se hereda como el tempo
  layout:{ staff:<mm>, perSystem:<compases por sistema, 0 = auto> },
  groups:[{type:"bracket", from, to}],
  staves:[{ name, clef:"treble"|"treble8"|"bass"|"alto",
            voices:[{ name, notes:[note], muted, solo, sound }] }] }
note = { d:"w"|"h"|"q"|"8"|"16"|"32", dots:0|1|2, rest, tie, keys:[{s:"C".."B", a:-1|0|1, o:<octava>}],
         ly:[{t, h}|null], hid?,        // a = alteración real (no relativa a la armadura)
         tup?:{n, of, u},               // grupo irregular: n figuras en el lugar de `of`; u = figura unidad (tresillo de corcheas: {3,2,"8"})
         ferm?:true,                    // calderón
         grace?:[{keys, d:"8"|"16"|"32", slash}],    // adornos antes de la nota (slash = acciaccatura)
         art?:["stacc"|"stmo"|"ten"|"acc"|"marc"],     // articulaciones (ARTS)
         orn?:"tr"|"prall"|"mord"|"turn"|"fall"|"doit"|"scoop"|"bend",   // ornamentos y efectos de jazz (ORNS)
         brk?:"breath"|"caes", gliss?:true,            // respiración/cesura después de la nota; glissando hasta la siguiente
         sls?, sle?,                                   // abre / cierra ligadura de expresión (spanPairs)
         hp?:"<"|">", hpe?,                            // abre crescendo/decrescendo · cierra regulador
         dyn?:"pp".."ff"|"sfz"|"sf"|"fz"|"fp", txt? }   // dinámica y texto de expresión de la nota
// marks[m].reh = marca de ensayo ("A", "B", "1"…) · marks[m].rpt = compás % · marks[m].slash = barras de ritmo
// score.chords = [{ m, at, root:{s,a}, q, bass?:{s,a} } | { m, at, text }]   at = negras desde el inicio del compás
// score.chordAuto = false → no completar con los detectados · score.layout.mmRest = agrupar silencios de varios compases
```

Tiempo interno: una negra = `TQ` = 3360 ticks (permite fusas, doble puntillo y grupos de 3, 5, 6 y 7 exactos). Los ticks no se guardan: el `.atril` lleva figuras. `noteTicks` aplica puntillos y `tup`; `tupletGroups` arma los grupos (dibujo, MusicXML, escritura); `swingWarp` y los calderones (`holds`) viven en `performance.timeOf`.

Ese JSON es el formato `.atril`. Los `.atril.json` antiguos también se abren.

## Tareas, en orden

### Fase 1 — independizar (prioridad)
- [x] Servir localmente y comprobar que todo funciona sin internet (fuentes, librerías, sonidos, worker de pdf.js).
- [x] Quitar o aislar el código de `window.claude`: `makeDbLib`, compartir por base de datos (`share*`), lectura con IA vía `sample`. Mantener `offer()` pero sin mensajes que mencionen Claude.
- [x] Biblioteca local: reemplazar “Mis partituras” por archivos `.atril` (File System Access API con respaldo `<input type=file>` + descarga) y una lista de recientes en IndexedDB.
- [x] Atajos: Ctrl+S guardar, Ctrl+O abrir, Ctrl+Shift+S guardar como.
- [x] Actualizar la ayuda (`helpDialog`, cuadro “En esta vista”) para la app local.
- [x] PWA: `sw.js` guarda la app al instalar y `snd/` bajo demanda; la página va primero a la red (las versiones nuevas llegan al recargar), `snd/` sale de la caché y `vendor/`, `fonts/` e íconos se refrescan por detrás. Si cambia algo de `vendor/`, subir `CACHE`.

### Fase 2 — compartir sin servidor
- [x] “Copiar enlace”: comprimir el JSON (`CompressionStream('deflate-raw')` + base64url) en `#s=…`; al cargar, si existe, abrir esa partitura (igual que `atril-embed`). Avisar si el enlace supera ~30.000 caracteres y ofrecer el archivo.
- [x] Publicar en GitHub Pages con un workflow de Actions (`.github/workflows/pages.yml`): corre las pruebas y publica solo lo que usa la app. Dirección: https://imboqqentt.github.io/Atril/ (también en `<meta name="atril-url">`; cambiarla ahí si se mueve).

### Fase 3 — escritorio (Tauri 2)
- [x] `src-tauri/` hecho a mano (sin `create`): `tools/armar-sitio.mjs` copia la app a `dist/` y Tauri la mete en el `.exe`.
- [x] Diálogos nativos para abrir/guardar; asociar la extensión `.atril`; abrir el archivo recibido por argumento (y, con Atril abierta, en la misma ventana).
- [x] Instalador `.msi`/`.exe` para Windows: `npm run instalador` → `src-tauri/target/release/bundle/{nsis,msi}/`.

### Fase 4 — leer PDF sin IA
- [x] Audiveris **instalado aparte** (decisión de Daniel: no se empaqueta; AGPL y 85 MB): `buscar_audiveris` lo encuentra (o la ruta en `atril.audiveris`), `leer_pdf` corre `Audiveris -batch -export -output <tmp> [-sheets a-b] -- <pdf>` sin consola y manda cada línea como evento `audiveris`; `cancelar_audiveris`. En la página: `omrDialog` → `readWithAudiveris` → `mxlText` + `fromMusicXML` → `showOmrReport`. Sin idiomas OCR, Audiveris no lee letra ni título (se avisa).
- [x] En la versión web, ofrecer “Importar MusicXML” y explicar que la lectura de PDF está en la app de escritorio.
- [x] Importar el JSON compacto que produce la skill `skills/leer-partitura` reutilizando `buildFromOmr` (ver formato en `omrPrompt`).

### Fase 5 — pulir y mantener (propuesta, 2026-10-15)
Orden sugerido: el bloque 1 en una v0.1.2; luego actualizaciones automáticas.
1. Detalles que molestan
   - [ ] Escritorio: preguntar al cerrar si hay cambios sin guardar (hoy cierra sin avisar; el borrador sí se recupera).
   - [ ] MusicXML: conservar los nombres de las dos voces de un pentagrama (hoy vuelven como “Voz 1/Voz 2”).
   - [ ] Audiveris: corregir errores típicos de OCR en la letra (“ﬁ” por “ñ”, “]” por “l”…).
   - [ ] Prueba de “escribir notas” (la única que faltaba de Calidad).
2. [ ] Actualizaciones automáticas: plugin updater de Tauri con GitHub Releases (requiere firmar las actualizaciones con una clave propia de Tauri, no un certificado de pago).
3. Mejor lectura de partituras
   - [x] Compás de anacrusa (hecho en Fase 6, A7).
   - [ ] Calibrar con partituras reales de Daniel: pares PDF → partitura corregida en `ejemplos/`, medir errores de Audiveris y de la skill.
4. [ ] Mantenimiento: dividir `index.html` en ES modules nativos (sin build), con las pruebas como red.
5. Opcionales: firmar el instalador (certificado de pago, evita SmartScreen); versiones para macOS/Linux.

### Fase 6 — notación completa (propuesta, 2026-10-16)
Meta: que el próximo release escriba, dibuje (VexFlow ya trae casi todo), toque y exporte lo que hoy se aproxima. Cada punto incluye MusicXML de ida y vuelta, `omrPrompt`/skill `leer-partitura` y pruebas. Orden: bloque A primero (los demás dependen de él).

**A. Ritmo (base)** — hecho en la rama `notacion-completa` (2026-10-16), pruebas en `tests/notacion.spec.mjs`
- [x] A1. Resolución: negra = `TQ` = 3360 ticks (no hizo falta migrar: el `.atril` guarda figuras, no ticks). `score.v = 2` y aviso si llega un archivo de una versión más nueva.
- [x] A2. Grupos irregulares 3:2, 2:3, 5:4, 6:4, 7:4: `note.tup = { n, of, u }`, selector en la barra y Alt+3; `VF.Tuplet`; audio exacto; `<time-modification>`/`<tuplet>`.
- [x] A3. Fusa (tecla 2) y doble puntillo (el punto da la vuelta: sin → puntillo → doble).
- [x] A4. Swing 2:1 por compás (`marks[m].swing = "8"|"16"|"no"`, panel Compás), en `performance.timeOf`; texto «Swing»/«Recto»; `<sound><swing>`. Pendiente si se pide: proporción 3:1 (shuffle).
- [x] A5. Calderón (Alt+C): se dibuja y detiene la música (el doble de la nota, entre 0,6 y 3 s).
- [x] A6. Adornos (Alt+G o selector): acciaccatura/apoyatura, `VF.GraceNoteGroup`, suenan en el tiempo (una fusa cada uno), se transponen; MusicXML `<grace>`.
- [x] A7. Anacrusa (`score.pickup` en negras, panel Compás): primer compás corto, numeración desde el siguiente, MusicXML `implicit`, la skill la deja como anacrusa en vez de rellenar.

**B. Articulación y expresión** — hecho en `notacion-completa` (2026-10-16), pruebas en `tests/expresion.spec.mjs`. Audio por nota: `expressionMap` (dinámica vigente y reguladores), `ornamentSegs` (trinos, mordentes, caídas, glissando), `velOut` (volumen propio de la nota).
- [x] B1. Articulaciones (`note.art`, Alt+S/T/A/M): `VF.Articulation` del lado de la cabeza; staccato acorta, acento/marcato suben el volumen, tenuto sostiene.
- [x] B2. Ligaduras de expresión (`sls`/`sle`, Alt+L en la primera y la última): `VF.Curve`, también entre sistemas; `<slur>`.
- [x] B3. Reguladores (`hp`/`hpe`, Alt+R y Alt+Mayús+R): dibujados bajo el sistema; el volumen sube o baja de a poco y se mantiene hasta la siguiente dinámica; `<wedge>`.
- [x] B4. Dinámica de una nota (`note.dyn`: pp…ff cambian el nivel desde ahí; sfz, sf, fz, fp acentúan): menú «Más…».
- [x] B5. Trino, mordentes, grupeto y jazz (caída, doit, scoop, bend): `VF.Ornament` y suenan.
- [x] B6. Respiración (acorta la nota) y cesura (detiene la música): dibujadas a mano; glissando a la nota siguiente (línea y escala cromática).
- [x] B7. Texto de expresión de una nota (bajo el pentagrama, en la línea de las dinámicas) y marca de ensayo en caja (`marks[m].reh`, panel Compás); MusicXML `<words>` y `<rehearsal>`.
- Nota: el calderón pasó de Alt+F a Alt+C (en Chrome para Windows, Alt+F abre el menú del navegador).

**C. Armonía y música popular** — hecho en `notacion-completa` (2026-10-16), pruebas en `tests/acordes.spec.mjs` y `tests/compases.spec.mjs`.
Resumen de lo hecho: acordes guardados en `score.chords` (posición en negras, no en ticks); `parseChord`/`normQuality` leen inglés y latino con sinónimos (Δ, ø, -7, sus, alteraciones 7(♭9,♯11)…); `measureChordList` da los escritos o los detectados; elegir/arrastrar/doble clic/flechas; «Fijar los detectados»; se transponen; `<harmony>` con `<offset>`. % (`repeatPrevMeasure` copia notas reales y `showRepeat` lo dibuja solo si sigue igual), silencios agrupados (`restRun`, `VF.MultiMeasureRest`) y barras de ritmo (notas `type:"s"`); `<measure-style>`.
- [x] C1. Cifrado editable. Hoy `measureChords`/`nameChord` lo calculan al dibujar, uno por pulso, y no se guarda: no se puede mover ni corregir.
  - Guardado: `score.chords = [{ m, tick, root:{s,a}, q, bass?:{s,a}, text? }]` (`tick` relativo al compás, ya en la resolución de A1). Los acordes guardados mandan; la detección solo rellena donde no hay ninguno (dibujada en gris) o se apaga.
  - «Fijar acordes»: convierte lo detectado en acordes guardados, para editarlos a partir de ahí.
  - Cambiar como texto: doble clic (o Enter con el acorde elegido) abre un campo; se escribe en inglés o latino (`Cm7`, `Do7`, `Sib/Re`, `F#m7b5`, `Lam(add9)`), `parseChord` lo valida y avisa si no lo entiende. Texto libre opcional (`N.C.`, `(A7)`). Vacío = borrar.
  - Mover: arrastrar el acorde a lo largo del pentagrama, con ajuste al pulso (Alt = a la subdivisión), incluso a otro compás; con el acorde elegido, ←/→ mueve un pulso y Alt+←/→ una subdivisión.
  - Agregar en cualquier pulso: clic sobre el pentagrama de arriba en modo «Acordes», o atajo con la nota elegida.
  - Todo pasa por `commit` (deshacer); se transpone con `transposeScore`; respeta Inglés/Latino al mostrar; exporta e importa `<harmony>` con `<offset>`; PDF/SVG iguales a la pantalla.
- [x] C2. Repetición de compás (%, tecla % o panel Compás) y silencios de varios compases agrupados (panel Tamaño).
- [x] C3. Barras de ritmo por compás (panel Compás), para improvisar o acompañar.

**D. Instrumentos**
- [ ] D1. Instrumentos transpositores (sax alto/tenor, trompeta, clarinete en Sib/Mib, corno en Fa): `staff.transpose`; ver en sonido real o escrito; el audio siempre suena real.
- [ ] D2. Más claves: tenor, sol 8va, fa 8vb, percusión.
- [ ] D3. 8va/8vb por tramo y pedal de piano.
- [ ] D4. Barras a mano (unir/romper) y plicas forzadas.

**E. Lectura e intercambio**
- [ ] E1. `fromMusicXML` deja de saltarse `grace`/`cue` y lee todo lo de A–D.
- [ ] E2. Ampliar el formato compacto de la skill (`armar.py`, `buildFromOmr`): tresillos, articulaciones, ligaduras de expresión, cifrado.

Riesgos: A1 toca `render`, `playOrder` y `performance` (correr `npm test` antes y después); un `.atril` v2 no abre bien en un Atril anterior → avisar al abrir si `score.v` es mayor que el que entiende la app.

### Calidad
- [x] Pruebas con Playwright (`tests/`, `npm install` y `npm test`; abren Atril con internet bloqueado): cargar, escribir notas, reproducir, transponer, exportar MusicXML ida y vuelta, `playOrder` con repeticiones/casillas/D.S. al Coda. Falta: escribir notas. Comprobaciones conocidas que pasaban: casillas → `1 2 3 1 2 4 5 6`; D.S. al Coda → `1 2 3 4 5 6 2 3 4 7 8`.

## Comandos
- `npm test` — pruebas web (Playwright, Chromium, internet bloqueado).
- `npm run escritorio` — Atril de escritorio en modo desarrollo (lee los archivos de la carpeta).
- `npm run test:escritorio` — compila en modo depuración y prueba la app real por el puerto de depuración de WebView2.
- `npm run instalador` — instaladores `.exe` (NSIS) y `.msi`.
- Publicar una versión: correr `npm test` y `npm run test:escritorio` en Windows (en GitHub las de escritorio no bloquean: WebView2 no abre el puerto de depuración allá), subir `version` en `package.json` y `src-tauri/Cargo.toml`, commit, `git tag vX.Y.Z` y `git push origin vX.Y.Z`. El workflow `release.yml` corre las pruebas, compila en Windows y deja un **borrador** de Release con el `.exe` y el `.msi` para revisar y publicar.
- Requisitos para compilar: Rust (rustup) y Visual Studio Build Tools con C++.

## Reglas
- No agregar servicios externos (ni analítica, ni CDNs, ni backends) sin que Daniel lo pida.
- Todo texto visible en español; mensajes cortos y que digan qué hacer.
- Antes de cambiar `render`, `playOrder` o `performance`, correr las pruebas: son las partes más delicadas.
- Los sonidos tienen licencia: ver `CREDITS.md` (mantener los créditos visibles en la app).
