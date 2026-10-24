#!/usr/bin/env python3
"""Prepara una partitura (PDF o imagen) para transcribirla: una imagen por sistema.

Uso:
  python3 preparar.py partitura.pdf [--salida carpeta] [--paginas 1-3] [--ancho 2200]
                      [--claves treble,bass] [--sin-guia]

Crea en la carpeta de salida (por defecto ./recortes):
  p01_encabezado.jpg      título, autor y tempo de la primera página (si hay espacio sobre la música)
  p01_s01.jpg, p01_s02.jpg …   cada sistema (renglón de pentagramas) en orden de lectura
  p01_s01_guia1.png …     el sistema ampliado x3 por tramos, con una línea punteada y el nombre
                          de cada altura (rojo = línea, azul = espacio, con líneas adicionales)
  p02_pagina.jpg          la página completa cuando no se distinguen los pentagramas
  indice.json             lista de recortes con cantidad de pentagramas por sistema
"""
import argparse, glob, json, os, shutil, subprocess, sys, tempfile

import numpy as np
from PIL import Image, ImageOps

# La consola de Windows no siempre es UTF-8: que los avisos con ♩, ñ o tildes no hagan caer el script.
for _f in (sys.stdout, sys.stderr):
    try:
        _f.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass


def rango(texto, total):
    if not texto:
        return list(range(1, total + 1))
    out = []
    for parte in texto.split(","):
        if "-" in parte:
            a, b = parte.split("-")
            out += list(range(int(a), int(b) + 1))
        else:
            out.append(int(parte))
    return [p for p in out if 1 <= p <= total]


def paginas_pdf(ruta, ancho, sel):
    """Rasteriza con PyMuPDF si está, si no con pdftoppm."""
    try:
        try:
            import pymupdf as fitz  # PyMuPDF (nombre nuevo)
        except ImportError:
            import fitz  # PyMuPDF anterior a 1.24
        doc = fitz.open(ruta)
        for p in rango(sel, doc.page_count):
            pg = doc[p - 1]
            z = ancho / pg.rect.width
            pix = pg.get_pixmap(matrix=fitz.Matrix(z, z), colorspace=fitz.csGRAY)
            yield p, Image.frombytes("L", (pix.width, pix.height), pix.samples)
        return
    except ImportError:
        pass
    if not shutil.which("pdftoppm"):
        sys.exit("Falta PyMuPDF (pip install pymupdf) o pdftoppm (poppler-utils) para leer PDF.")
    info = subprocess.run(["pdfinfo", ruta], capture_output=True, text=True).stdout if shutil.which("pdfinfo") else ""
    total = next((int(l.split()[-1]) for l in info.splitlines() if l.startswith("Pages:")), 200)
    tmp = tempfile.mkdtemp()
    for p in rango(sel, total):
        base = os.path.join(tmp, f"p{p}")
        r = subprocess.run(["pdftoppm", "-f", str(p), "-l", str(p), "-gray", "-scale-to-x", str(ancho), "-scale-to-y", "-1", "-png", ruta, base])
        hechos = sorted(glob.glob(base + "*.png"))
        if r.returncode != 0 or not hechos:
            continue
        yield p, Image.open(hechos[0]).convert("L")


