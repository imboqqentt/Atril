---
name: leer-partitura
description: Lee una partitura en PDF o foto y la convierte en un archivo .atril (se abre en Atril) y MusicXML. Úsala cuando Daniel pida leer, transcribir o pasar a Atril o a MusicXML una partitura, sobre todo himnos y arreglos SATB con letra en español.
---

# Leer partitura para Atril

Convierte una partitura impresa (PDF o foto) en dos archivos:
- **`<nombre>.atril`**: se abre directo en Atril (doble clic o Archivo → Abrir).
- **`<nombre>.musicxml`**: para MuseScore, Sibelius, Dorico, o para importar en Atril.

Pensada para himnos y arreglos corales SATB con letra en español, aunque sirve para cualquier partitura sencilla (piano, melodía con letra).

## Herramientas
Dos scripts de Python (numpy + Pillow; para PDF, PyMuPDF o `pdftoppm`):
- `scripts/preparar.py`: recorta cada **sistema** (renglón de pentagramas) en una imagen aparte.
- `scripts/armar.py`: une la transcripción, revisa cada compás y escribe el `.atril` y el `.musicxml`.

## Proceso
1. **Recortar.**
   `python3 scripts/preparar.py partitura.pdf --salida recortes`
   (`--paginas 1-2` para leer solo algunas páginas.) Mira `recortes/indice.json`. Si una página salió como `pXX_pagina.jpg`, no se detectaron los pentagramas: léela completa con más cuidado.
   Por cada sistema también salen `pXX_sYY_guia1.png`, `_guia2.png`…: el sistema ampliado x3 por tramos, con una línea punteada y el nombre de cada altura (rojo = línea, azul = espacio, con 3 líneas adicionales arriba y abajo). Sin `--claves` supone sol + fa en sistemas de 2 pentagramas y sol en los demás. Si las claves son otras (por ejemplo, cuatro pentagramas SATB con tenor en `treble8`), vuelve a correrlo con `--claves treble,treble,treble8,bass` después de mirar el primer sistema. `--sin-guia` las omite.
2. **Mirar el encabezado y el primer sistema** (abre las imágenes). Fija:
   - título, autor y tempo;
   - armadura (sostenidos positivos, bemoles negativos) y compás;
   - pentagramas y claves (`treble`, `treble8` si la clave de sol lleva un 8 abajo, `bass`, `alto`, `tenor` (do en 4ª), `treble8va`, `bass8vb`, `perc`);
   - instrumentos transpositores: agrega `"trans"` al pentagrama (`bb` trompeta/clarinete/sax soprano en Si♭, `ten` sax tenor, `eb` sax alto, `bari` sax barítono, `a` clarinete en La, `f` corno en Fa, `ebs` requinto) y transcribe las notas **como están escritas**. `key` es siempre la armadura impresa en el pentagrama de arriba;
   - voces por pentagrama. En himnarios SATB: `["Soprano","Contralto"]` en clave de sol y `["Tenor","Bajo"]` en clave de fa, dos voces por pentagrama (plicas arriba y abajo);
   - si el primer compás es una anacrusa (incompleto).
3. **Transcribir de a 2 o 3 sistemas por vez.** Usa `pXX_sYY.jpg` para el ritmo, la letra y las marcas, y las guías para leer cada altura: la cabeza de la nota cae sobre una línea punteada o justo entre dos. No calcules las alturas contando líneas a ojo, sobre todo en notas con líneas adicionales. Escríbelas en el formato de abajo, siempre con los mismos pentagramas y voces. Guarda una página por archivo (`pag1.json`, `pag2.json`…), cada una con su `key`/`time` vigentes al inicio de esa página.
4. **Revisar sin escribir:**
   `python3 scripts/armar.py pag1.json pag2.json --revisar`
   Corrige cada «compás que no cuadra» y cada «ficha ilegible» volviendo a mirar ese compás en el recorte (puedes ampliar la imagen recortando de nuevo con Pillow). Repite hasta que no queden, o deja la duda escrita en `warnings`.
5. **Armar:**
   `python3 scripts/armar.py pag1.json pag2.json --nombre <nombre-sin-espacios> --salida <carpeta>`
6. **Entregar** los dos archivos y un resumen corto en español: compases leídos, cambios de tonalidad o compás, marcas encontradas (repeticiones, casillas, D.C./D.S., Fine, Coda), y todo lo que quedó dudoso con su número de compás.

