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

Todo vive en **`index.html`** (un solo archivo, ~3.600 líneas: CSS + HTML + JS sin build). Las librerías están en `vendor/`, las fuentes en `fonts/`, los sonidos en `snd/`. No hay npm ni bundler: se mantiene así a propósito (independencia). Si se divide en módulos, usar ES modules nativos (`<script type="module">`) sin herramientas de build.

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
| Exportar | `exportPDF` (jsPDF), `exportSVG`, `toMusicXML`, `exportMXL`, `exportJSON`, `offer` → `browserDownload` |
| Importar | `importFile` (.json, .musicxml, .xml, .mxl, .zip), `fromMusicXML` |
| Lectura PDF con IA | `omrDialog`, `detectSystems`, `cropBlob`, `omrPrompt`, `parseToken`, `mergeOmr`, `buildFromOmr` — hoy usa `window.claude` (capacidad `sample`) |
| Plataforma Claude | todo lo que cuelga de `window.claude` en `start()`: `downloads`, `sample`, `db`, `user`; `makeDbLib`, `share*`, `initShare`, `shareDialog`, `openShared`, `showShareBar` |
| Partitura incrustada | `<script type="application/json" id="atril-embed">` → `start()` la abre en vez del ejemplo |

### Formato de datos

```
score = { id, title, composer, tempo, time:"4/4", key:<quintas -7..7>,
  changes:[{m, time?, key?}],                      // cambios a mitad de obra (m = índice de compás)
  marks:{ [m]: {repStart, repEnd:n, volta:[1,2], segno, coda, toCoda, fine,
               jump:"DC"|"DCalFine"|"DCalCoda"|"DS"|"DSalFine"|"DSalCoda", tempo, dyn} },
  layout:{ staff:<mm>, perSystem:<compases por sistema, 0 = auto> },
  groups:[{type:"bracket", from, to}],
  staves:[{ name, clef:"treble"|"treble8"|"bass"|"alto",
            voices:[{ name, notes:[note], muted, solo, sound }] }] }
note = { d:"w"|"h"|"q"|"8"|"16", dots:0|1, rest, tie, keys:[{s:"C".."B", a:-1|0|1, o:<octava>}],
         ly:[{t, h}|null], hid? }       // a = alteración real (no relativa a la armadura)
```

Ese JSON es el formato `.atril` (hoy se exporta como `.atril.json`).

## Tareas, en orden

### Fase 1 — independizar (prioridad)
- [ ] Servir localmente y comprobar que todo funciona sin internet (fuentes, librerías, sonidos, worker de pdf.js).
- [ ] Quitar o aislar el código de `window.claude`: `makeDbLib`, compartir por base de datos (`share*`), lectura con IA vía `sample`. Mantener `offer()` pero sin mensajes que mencionen Claude.
- [ ] Biblioteca local: reemplazar “Mis partituras” por archivos `.atril` (File System Access API con respaldo `<input type=file>` + descarga) y una lista de recientes en IndexedDB.
- [ ] Atajos: Ctrl+S guardar, Ctrl+O abrir, Ctrl+Shift+S guardar como.
- [ ] Actualizar la ayuda (`helpDialog`, cuadro “En esta vista”) para la app local.
- [ ] PWA: `manifest.webmanifest` y `sw.js` ya están; revisar que el service worker cachee todo `snd/` bajo demanda y el resto al instalar.

### Fase 2 — compartir sin servidor
- [ ] “Copiar enlace”: comprimir el JSON (`CompressionStream('deflate-raw')` + base64url) en `#s=…`; al cargar, si existe, abrir esa partitura (igual que `atril-embed`). Avisar si el enlace supera ~30.000 caracteres y ofrecer el archivo.
- [ ] Publicar en GitHub Pages con un workflow de Actions (`.github/workflows/pages.yml`).

### Fase 3 — escritorio (Tauri 2)
- [ ] `npm create tauri-app` apuntando a esta carpeta como frontend estático (sin bundler).
- [ ] Diálogos nativos para abrir/guardar; asociar la extensión `.atril`; abrir el archivo recibido por argumento.
- [ ] Instalador `.msi`/`.exe` para Windows.

### Fase 4 — leer PDF sin IA
- [ ] Integrar Audiveris como “sidecar” de Tauri: `Audiveris -batch -export -output <dir> <archivo.pdf>` → `.mxl` → `importFile`.
- [ ] En la versión web, ofrecer “Importar MusicXML” y explicar que la lectura de PDF está en la app de escritorio.
- [ ] Importar el JSON compacto que produce la skill `skills/leer-partitura` reutilizando `buildFromOmr` (ver formato en `omrPrompt`).

### Calidad
- [ ] Pruebas con Playwright (`tests/`): cargar, escribir notas, reproducir, transponer, exportar MusicXML ida y vuelta, `playOrder` con repeticiones/casillas/D.S. al Coda. Comprobaciones conocidas que pasaban: casillas → `1 2 3 1 2 4 5 6`; D.S. al Coda → `1 2 3 4 5 6 2 3 4 7 8`.

## Reglas
- No agregar servicios externos (ni analítica, ni CDNs, ni backends) sin que Daniel lo pida.
- Todo texto visible en español; mensajes cortos y que digan qué hacer.
- Antes de cambiar `render`, `playOrder` o `performance`, correr las pruebas: son las partes más delicadas.
- Los sonidos tienen licencia: ver `CREDITS.md` (mantener los créditos visibles en la app).