def detectar_sistemas(img):
    """Misma lógica que Atril (detectSystems): busca líneas de pentagrama y agrupa pentagramas unidos por la barra inicial."""
    a = np.asarray(img)
    H, W = a.shape
    dark = a < 195
    filas = dark.sum(axis=1)
    lineas = []
    for y in range(H):
        if filas[y] > W * 0.32:
            if lineas and y - lineas[-1][1] <= 2:
                lineas[-1][1] = y
            else:
                lineas.append([y, y])
    cs = [(s + e) / 2 for s, e in lineas]
    staves, i = [], 0
    while i + 4 < len(cs):
        seg = cs[i:i + 5]
        gaps = [seg[k + 1] - seg[k] for k in range(4)]
        avg = sum(gaps) / 4
        if 4 <= avg < H * 0.03 and all(abs(g - avg) <= max(2, avg * 0.3) for g in gaps):
            staves.append({"top": seg[0], "bottom": seg[4], "gap": avg})
            i += 5
        else:
            i += 1
    if not staves:
        return None
    run = max(1, round(W * 0.05))
    for s in staves:
        y = round(s["top"] + 2 * s["gap"])
        fila = dark[y]
        s["left"] = 0
        acum = np.convolve(fila.astype(np.int32), np.ones(run, dtype=np.int32), "valid")
        idx = np.nonzero(acum > run * 0.9)[0]
        if len(idx):
            s["left"] = int(idx[0])

    def unidos(a_, b_):
        x0 = max(0, min(a_["left"], b_["left"]) - 3)
        x1 = min(W - 1, max(a_["left"], b_["left"]) + 10)
        y0, y1 = int(np.ceil(a_["bottom"] + 2)), int(np.floor(b_["top"] - 2))
        if y1 <= y0:
            return True
        hit = dark[y0:y1 + 1, x0:x1 + 1].any(axis=1).sum()
        return hit / (y1 - y0 + 1) > 0.85

    grupos = [[staves[0]]]
    for k in range(1, len(staves)):
        if unidos(staves[k - 1], staves[k]):
            grupos[-1].append(staves[k])
        else:
            grupos.append([staves[k]])
    def derecha(st):
        cols = np.nonzero(dark[round(st["top"] + 2 * st["gap"])])[0]
        return int(cols[-1]) if len(cols) else W - 1

    out = [{"top": g[0]["top"], "bottom": g[-1]["bottom"], "gap": g[0]["gap"], "pentagramas": len(g),
            "pentas": [(st["top"], st["gap"]) for st in g],
            "left": min(st["left"] for st in g), "right": max(derecha(st) for st in g)} for g in grupos]
    for k, s in enumerate(out):
        prev = out[k - 1] if k else None
        nxt = out[k + 1] if k + 1 < len(out) else None
        s["y0"] = round((prev["bottom"] + s["top"]) / 2) if prev else max(0, round(s["top"] - 7 * s["gap"]))
        s["y1"] = round((s["bottom"] + nxt["top"]) / 2) if nxt else min(H, round(s["bottom"] + 8 * s["gap"]))
    return out


# Nota de la línea superior de cada clave, como índice diatónico (octava * 7 + paso; C4 = 28).
# Alturas ESCRITAS, como las guarda Atril: en las claves con 8 (treble8, treble8va, bass8vb) se lee igual que en la
# clave sin 8 y Atril corre la octava al hacerla sonar. Por eso treble8 y treble8va usan la misma línea que treble.
LINEA_SUPERIOR = {"treble": 38, "treble8": 38, "treble8va": 38, "bass": 26, "bass8vb": 26, "alto": 32, "tenor": 30}
PASOS = "CDEFGAB"


def claves_del_sistema(texto, n):
    """--claves "treble,bass" se repite en cada sistema; sin --claves supone sol + fa con 2 pentagramas y sol en los demás casos."""
    if texto:
        lista = [c.strip() for c in texto.split(",") if c.strip()]
    else:
        lista = ["treble", "bass"] if n == 2 else ["treble"]
    return [lista[k % len(lista)] for k in range(n)]


