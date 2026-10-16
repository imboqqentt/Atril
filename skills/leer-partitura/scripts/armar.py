#!/usr/bin/env python3
"""Arma la partitura final a partir de la transcripción compacta.

Uso:
  python3 armar.py pag1.json [pag2.json …] --nombre "fui-la-razon" [--salida carpeta]

Cada JSON es la transcripción de una página (o de un grupo de sistemas) en el formato de SKILL.md,
en orden. Escribe:
  <nombre>.atril      se abre directo en Atril (doble clic o Archivo → Abrir)
  <nombre>.musicxml   para MuseScore, Sibelius, Dorico o Atril
y muestra un informe: compases, compases que no cuadran, fichas ilegibles y advertencias.
Con --revisar solo informa, sin escribir archivos.
"""
import argparse, json, os, random, re, string, sys, time
from xml.sax.saxutils import escape

# Tiempo interno igual que Atril 0.2: una negra = 3360 (permite fusas, doble puntillo y grupos de 3, 5, 6 y 7 exactos).
TQ = 3360
TICKS = {"w": TQ * 4, "h": TQ * 2, "q": TQ, "8": TQ // 2, "16": TQ // 4, "32": TQ // 8}
DOT_MUL = [1, 1.5, 1.75]
STEPS = "CDEFGAB"
REST_VALS = [(TICKS[d], d) for d in ("w", "h", "q", "8", "16", "32")]
CLEFS = {"treble": ("G", 2, 0), "treble8": ("G", 2, -1), "bass": ("F", 4, 0), "alto": ("C", 3, 0),
         "tenor": ("C", 4, 0), "treble8va": ("G", 2, 1), "bass8vb": ("F", 4, -1), "perc": ("percussion", 0, 0)}
XML_TYPE = {"w": "whole", "h": "half", "q": "quarter", "8": "eighth", "16": "16th", "32": "32nd"}
# PITCH:DUR[.|..][*n][~][^marca…][/letra]; DUR g / ga = adorno (acciaccatura / apoyatura)
TOKEN_RE = re.compile(r"^(r|[A-Ga-g][#b]?-?\d(?:\+[A-Ga-g][#b]?-?\d)*):(w|h|q|8|16|32|64|ga|g)(\.{0,2})(?:\*(\d))?(~?)((?:\^[^\^]+)*)$")
TIME_RE = re.compile(r"^\d{1,2}/(1|2|4|8|16)$")
JUMPS = {"DC": "D.C.", "DCalFine": "D.C. al Fine", "DCalCoda": "D.C. al Coda", "DS": "D.S.", "DSalFine": "D.S. al Fine", "DSalCoda": "D.S. al Coda"}
TUPLETS = {3: (3, 2), 2: (2, 3), 5: (5, 4), 6: (6, 4), 7: (7, 4)}
# instrumentos transpositores: (pasos, semitonos) de lo escrito a lo que suena, quintas que suma la armadura escrita
TRANS = {"bb": (-1, -2, 2), "ten": (-8, -14, 2), "eb": (-5, -9, 3), "bari": (-12, -21, 3), "a": (-2, -3, -3), "f": (-4, -7, 1), "ebs": (2, 3, 3)}
NOTE_DYN = ["pp", "p", "mp", "mf", "f", "ff", "sfz", "sf", "fz", "fp"]
ART_CODES = {"st": "stacc", "sm": "stmo", "te": "ten", "ac": "acc", "ma": "marc"}
ART_XML = {"stacc": "staccato", "stmo": "staccatissimo", "ten": "tenuto", "acc": "accent", "marc": "strong-accent"}
ORN_CODES = {"tr": "tr", "pr": "prall", "mo": "mord", "tu": "turn", "fa": "fall", "do": "doit", "sc": "scoop", "be": "bend"}
ORN_XML = {"tr": "<ornaments><trill-mark/></ornaments>", "prall": "<ornaments><inverted-mordent/></ornaments>", "mord": "<ornaments><mordent/></ornaments>",
           "turn": "<ornaments><turn/></ornaments>", "fall": "<articulations><falloff/></articulations>", "doit": "<articulations><doit/></articulations>",
           "scoop": "<articulations><scoop/></articulations>", "bend": "<technical><bend><bend-alter>-1</bend-alter><release/></bend></technical>"}
FLAG_CODES = {"fe": ("ferm", True), "br": ("brk", "breath"), "cs": ("brk", "caes"), "gl": ("gliss", True), "(": ("sls", True), ")": ("sle", True),
              "<": ("hp", "<"), ">": ("hp", ">"), "!": ("hpe", True), "8va": ("ova", "8va"), "8vb": ("ova", "8vb"), "15ma": ("ova", "15ma"),
              "8e": ("ovae", True), "ped": ("ped", True), "pe": ("pede", True)}
OTTAVA_XML = {"8va": ("down", 8), "8vb": ("up", 8), "15ma": ("down", 15)}
ROOT_LATIN = {"do": "C", "re": "D", "mi": "E", "fa": "F", "sol": "G", "la": "A", "si": "B"}


def uid():
    return "s" + format(int(time.time() * 1000), "x") + "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(5))


def time_ticks(t):
    n, d = map(int, t.split("/"))
    return n * (TICKS["w"] // d)


def nominal_ticks(n):
    return TICKS[n["d"]] * DOT_MUL[n.get("dots") or 0]


def note_ticks(n):
    t = n.get("tup")
    return round(nominal_ticks(n) * t["of"] / t["n"]) if t else round(nominal_ticks(n))


def wrap_fifths(f):
    while f > 7:
        f -= 12
    while f < -7:
        f += 12
    return f


def tuplet_groups(notes):
    """Índices de cada grupo irregular: notas seguidas con el mismo tup hasta llenar n figuras de la unidad u."""
    out, g = [], None
    for j, x in enumerate(notes):
        t = x.get("tup")
        if not t:
            g = None
            continue
        if g and (g["n"] != t["n"] or g["of"] != t["of"] or g["acc"] >= g["cap"]):
            g = None
        if not g:
            g = {"n": t["n"], "of": t["of"], "cap": t["n"] * TICKS[t.get("u") or x["d"]], "acc": 0, "idx": []}
            out.append(g)
        g["idx"].append(j)
        g["acc"] += nominal_ticks(x)
    return out


def parse_chord(text):
    """Cifrado en inglés o latino → {root, q, bass} (la calidad se deja tal cual, con ♭/♯) o {text}."""
    t = text.strip()
    if re.match(r"^n\.?\s?c\.?$", t, re.I):
        return {"text": "N.C."}

    def root(s):
        m = re.match(r"^(sol|do|re|mi|fa|la|si)([#b♯♭]?)", s, re.I) or re.match(r"^([A-Ga-g])([#b♯♭]?)", s)
        if not m:
            return None, s
        st = ROOT_LATIN.get(m.group(1).lower()) or m.group(1).upper()
        return {"s": st, "a": 1 if m.group(2) in "#♯" and m.group(2) else -1 if m.group(2) in "b♭" and m.group(2) else 0}, s[m.end():]
    r, rest = root(t)
    if not r:
        return {"text": t[:24]}
    c = {"root": r}
    if "/" in rest:
        b, tail = root(rest[rest.rindex("/") + 1:])
        if b and not tail:
            c["bass"], rest = b, rest[:rest.rindex("/")]
    c["q"] = rest.replace("b", "♭").replace("#", "♯") if re.search(r"\d", rest) else rest
    return c


def dia(k):
    return k["o"] * 7 + STEPS.index(k["s"])


def parse_token(raw):
    tok = raw.replace("♯", "#").replace("♭", "b").strip()
    lyr = None
    if "/" in tok and tok.index("/") > 0:
        tok, lyr = tok.split("/", 1)
    m = TOKEN_RE.match(tok)
    if not m:
        return None
    d = m.group(2)
    if d == "64":
        d = "32"
    grace = d in ("g", "ga")
    dots = 0 if grace else min(len(m.group(3)), 1 if d in ("w", "32") else 2)
    tn = int(m.group(4) or 0)
    marks = [x for x in (m.group(6) or "").split("^") if x]
    if m.group(1) == "r":
        r = {"d": "8" if grace else d, "dots": dots, "rest": True, "tie": False, "keys": []}
        if tn in TUPLETS:
            r["tup"] = {"n": TUPLETS[tn][0], "of": TUPLETS[tn][1], "u": r["d"]}
        if "fe" in marks:
            r["ferm"] = True
        return r
    keys = []
    for p in m.group(1).split("+"):
        q = re.match(r"^([A-Ga-g])([#b]?)(-?\d)$", p)
        keys.append({"s": q.group(1).upper(), "a": 1 if q.group(2) == "#" else -1 if q.group(2) == "b" else 0, "o": max(0, min(8, int(q.group(3))))})
    keys.sort(key=dia)
    uniq = [k for i, k in enumerate(keys) if not i or k != keys[i - 1]]
    if grace:
        return {"grace": {"keys": uniq, "d": "8", "slash": d == "g"}}
    n = {"d": d, "dots": dots, "rest": False, "tie": bool(m.group(5)), "keys": uniq}
    if tn in TUPLETS:
        n["tup"] = {"n": TUPLETS[tn][0], "of": TUPLETS[tn][1], "u": d}
    for c in marks:
        if c in ART_CODES:
            n["art"] = list(dict.fromkeys((n.get("art") or []) + [ART_CODES[c]]))
        elif c in ORN_CODES:
            n["orn"] = ORN_CODES[c]
        elif c in FLAG_CODES:
            n[FLAG_CODES[c][0]] = FLAG_CODES[c][1]
        elif c in NOTE_DYN:
            n["dyn"] = c
        elif c.startswith("t="):
            n["txt"] = c[2:].replace("_", " ")[:40]
    if lyr:
        ly = []
        for x in lyr.split("|"):
            x = x.strip()
            if not x:
                ly.append(None)
                continue
            h = x.endswith("-")
            t = x.rstrip("-")
            ly.append({"t": t[:30], "h": h} if t else None)
        while ly and ly[-1] is None:
            ly.pop()
        if ly:
            n["ly"] = ly[:8]
    return n


def decompose_rest(pos, t):
    out = []
    while t > 0:
        v = next((v for v in REST_VALS if v[0] <= t and pos % v[0] == 0), None) or next((v for v in REST_VALS if v[0] <= t), None)
        if not v:
            break
        out.append(v)
        pos += v[0]
        t -= v[0]
    return out


def same_keys(a, b):
    return bool(a) and bool(b) and len(a) == len(b) and all(x["s"] == y["s"] and x.get("a", 0) == y.get("a", 0) and x["o"] == y["o"] for x, y in zip(a, b))


# ---------- unir páginas (como mergeOmr de Atril) ----------
def merge(pages):
    ctx = {"staves": None, "systems": [], "warnings": [], "title": "", "composer": "", "tempo": None}
    for res in pages:
        if not isinstance(res, dict) or not isinstance(res.get("systems"), list):
            sys.exit("Un archivo no tiene el formato esperado (falta 'systems').")
        if ctx["staves"] is None:
            st = res.get("staves") or [{"name": "", "clef": "treble", "voices": [""]}]
            ctx["staves"] = [dict({"name": str(s.get("name") or "")[:40], "clef": s.get("clef") if s.get("clef") in CLEFS else "treble",
                                   "voices": [str(x or "")[:30] for x in (s.get("voices") or [""])[:2]] or [""]},
                                  **({"trans": s["trans"]} if s.get("trans") in TRANS else {})) for s in st[:12]]
            ctx["key"] = max(-7, min(7, int(round(float(res.get("key") or 0)))))
            ctx["time"] = str(res.get("time")) if TIME_RE.match(str(res.get("time"))) else "4/4"
            ctx["lastKey"], ctx["lastTime"], ctx["pickup"] = ctx["key"], ctx["time"], bool(res.get("pickup"))
            pend_k = pend_t = None
        else:
            k = res.get("key")
            t = str(res.get("time") or "")
            pend_k = int(k) if isinstance(k, (int, float)) and int(k) != ctx["lastKey"] and abs(int(k)) <= 7 else None
            pend_t = t if TIME_RE.match(t) and t != ctx["lastTime"] else None
        if res.get("title") and not ctx["title"]:
            ctx["title"] = str(res["title"])[:120]
        if res.get("composer") and not ctx["composer"]:
            ctx["composer"] = str(res["composer"])[:120]
        tp = res.get("tempo")
        if not ctx["tempo"] and isinstance(tp, (int, float)) and 30 <= tp <= 260:
            ctx["tempo"] = int(round(tp))
        for w in res.get("warnings") or []:
            if w and str(w) not in ctx["warnings"]:
                ctx["warnings"].append(str(w)[:240])
        for si, sysm in enumerate(res["systems"]):
            arr = sysm.get("staves") if isinstance(sysm, dict) else sysm if isinstance(sysm, list) else []
            norm = []
            for s in range(len(ctx["staves"])):
                a = arr[s] if s < len(arr) else None
                if not isinstance(a, list):
                    norm.append([[]])
                elif a and isinstance(a[0], str):
                    norm.append([[str(x) for x in a]])
                else:
                    norm.append([[str(x) for x in vv] if isinstance(vv, list) else [] for vv in a])
            if si == 0 and (pend_k is not None or pend_t):
                pre = (f"@key={pend_k} " if pend_k is not None else "") + (f"@time={pend_t} " if pend_t else "")
                for st in norm:
                    for vv in st:
                        if vv and not re.search(r"@(key|time)=", vv[0]):
                            vv[0] = pre + vv[0]
                pend_k = pend_t = None
            ctx["systems"].append(norm)
            for st in norm:
                for vv in st:
                    for ms in vv:
                        k = re.search(r"@key=(-?\d)", ms)
                        t = re.search(r"@time=(\d{1,2}/\d{1,2})", ms)
                        if k:
                            ctx["lastKey"] = int(k.group(1))
                        if t:
                            ctx["lastTime"] = t.group(1)
    return ctx


# ---------- armar la partitura (como buildFromOmr de Atril) ----------
def build(ctx):
    S = len(ctx["staves"])
    sc = {"id": uid(), "title": ctx["title"] or "Partitura leída", "composer": ctx["composer"] or "", "tempo": ctx["tempo"] or 90,
          "time": ctx["time"], "key": ctx["key"], "changes": [], "marks": {}, "layout": {"staff": 6, "perSystem": 0},
          "groups": [{"type": "bracket", "from": 0, "to": S - 1}] if S > 1 else [],
          "staves": [dict({"name": (s["name"] if len(s["voices"]) > 1 else (s["name"] or s["voices"][0] or "")), "clef": s["clef"],
                           "voices": [{"name": (n if len(s["voices"]) > 1 else ""), "notes": []} for n in s["voices"]]},
                          **({"trans": s["trans"]} if s.get("trans") else {})) for s in ctx["staves"]]}
    chords = []  # [{m, at, root, q, bass} | {m, at, text}]  at = negras desde el inicio del compás
    rep = {"compases": 0, "no_cuadran": [], "fichas_malas": [], "anacrusa": False, "advertencias": list(ctx["warnings"])}
    measures = []  # para MusicXML: [{key, time, keyChange, timeChange, marks, cells{(s,v): notes}}]
    cur_k, cur_t, m_idx = ctx["key"], ctx["time"], 0
    for sysm in ctx["systems"]:
        M = max([len(vv) for st in sysm for vv in st] + [0])
        for m in range(M):
            nk = nt = None
            for st in sysm:
                for vv in st:
                    ms = vv[m] if m < len(vv) else ""
                    k = re.search(r"@key=(-?\d)", ms)
                    t = re.search(r"@time=(\d{1,2}/(?:1|2|4|8|16))\b", ms)
                    if k and nk is None:
                        nk = max(-7, min(7, int(k.group(1))))
                    if t and not nt:
                        nt = t.group(1)
            kc = tc = False
            if m_idx > 0 and ((nk is not None and nk != cur_k) or (nt and nt != cur_t)):
                c = {"m": m_idx}
                if nk is not None and nk != cur_k:
                    c["key"] = cur_k = nk
                    kc = True
                if nt and nt != cur_t:
                    c["time"] = cur_t = nt
                    tc = True
                sc["changes"].append(c)
            elif m_idx == 0:
                if nk is not None:
                    sc["key"] = cur_k = nk
                if nt:
                    sc["time"] = cur_t = nt
            MT = time_ticks(cur_t)
            om = {}
            for st in sysm:
                for vv in st:
                    ms = vv[m] if m < len(vv) else ""
                    if re.search(r"@repStart\b", ms):
                        om["repStart"] = True
                    r_ = re.search(r"@repEnd(?:=(\d))?", ms)
                    if r_:
                        om["repEnd"] = max(2, min(4, int(r_.group(1) or 2)))
                    v_ = re.search(r"@volta=([\d,]+)", ms)
                    if v_:
                        om["volta"] = [int(x) for x in v_.group(1).split(",") if x and 0 < int(x) < 5]
                    for f in ("segno", "coda", "toCoda", "fine"):
                        if re.search(r"@" + f + r"\b", ms):
                            om[f] = True
                    j_ = re.search(r"@jump=(DC|DS)(alFine|alCoda)?", ms)
                    if j_:
                        om["jump"] = j_.group(1) + (j_.group(2) or "")
                    t_ = re.search(r"@tempo=(\d{2,3})", ms)
                    if t_ and int(t_.group(1)) >= 20:
                        if m_idx == 0:
                            sc["tempo"] = int(t_.group(1))
                        else:
                            om["tempo"] = int(t_.group(1))
                    d_ = re.search(r"@dyn=(pp|p|mp|mf|f|ff)\b", ms)
                    if d_:
                        om["dyn"] = d_.group(1)
                    s_ = re.search(r"@swing=(8|16|no)\b", ms)
                    if s_:
                        om["swing"] = s_.group(1)
                    h_ = re.search(r"@reh=(\S{1,6})", ms)
                    if h_:
                        om["reh"] = h_.group(1)
                    if re.search(r"@slash\b", ms):
                        om["slash"] = True
            if om:
                sc["marks"][str(m_idx)] = om
            cells = []
            for s in range(S):
                for v in range(len(ctx["staves"][s]["voices"])):
                    vv = sysm[s][v] if s < len(sysm) and v < len(sysm[s]) else []
                    txt = vv[m] if m < len(vv) else ""
                    notes, pend_g, tick = [], [], 0
                    for tok in re.sub(r"@\S+", " ", txt).split():
                        ch = re.match(r"^\[(.+)\]$", tok)
                        if ch:  # acorde escrito donde empieza la nota siguiente
                            at = round(tick / TQ, 4)
                            if not any(x["m"] == m_idx and x["at"] == at for x in chords):
                                chords.append(dict({"m": m_idx, "at": at}, **parse_chord(ch.group(1))))
                            continue
                        n = parse_token(tok)
                        if not n:
                            rep["fichas_malas"].append(f"c.{m_idx + 1} '{tok}'")
                        elif "grace" in n:
                            pend_g.append(n["grace"])  # el adorno espera su nota
                        else:
                            if pend_g and not n["rest"]:
                                n["grace"], pend_g = pend_g, []
                            notes.append(n)
                            tick += note_ticks(n)
                    cells.append({"s": s, "v": v, "notes": notes, "ticks": sum(note_ticks(n) for n in notes)})
            filled = [c for c in cells if c["ticks"] > 0]
            all_short = bool(filled) and all(c["ticks"] < MT for c in filled)
            # anacrusa: el primer compás dura lo que su voz más larga (score.pickup, en negras), sin rellenar al comienzo
            ML = MT
            if m_idx == 0 and (ctx["pickup"] or all_short) and filled and max(c["ticks"] for c in cells) < MT:
                ML = max(c["ticks"] for c in cells)
                sc["pickup"] = round(ML / TQ, 3)
                rep["anacrusa"] = True
            mcells = {}
            for c in cells:
                notes = c["notes"]

                def rest_fill(t):
                    return [dict({"d": d, "dots": 0, "rest": True, "tie": False, "keys": []}, **({"hid": True} if c["v"] > 0 else {})) for _, d in decompose_rest(0, t)]

                if c["ticks"] == 0:
                    notes = rest_fill(ML)
                elif c["ticks"] < ML:
                    fill = rest_fill(ML - c["ticks"])
                    if ML < MT:
                        notes = fill + notes  # en la anacrusa las voces cortas entran al final
                    else:
                        notes = notes + fill
                        if m_idx + 1 not in rep["no_cuadran"]:
                            rep["no_cuadran"].append(m_idx + 1)
                elif c["ticks"] > ML and m_idx + 1 not in rep["no_cuadran"]:
                    rep["no_cuadran"].append(m_idx + 1)
                sc["staves"][c["s"]]["voices"][c["v"]]["notes"].extend(notes)
                mcells[(c["s"], c["v"])] = notes
            measures.append({"key": cur_k, "time": cur_t, "kc": kc, "tc": tc, "marks": om, "cells": mcells, "len": ML, "m": m_idx})
            m_idx += 1
    rep["compases"] = m_idx
    for st in sc["staves"]:
        for vc in st["voices"]:
            ns = vc["notes"]
            for i, n in enumerate(ns):
                if n.get("tie") and not same_keys(n["keys"], ns[i + 1]["keys"] if i + 1 < len(ns) else None):
                    n["tie"] = False
    if chords:
        sc["chords"] = sorted(chords, key=lambda c: (c["m"], c["at"]))
    # la armadura leída es la del pentagrama de arriba; si es transpositor, el .atril guarda la real
    tr = TRANS.get(sc["staves"][0].get("trans")) if sc["staves"] else None
    if tr:
        sc["key"] = wrap_fifths(sc["key"] - tr[2])
        for c in sc["changes"]:
            if "key" in c:
                c["key"] = wrap_fifths(c["key"] - tr[2])
    sc["v"] = 2
    return sc, measures, rep


# ---------- MusicXML ----------
XML_KIND = {"": "major", "m": "minor", "°": "diminished", "dim": "diminished", "+": "augmented", "aug": "augmented", "7": "dominant",
            "maj7": "major-seventh", "m7": "minor-seventh", "°7": "diminished-seventh", "dim7": "diminished-seventh",
            "m7(♭5)": "half-diminished", "m7♭5": "half-diminished", "6": "major-sixth", "m6": "minor-sixth", "9": "dominant-ninth",
            "maj9": "major-ninth", "m9": "minor-ninth", "11": "dominant-11th", "13": "dominant-13th", "sus2": "suspended-second", "sus4": "suspended-fourth", "sus": "suspended-fourth"}


def harmony_xml(c, offset):
    off = f"<offset>{offset}</offset>" if offset > 0 else ""
    if c.get("text"):
        return f'<harmony print-frame="no"><root><root-step text="">C</root-step></root><kind text="{escape(c["text"])}">none</kind>{off}</harmony>'
    step = lambda tag, k: f"<{tag}-step>{k['s']}</{tag}-step>" + (f"<{tag}-alter>{k['a']}</{tag}-alter>" if k.get("a") else "")
    q = c.get("q", "")
    return (f'<harmony print-frame="no"><root>{step("root", c["root"])}</root><kind text="{escape(q)}">{XML_KIND.get(q, "other")}</kind>'
            + (f'<bass>{step("bass", c["bass"])}</bass>' if c.get("bass") else "") + f"{off}</harmony>")
def to_musicxml(sc, measures):
    DIV = TQ  # divisiones por negra = ticks internos (lo demás —marcas, acordes, transpositores— se exporta completo desde Atril)
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
           '<score-partwise version="4.0">',
           f'<work><work-title>{escape(sc["title"])}</work-title></work>',
           f'<identification><creator type="composer">{escape(sc["composer"])}</creator><encoding><software>Atril · skill leer-partitura</software></encoding></identification>',
           "<part-list>"]
    for s, st in enumerate(sc["staves"]):
        nm = st["name"] or " / ".join(v["name"] for v in st["voices"] if v["name"]) or f"Pentagrama {s + 1}"
        out.append(f'<score-part id="P{s + 1}"><part-name>{escape(nm)}</part-name></score-part>')
    out.append("</part-list>")
    # ligaduras: el estado "termina ligadura" por voz
    # las armaduras leídas son las del pentagrama de arriba; cada parte lleva la suya (escrita si es transpositora)
    kf_top = (TRANS.get(sc["staves"][0].get("trans")) or (0, 0, 0))[2] if sc["staves"] else 0
    pick = bool(sc.get("pickup"))
    nd = [0]

    def direction(inner, place, v):
        nd[0] += 1
        return f'<direction placement="{place}" id="nd{nd[0]}"><direction-type>{inner}</direction-type><voice>{v + 1}</voice></direction>'
    for s, st in enumerate(sc["staves"]):
        out.append(f'<part id="P{s + 1}">')
        tr = TRANS.get(st.get("trans"))
        kf = (tr[2] if tr else 0) - kf_top
        tie_in = {v: False for v in range(len(st["voices"]))}
        hyph = {v: {} for v in range(len(st["voices"]))}
        gl_in = {v: False for v in range(len(st["voices"]))}
        for mi, me in enumerate(measures):
            out.append(f'<measure number="{mi if pick else mi + 1}"' + (' implicit="yes"' if pick and mi == 0 else "") + ">")
            mk = me["marks"]
            if mk.get("repStart") or (mk.get("volta") and (mi == 0 or measures[mi - 1]["marks"].get("volta") != mk["volta"])):
                bl = '<barline location="left">'
                if mk.get("repStart"):
                    bl += '<bar-style>heavy-light</bar-style><repeat direction="forward"/>'
                if mk.get("volta") and (mi == 0 or measures[mi - 1]["marks"].get("volta") != mk["volta"]):
                    nums = ",".join(map(str, mk["volta"]))
                    bl += f'<ending number="{nums}" type="start">{nums}.</ending>'
                out.append(bl + "</barline>")
            sl, sl_prev = bool(me["marks"].get("slash")), mi > 0 and bool(measures[mi - 1]["marks"].get("slash"))
            if mi == 0 or me["kc"] or me["tc"] or sl != sl_prev:
                at = f"<attributes>" + (f"<divisions>{DIV}</divisions>" if mi == 0 else "")
                if mi == 0 or me["kc"]:
                    at += f'<key><fifths>{wrap_fifths(me["key"] + kf)}</fifths></key>'
                if mi == 0 or me["tc"]:
                    b, t = me["time"].split("/")
                    at += f"<time><beats>{b}</beats><beat-type>{t}</beat-type></time>"
                if mi == 0:
                    sign, line, octc = CLEFS[st["clef"]]
                    at += f"<clef><sign>{sign}</sign>" + (f"<line>{line}</line>" if line else "") + (f"<clef-octave-change>{octc}</clef-octave-change>" if octc else "") + "</clef>"
                    if tr:
                        oc = int(tr[0] / 7)
                        at += f"<transpose><diatonic>{tr[0] - 7 * oc}</diatonic><chromatic>{tr[1] - 12 * oc}</chromatic>" + (f"<octave-change>{oc}</octave-change>" if oc else "") + "</transpose>"
                if sl != sl_prev:
                    at += f'<measure-style><slash type="{"start" if sl else "stop"}"' + (' use-stems="no"' if sl else "") + "/></measure-style>"
                out.append(at + "</attributes>")
            if s == 0:
                dirs = []
                if mi == 0:
                    dirs.append(f'<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>{sc["tempo"]}</per-minute></metronome></direction-type><sound tempo="{sc["tempo"]}"/></direction>')
                if mk.get("tempo"):
                    dirs.append(f'<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>{mk["tempo"]}</per-minute></metronome></direction-type><sound tempo="{mk["tempo"]}"/></direction>')
                if mk.get("segno"):
                    dirs.append('<direction placement="above"><direction-type><segno/></direction-type><sound segno="segno"/></direction>')
                if mk.get("coda"):
                    dirs.append('<direction placement="above"><direction-type><coda/></direction-type><sound coda="coda"/></direction>')
                if mk.get("dyn"):
                    dirs.append(f'<direction placement="below"><direction-type><dynamics><{mk["dyn"]}/></dynamics></direction-type></direction>')
                if mk.get("reh"):
                    dirs.append(f'<direction placement="above"><direction-type><rehearsal enclosure="square">{escape(mk["reh"])}</rehearsal></direction-type></direction>')
                if mk.get("swing") == "no":
                    dirs.append('<direction placement="above"><direction-type><words>Recto</words></direction-type><sound><swing><straight/></swing></sound></direction>')
                elif mk.get("swing"):
                    dirs.append(f'<direction placement="above"><direction-type><words>Swing</words></direction-type><sound><swing><first>2</first><second>1</second><swing-type>{"16th" if mk["swing"] == "16" else "eighth"}</swing-type></swing></sound></direction>')
                for c in [c for c in sc.get("chords", []) if c["m"] == me.get("m", mi)]:
                    dirs.append(harmony_xml(c, round(c["at"] * TQ)))
                out += dirs
            total = me.get("len") or time_ticks(me["time"])
            for v in range(len(st["voices"])):
                notes = me["cells"].get((s, v), [])
                if v > 0:
                    out.append(f"<backup><duration>{total}</duration></backup>")
                tup_at = {}
                for g in tuplet_groups(notes):
                    for i, j in enumerate(g["idx"]):
                        tup_at[j] = (g["n"], g["of"], i == 0, i == len(g["idx"]) - 1)
                for j, n in enumerate(notes):
                    dur = int(note_ticks(n))
                    tg = tup_at.get(j)
                    dots = "<dot/>" * (n.get("dots") or 0) + (f"<time-modification><actual-notes>{tg[0]}</actual-notes><normal-notes>{tg[1]}</normal-notes></time-modification>" if tg else "")
                    tupn = (('<tuplet type="start" bracket="yes"/>' if tg[2] else "") + ('<tuplet type="stop"/>' if tg[3] else "")) if tg else ""
                    if n["rest"]:
                        po = ' print-object="no"' if n.get("hid") else ""
                        whole = n["d"] == "w" and dur == total
                        mr = ' measure="yes"' if whole else ""
                        nots = tupn + ("<fermata/>" if n.get("ferm") else "")
                        out.append(f"<note{po}><rest{mr}/><duration>{dur}</duration><voice>{v + 1}</voice><type>{XML_TYPE[n['d']]}</type>{dots}" + (f"<notations>{nots}</notations>" if nots else "") + "</note>")
                        tie_in[v] = False
                        continue
                    # texto, dinámica, regulador, octava y pedal que empiezan en la nota
                    if n.get("txt"):
                        out.append(direction(f'<words font-style="italic">{escape(n["txt"])}</words>', "below", v))
                    if n.get("dyn") in NOTE_DYN:
                        out.append(direction(f'<dynamics><{n["dyn"]}/></dynamics>', "below", v))
                    if n.get("hp"):
                        out.append(direction(f'<wedge type="{"diminuendo" if n["hp"] == ">" else "crescendo"}"/>', "below", v))
                    if n.get("ova") in OTTAVA_XML:
                        ty, size = OTTAVA_XML[n["ova"]]
                        out.append(direction(f'<octave-shift type="{ty}" size="{size}"/>', "below" if ty == "up" else "above", v))
                    if n.get("ped"):
                        out.append(direction('<pedal type="start" line="no"/>', "below", v))
                    stem = f"<stem>{'up' if v == 0 else 'down'}</stem>" if len(st["voices"]) > 1 else ""
                    for g in n.get("grace") or []:
                        for i, k in enumerate(g["keys"]):
                            out.append(f'<note><grace{" slash=\"yes\"" if g.get("slash", True) else ""}/>' + ("<chord/>" if i else "") + f"<pitch><step>{k['s']}</step>" + (f"<alter>{k['a']}</alter>" if k.get("a") else "") + f"<octave>{k['o']}</octave></pitch><voice>{v + 1}</voice><type>eighth</type>{stem}</note>")
                    # notaciones de la nota: ligaduras, grupo, calderón, articulaciones, ornamentos, glissando
                    arts = [f"<{ART_XML[a]}/>" for a in n.get("art") or [] if a in ART_XML]
                    if n.get("brk") == "breath":
                        arts.append("<breath-mark/>")
                    elif n.get("brk") == "caes":
                        arts.append("<caesura/>")
                    orn = ORN_XML.get(n.get("orn") or "", "")
                    if orn.startswith("<articulations>"):
                        arts.append(orn[len("<articulations>"):-len("</articulations>")])
                        orn = ""
                    expr = (tupn + ("<fermata/>" if n.get("ferm") else "") + ('<slur type="start" number="1"/>' if n.get("sls") else "") + ('<slur type="stop" number="1"/>' if n.get("sle") else "")
                            + ('<glissando type="stop" number="1"/>' if gl_in[v] else "") + ('<glissando type="start" number="1" line-type="solid"/>' if n.get("gliss") else "")
                            + (f"<articulations>{''.join(arts)}</articulations>" if arts else "") + orn)
                    gl_in[v] = bool(n.get("gliss"))
                    starts, stops = n.get("tie"), tie_in[v]
                    for i, k in enumerate(n["keys"]):
                        x = "<note>" + ("<chord/>" if i else "")
                        x += f"<pitch><step>{k['s']}</step>" + (f"<alter>{k['a']}</alter>" if k.get("a") else "") + f"<octave>{k['o']}</octave></pitch>"
                        x += f"<duration>{dur}</duration>"
                        if stops:
                            x += '<tie type="stop"/>'
                        if starts:
                            x += '<tie type="start"/>'
                        x += f"<voice>{v + 1}</voice><type>{XML_TYPE[n['d']]}</type>{dots}"
                        x += f"<stem>{'up' if (len(st['voices']) > 1 and v == 0) else 'down' if len(st['voices']) > 1 else 'up' if dia(k) < 30 else 'down'}</stem>"
                        nots = ""
                        if stops:
                            nots += '<tied type="stop"/>'
                        if starts:
                            nots += '<tied type="start"/>'
                        if i == 0:
                            nots += expr
                        if nots:
                            x += f"<notations>{nots}</notations>"
                        if i == 0 and n.get("ly"):
                            for vi, sy in enumerate(n["ly"]):
                                if not sy:
                                    continue
                                prev = hyph[v].get(vi, False)
                                syl = ("middle" if sy["h"] else "end") if prev else ("begin" if sy["h"] else "single")
                                hyph[v][vi] = sy["h"]
                                x += f'<lyric number="{vi + 1}"><syllabic>{syl}</syllabic><text>{escape(sy["t"].replace("_", "‿"))}</text></lyric>'
                        out.append(x + "</note>")
                    tie_in[v] = bool(starts)
                    # lo que termina en la nota
                    if n.get("hpe"):
                        out.append(direction('<wedge type="stop"/>', "below", v))
                    if n.get("ovae"):
                        out.append(direction('<octave-shift type="stop" size="8"/>', "above", v))
                    if n.get("pede"):
                        out.append(direction('<pedal type="stop" line="no"/>', "below", v))
            if s == 0:
                if mk.get("fine"):
                    out.append('<direction placement="below"><direction-type><words>Fine</words></direction-type><sound fine="yes"/></direction>')
                if mk.get("toCoda"):
                    out.append('<direction placement="above"><direction-type><words>To Coda</words></direction-type><sound tocoda="coda"/></direction>')
                if mk.get("jump"):
                    snd = ' dacapo="yes"' if mk["jump"].startswith("DC") else ' dalsegno="segno"'
                    out.append(f'<direction placement="above"><direction-type><words>{JUMPS[mk["jump"]]}</words></direction-type><sound{snd}/></direction>')
            nxt = measures[mi + 1]["marks"] if mi + 1 < len(measures) else {}
            volta_ends = mk.get("volta") and nxt.get("volta") != mk["volta"]
            if mk.get("repEnd") or volta_ends or mi == len(measures) - 1:
                bl = '<barline location="right">'
                if mk.get("repEnd") or mi == len(measures) - 1:
                    bl += "<bar-style>light-heavy</bar-style>"
                if volta_ends:
                    nums = ",".join(map(str, mk["volta"]))
                    bl += f'<ending number="{nums}" type="{"stop" if mk.get("repEnd") else "discontinue"}"/>'
                if mk.get("repEnd"):
                    times = f' times="{mk["repEnd"]}"' if mk["repEnd"] > 2 else ""
                    bl += f'<repeat direction="backward"{times}/>'
                out.append(bl + "</barline>")
            out.append("</measure>")
        out.append("</part>")
    out.append("</score-partwise>")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("paginas", nargs="+")
    ap.add_argument("--nombre", default="")
    ap.add_argument("--salida", default=".")
    ap.add_argument("--revisar", action="store_true")
    a = ap.parse_args()
    pages = [json.load(open(p, encoding="utf-8-sig")) for p in a.paginas]
    ctx = merge(pages)
    sc, measures, rep = build(ctx)
    print(f"Título: {sc['title']} · {sc['composer'] or 'sin autor'} · {len(sc['staves'])} pentagramas · tonalidad {sc['key']:+d} · compás {sc['time']} · ♩={sc['tempo']}")
    print(f"Compases: {rep['compases']}" + (" (con anacrusa)" if rep["anacrusa"] else ""))
    if sc["changes"]:
        print("Cambios: " + ", ".join(f"c.{c['m'] + 1}" + (f" tonalidad {c['key']:+d}" if "key" in c else "") + (f" compás {c['time']}" if "time" in c else "") for c in sc["changes"]))
    if sc["marks"]:
        print("Marcas: " + ", ".join(f"c.{int(m) + 1} " + "/".join(k if v is True else f"{k}={v}" for k, v in o.items()) for m, o in sc["marks"].items()))
    print("Compases que no cuadran: " + (", ".join(map(str, rep["no_cuadran"])) or "ninguno"))
    print("Fichas ilegibles: " + (", ".join(rep["fichas_malas"]) or "ninguna"))
    for w in rep["advertencias"]:
        print("Aviso: " + w)
    if a.revisar:
        return
    nombre = a.nombre or re.sub(r"[^\w\-]+", "-", sc["title"].lower()).strip("-") or "partitura"
    os.makedirs(a.salida, exist_ok=True)
    p1 = os.path.join(a.salida, nombre + ".atril")
    p2 = os.path.join(a.salida, nombre + ".musicxml")
    json.dump(sc, open(p1, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    open(p2, "w", encoding="utf-8").write(to_musicxml(sc, measures))
    print(f"Escrito: {p1}\nEscrito: {p2}")


if __name__ == "__main__":
    main()
