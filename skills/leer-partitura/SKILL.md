---
name: leer-partitura
description: Transcribe una partitura impresa (PDF o foto) a un archivo que Atril importa. Úsala cuando Daniel pida leer, transcribir o pasar a Atril una partitura de PDF o imagen, sobre todo himnos y arreglos SATB con letra en español.
---

# Leer partitura para Atril

Objetivo: convertir páginas de partitura en el **JSON compacto de Atril** (`<nombre>.atril-omr.json`), que Atril importa con su lector (`buildFromOmr`). Si Daniel prefiere, entregar además MusicXML para MuseScore.

## Proceso
1. **Preparar las imágenes.** Si es PDF, rasterizar cada página a ~2200 px de ancho. Recortar cada **sistema** (renglón de pentagramas) por separado: la precisión mejora mucho comparada con la página completa. Guardar el encabezado (título, autor, tempo) aparte.
2. **Primera pasada:** leer encabezado + primeros sistemas y fijar: pentagramas, claves, voces por pentagrama (en himnarios SATB: Soprano+Contralto en clave de sol, Tenor+Bajo en clave de fa, dos voces por pentagrama), armadura, compás, anacrusa.
3. **Transcribir sistema por sistema** con el formato de abajo, manteniendo siempre los mismos pentagramas y voces.
4. **Verificar cada compás:** las duraciones de cada voz suman el compás (salvo la anacrusa); las alteraciones respetan la armadura y las alteraciones previas del mismo compás; la letra va en la voz superior de cada pentagrama.
5. **Releer** los compases dudosos ampliando el recorte antes de entregar, y anotar en `warnings` lo que no se pudo leer.
6. Entregar el archivo `.atril-omr.json` (y un resumen de advertencias en español).

## Formato de salida
Un solo objeto JSON:
```json
{"title": "…", "composer": "…", "tempo": 80, "key": 0, "time": "3/4", "pickup": true,
 "staves": [{"name": "", "clef": "treble", "voices": ["Soprano", "Contralto"]},
            {"name": "", "clef": "bass", "voices": ["Tenor", "Bajo"]}],
 "systems": [{"staves": [[["<S c.1>", "<S c.2>"], ["<A c.1>", "<A c.2>"]],
                         [["<T c.1>", "<T c.2>"], ["<B c.1>", "<B c.2>"]]]}],
 "warnings": ["…"]}
```
- `key`: cantidad de sostenidos (positivo) o bemoles (negativo). `time`: "3/4", "6/8"…
- Cada compás de cada voz es un texto con eventos separados por espacio:
  - Nota `ALTURA:DUR` → `C4:q`, `F#5:8`, `Bb3:h.` (C4 = Do central). Escribir la alteración que **suena** (en Sol mayor todo Fa es `F#` salvo becuadro).
  - Acorde en la misma plica: `C4+E4:q`. Silencio: `r:q`, compás completo `r:w`.
  - DUR: `w h q 8 16`, `.` para puntillo, `~` si se liga a la siguiente (`G4:h~`).
  - Letra en la voz superior del pentagrama: `G4:q/gran-` (guion si la palabra sigue), estrofas con `|` → `G4:q/Al-|To-`, sinalefa con `_` → `y_a`.
  - Cambios al inicio del compás (en todas las voces): `@key=-1`, `@time=3/4`.
  - Marcas (solo primera voz del pentagrama superior): `@repStart`, `@repEnd` o `@repEnd=3`, `@volta=1` / `@volta=1,2`, `@segno`, `@coda`, `@toCoda`, `@fine`, `@jump=DC|DCalFine|DCalCoda|DS|DSalFine|DSalCoda`, `@tempo=72`, `@dyn=pp|p|mp|mf|f|ff`.
- No representables (tresillos, notas de adorno, reguladores, articulaciones): aproximar o omitir y mencionarlo una vez en `warnings`.
- Nunca saltarse un compás.

## Calibración
Guardar en `ejemplos/` pares (PDF original → JSON corregido a mano en Atril) de partituras reales de Daniel y usarlos como referencia de errores típicos al afinar esta skill.