def guias(img, s, claves, base, salida, zoom=3, tramo=750):
    """Amplía el sistema por tramos y dibuja una línea punteada con el nombre de cada altura
    (incluidas 3 líneas adicionales arriba y abajo): rojo en líneas, azul en espacios."""
    from PIL import ImageDraw, ImageFont
    try:
        fuente = ImageFont.load_default(size=13)
    except TypeError:
        fuente = ImageFont.load_default()
    rgb = img.convert("RGB")
    izq, der = max(0, s["left"] - 10), min(img.width, s["right"] + 10)
    n = max(1, -(-(der - izq) // tramo))
    ancho = -(-(der - izq) // n)
    nombres = []
    for k in range(n):
        x0 = max(0, izq + k * ancho - 40)
        x1 = min(img.width, izq + (k + 1) * ancho + 40)
        c = rgb.crop((x0, s["y0"], x1, s["y1"]))
        c = c.resize((c.width * zoom, c.height * zoom), Image.LANCZOS)
        d = ImageDraw.Draw(c)
        for (top, gap), clave in zip(s["pentas"], claves):
            sup = LINEA_SUPERIOR.get(clave)
            if sup is None:
                continue
            for j in range(-6, 15):
                y = (top - s["y0"] + j * gap / 2) * zoom
                col = (220, 0, 0) if j % 2 == 0 else (0, 140, 255)
                for xx in range(0, c.width, 6):
                    d.point((xx, y), fill=col)
                idx = sup - j
                for xx in range(4, c.width, 260):
                    d.text((xx, y - 7), PASOS[idx % 7] + str(idx // 7), fill=col, font=fuente)
        nom = f"{base}_guia{k + 1}.png"
        c.save(os.path.join(salida, nom))
        nombres.append(nom)
    return nombres


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("archivo")
    ap.add_argument("--salida", default="recortes")
    ap.add_argument("--paginas", default="")
    ap.add_argument("--ancho", type=int, default=2200)
    ap.add_argument("--claves", default="", help='claves de arriba abajo en cada sistema, p. ej. "treble,bass"')
    ap.add_argument("--sin-guia", action="store_true", help="no generar las imágenes con guía de alturas")
    args = ap.parse_args()
    os.makedirs(args.salida, exist_ok=True)
    ext = os.path.splitext(args.archivo)[1].lower()
    if ext == ".pdf":
        paginas = paginas_pdf(args.archivo, args.ancho, args.paginas)
    else:
        im = ImageOps.exif_transpose(Image.open(args.archivo)).convert("L")
        if im.width < args.ancho:
            im = im.resize((args.ancho, round(im.height * args.ancho / im.width)), Image.LANCZOS)
        paginas = [(1, im)]
    indice = []
    primera = True
    for p, img in paginas:
        sis = detectar_sistemas(img)
        if not sis:
            nom = f"p{p:02d}_pagina.jpg"
            img.save(os.path.join(args.salida, nom), quality=92)
            indice.append({"pagina": p, "archivo": nom, "tipo": "pagina", "aviso": "no se detectaron pentagramas: leer con más cuidado"})
            print(f"Página {p}: no se distinguieron los pentagramas → {nom}")
            primera = False
            continue
        if primera and sis[0]["y0"] > img.height * 0.04:
            nom = f"p{p:02d}_encabezado.jpg"
            img.crop((0, 0, img.width, sis[0]["y0"])).save(os.path.join(args.salida, nom), quality=92)
            indice.append({"pagina": p, "archivo": nom, "tipo": "encabezado"})
        primera = False
        for k, s in enumerate(sis, 1):
            nom = f"p{p:02d}_s{k:02d}.jpg"
            img.crop((0, s["y0"], img.width, s["y1"])).save(os.path.join(args.salida, nom), quality=92)
            ent = {"pagina": p, "archivo": nom, "tipo": "sistema", "pentagramas": s["pentagramas"]}
            if not args.sin_guia:
                claves = claves_del_sistema(args.claves, s["pentagramas"])
                ent["claves"] = claves
                ent["guias"] = guias(img, s, claves, nom[:-4], args.salida)
            indice.append(ent)
        print(f"Página {p}: {len(sis)} sistemas de {sis[0]['pentagramas']} pentagrama(s)")
    json.dump(indice, open(os.path.join(args.salida, "indice.json"), "w"), ensure_ascii=False, indent=1)
    print(f"Listo: {len(indice)} imágenes en {args.salida}/")


if __name__ == "__main__":
    main()
