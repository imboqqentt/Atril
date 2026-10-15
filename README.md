# Atril

Editor de partituras para coro y piano: escribe desde cero, reproduce con sonidos reales, canta los nombres de las notas (solfeo), transpone, muestra los acordes, maneja repeticiones, casillas, Segno/Coda, D.C./D.S., cambios de compás y tonalidad, y letra con varias estrofas.

Exporta PDF, MusicXML (MuseScore, Sibelius, Dorico), SVG, audio MP3/MP4/WAV y pistas de ensayo por voz.

Funciona en tu equipo, sin cuenta y sin internet.

## Usarlo

**Opción rápida (Windows):** doble clic en `iniciar-atril.bat`. Abre Atril en el navegador desde tu equipo.

**A mano:** en esta carpeta, ejecuta uno de estos y abre http://localhost:8080
```
python -m http.server 8080
npx serve -l 8080 .
```
(Abrir `index.html` directamente con doble clic también funciona, pero el navegador bloquea algunas cosas desde `file://`, como los bancos de sonido; por eso conviene el servidor local.)

## Estructura
```
index.html              la aplicación completa
vendor/                 librerías (VexFlow, jsPDF, JSZip, pdf.js, lamejs, muxers)
fonts/                  fuentes (IBM Plex, Libre Caslon)
snd/                    bancos de sonido (piano, órganos, cuerdas, vientos, arpa)
ejemplos/               partituras de ejemplo (.atril.json)
skills/leer-partitura/  skill para que Claude transcriba un PDF o foto (opcional)
manifest.webmanifest, sw.js   instalación como app (PWA)
CLAUDE.md               plan de trabajo para Claude Code
```

## Créditos
Ver `CREDITS.md`.