## Formato de transcripción (un JSON por página)
```json
{"title": "Fui La Razón", "composer": "Dottie Rambo", "tempo": 80, "key": 0, "time": "3/4", "pickup": false,
 "staves": [{"name": "", "clef": "treble", "voices": ["Soprano", "Contralto"]},
            {"name": "", "clef": "bass",   "voices": ["Tenor", "Bajo"]}],
 "systems": [
   {"staves": [
     [["@dyn=mf r:h r:8 E4:8/¿Cuál|No", "G4:q/fue|pu- G4:q./la|do G4:8/ra-|un"],
      ["r:h r:8 C4:8",                  "E4:q E4:q. E4:8"]],
     [["r:h r:8 G3:8",                  "G3:q G3:q. G3:8"],
      ["r:h r:8 C3:8",                  "C3:q C3:q. C3:8"]]
   ]}
 ],
 "warnings": []}
```
`systems[i].staves[s][v]` es la lista de compases de la voz `v` del pentagrama `s` en ese sistema: un texto por compás. Todas las voces de un sistema tienen la misma cantidad de compases.

**Cada compás** es una lista de eventos separados por espacio:
- **Nota** `ALTURA:DUR`: `C4:q`, `F#5:8`, `Bb3:h.`. C4 es el Do central.
- **ALTURA** = letra + `#` o `b` + octava. Escribe la nota **como suena**: aplica la armadura y las alteraciones anteriores del mismo compás. En Sol mayor todo Fa es `F#`, salvo que tenga becuadro.
- **DUR**: `w` redonda, `h` blanca, `q` negra, `8` corchea, `16` semicorchea, `32` fusa. `.` puntillo, `..` doble puntillo. `~` si se liga con la siguiente (`G4:h~`).
- **Grupos irregulares**: `*3` en cada nota o silencio del tresillo (`E5:8*3 D5:8*3 C5:8*3`); también `*2`, `*5`, `*6`, `*7`.
- **Adornos**, justo antes de su nota: `D5:g` (acciaccatura, con raya) o `D5:ga` (apoyatura).
- **Marcas de la nota**, después de la duración (y del `~`), cada una con `^`: `C5:q^st^(`.
  | Código | Marca | Código | Marca |
  |---|---|---|---|
  | `st` `sm` `te` `ac` `ma` | staccato, staccatissimo, tenuto, acento, marcato | `fe` | calderón |
  | `tr` `pr` `mo` `tu` | trino, mordente superior, mordente inferior, grupeto | `fa` `do` `sc` `be` | caída, doit, scoop, bend |
  | `br` `cs` | respiración, cesura | `gl` | glissando a la nota siguiente |
  | `(` `)` | empieza / termina ligadura de expresión | `<` `>` `!` | empieza crescendo / decrescendo · termina el regulador |
  | `8va` `8vb` `15ma` `8e` | empieza / termina línea de octava (la altura se escribe **como suena**) | `ped` `pe` | pedal abajo / arriba |
  | `pp`…`ff` `sfz` `sf` `fz` `fp` | dinámica bajo esta nota | `t=dolce` | texto bajo la nota (`_` en vez de espacios) |
- **Cifrado** impreso sobre el pentagrama: `[Cm7]` justo antes de la nota donde empieza el acorde, en la primera voz del pentagrama de arriba (`[G7] D5:q [C] C5:h`). Inglés o latino (`[Sib/Re]`), y `[N.C.]`.
- **Acorde** en la misma plica: `C4+E4+G4:q`.
- **Silencio**: `r:q`. Un compás entero en silencio: `r:w` (también en 3/4).
- **Letra** en la voz de arriba de cada pentagrama: `G4:q/gran-`. El guion final indica que la palabra sigue. Varias estrofas se separan con `|`: `G4:q/Al-|To-`. La sinalefa va con `_`: `y_a`. Una nota sin sílaba continúa la anterior (melisma).
- **Al inicio del compás**, en todas las voces: `@key=-1`, `@time=6/8` cuando cambian.
- **Marcas**, al inicio del compás y solo en la primera voz del pentagrama de arriba: `@repStart`, `@repEnd` o `@repEnd=3`, `@volta=1` o `@volta=1,2`, `@segno`, `@coda`, `@toCoda`, `@fine`, `@jump=DC|DCalFine|DCalCoda|DS|DSalFine|DSalCoda`, `@tempo=72`, `@dyn=pp|p|mp|mf|f|ff`, `@swing=8|16|no` (indicación «Swing» o «Recto»), `@reh=A` (marca de ensayo en caja), `@slash` (barras de ritmo).

## Reglas
- Las duraciones de cada voz suman el compás, salvo la anacrusa.
- Nunca te saltes un compás. Si no se lee bien, escribe tu mejor lectura y agrega un aviso en `warnings` con el número de compás.
- Si dos voces comparten una cabeza de nota, escríbela en ambas voces.
- Escribe tresillos, adornos, articulaciones, ligaduras de expresión, reguladores y cifrado con las fichas de arriba; no los aproximes. Lo que no tenga ficha (por ejemplo, otros textos o símbolos raros) menciónalo una vez en `warnings`.
- Las marcas nuevas necesitan Atril 0.2 o posterior. El `.musicxml` del script también las lleva.
- Antes de entregar, compara a ojo la cantidad de compases por sistema con la imagen.
