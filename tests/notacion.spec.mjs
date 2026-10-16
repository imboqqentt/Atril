import { test, expect } from "@playwright/test";
import { openAtril } from "./helpers.mjs";

// Partitura de una voz con las notas dadas en el formato del .atril.
const one = (notes, extra = {}) => ({ id: "t", title: "Prueba", composer: "", tempo: 60, time: "4/4", key: 0, changes: [], marks: {}, layout: { staff: 6, perSystem: 0 }, groups: [],
  staves: [{ name: "", clef: "treble", voices: [{ name: "", notes }] }], ...extra });
const N = (d, extra = {}) => ({ d, dots: 0, rest: false, tie: false, keys: [{ s: "C", a: 0, o: 5 }], ...extra });
const tri = (d, u = d) => N(d, { tup: { n: 3, of: 2, u } });

// Duración de cada compás según el modelo (en negras) y cuántos compases hay.
const measures = (page, sc) => page.evaluate((sc) => {
  load(sc); render();
  const model = buildModel();
  return model.per[0][0].meas.map((m) => m.pieces.reduce((a, p) => a + p.ticks, 0) / TQ);
}, sc);

test.describe("ritmo", () => {
  test("tresillos de corchea y de negra llenan el compás exacto", async ({ page }) => {
    const { errors } = await openAtril(page);
    // 3 corcheas de tresillo + 3 negras de tresillo + negra = 1 + 2 + 1 = 4 negras
    const sc = one([tri("8"), tri("8"), tri("8"), tri("q"), tri("q"), tri("q"), N("q"), N("w")]);
    expect(await measures(page, sc)).toEqual([4, 4]);
    expect(await page.evaluate(() => tupletGroups(score.staves[0].voices[0].notes).map((g) => g.idx.length))).toEqual([3, 3]);
    expect(errors).toEqual([]);
  });

  test("negra y corchea dentro de un tresillo de corcheas", async ({ page }) => {
    await openAtril(page);
    const sc = one([tri("q", "8"), tri("8", "8"), N("q"), N("h")]);
    expect(await measures(page, sc)).toEqual([4]);
    expect(await page.evaluate(() => tupletGroups(score.staves[0].voices[0].notes).map((g) => g.idx))).toEqual([[0, 1]]);
  });

  test("cinquillo, seisillo y septillo", async ({ page }) => {
    await openAtril(page);
    const g = (n, of, d, k) => Array.from({ length: k }, () => N(d, { tup: { n, of, u: d } }));
    // 5 semicorcheas en el lugar de 4 (1 negra) · 6 en el lugar de 4 (1 negra) · 7 en el lugar de 4 (1 negra) · negra
    const sc = one([...g(5, 4, "16", 5), ...g(6, 4, "16", 6), ...g(7, 4, "16", 7), N("q")]);
    expect(await measures(page, sc)).toEqual([4]);
  });

  test("doble puntillo y fusas", async ({ page }) => {
    await openAtril(page);
    // negra con doble puntillo + semicorchea = blanca; 8 fusas = negra; negra
    const sc = one([N("q", { dots: 2 }), N("16"), ...Array.from({ length: 8 }, () => N("32")), N("q")]);
    expect(await measures(page, sc)).toEqual([4]);
  });

  test("escribir un tresillo con el teclado", async ({ page }) => {
    const { errors } = await openAtril(page);
    await page.evaluate(() => { load({ id: "t", title: "", composer: "", tempo: 90, time: "4/4", key: 0, changes: [], marks: {}, layout: { staff: 6, perSystem: 0 }, groups: [], staves: [{ name: "", clef: "treble", voices: [{ name: "", notes: [] }] }] }); render(); });
    await page.locator("#desk").focus();
    await page.keyboard.press("4");          // corchea
    await page.keyboard.press("Alt+3");      // tresillo
    for (const k of ["c", "d", "e", "f"]) await page.keyboard.press(k); // el 4.º empieza otro tresillo
    await page.keyboard.press("Alt+3");      // vuelve a normal
    await page.keyboard.press("g");
    const ns = await page.evaluate(() => score.staves[0].voices[0].notes.map((n) => (n.tup ? n.tup.n + ":" + n.tup.of + n.tup.u : "-")));
    expect(ns).toEqual(["3:28", "3:28", "3:28", "3:28", "-"]);
    expect(await page.evaluate(() => tupletGroups(score.staves[0].voices[0].notes).map((g) => g.idx.length))).toEqual([3, 1]);
    expect(errors).toEqual([]);
  });

  test("el puntillo pasa a doble y vuelve", async ({ page }) => {
    await openAtril(page);
    await page.locator("#desk").focus();
    await page.keyboard.press(".");
    expect(await page.evaluate(() => inputDots)).toBe(1);
    await page.keyboard.press(".");
    expect(await page.evaluate(() => inputDots)).toBe(2);
    await page.keyboard.press(".");
    expect(await page.evaluate(() => inputDots)).toBe(0);
  });
});

test.describe("interpretación", () => {
  test("swing: la segunda corchea del par entra a los 2/3 del pulso", async ({ page }) => {
    await openAtril(page);
    const t = await page.evaluate((sc) => {
      load(sc); const P = performance();
      return P.events.map((e) => +P.timeOf(e.start).toFixed(3));
    }, one([N("8"), N("8"), N("8"), N("8"), N("h")], { marks: { 0: { swing: "8" } } }));
    // ♩ = 60: pulso de 1 s; corcheas en 0, 0.667, 1, 1.667; la blanca en 2
    expect(t).toEqual([0, 0.667, 1, 1.667, 2]);
  });

  test("swing de semicorcheas y vuelta a recto", async ({ page }) => {
    await openAtril(page);
    const t = await page.evaluate((sc) => {
      load(sc); const P = performance();
      return P.events.map((e) => +P.timeOf(e.start).toFixed(3));
    }, one([N("16"), N("16"), N("8"), N("h", { dots: 1 }), N("8"), N("8"), N("h", { dots: 1 }), N("8"), N("8"), N("h", { dots: 1 })], { marks: { 0: { swing: "16" }, 1: { swing: "8" }, 2: { swing: "no" } } }));
    // c.1 swing de semicorcheas (pares de 0,5 s): 0, 0.333, luego la corchea en 0.5 · c.2 swing de corcheas · c.3 recto
    expect(t).toEqual([0, 0.333, 0.5, 1, 4, 4.667, 5, 8, 8.5, 9]);
  });

  test("calderón: la música se detiene y luego sigue", async ({ page }) => {
    await openAtril(page);
    const r = await page.evaluate((sc) => {
      load(sc); const P = performance();
      return { starts: P.events.map((e) => +P.timeOf(e.start).toFixed(3)), endFerm: +P.timeOf(P.events[1].start + P.events[1].dur).toFixed(3), total: +P.totalSec.toFixed(3) };
    }, one([N("q"), N("q", { ferm: true }), N("h")]));
    // la segunda negra (1 s) se sostiene 1 s más; la blanca entra en 3 en vez de 2
    expect(r.starts).toEqual([0, 1, 3]);
    expect(r.endFerm).toBe(3);
    expect(r.total).toBe(5);
  });
});

test.describe("adornos", () => {
  const G = (s, o, slash = true) => ({ keys: [{ s, a: 0, o }], d: "8", slash });
  test("se dibujan, suenan antes de la nota y la nota principal sigue en su lugar", async ({ page }) => {
    const { errors } = await openAtril(page);
    const r = await page.evaluate((sc) => {
      load(sc); render(); const P = performance();
      return P.events.map((e) => [e.keys[0].s, +P.timeOf(e.start).toFixed(3), !!e.grace]);
    }, one([N("q", { grace: [G("D", 5), G("E", 5, false)] }), N("q"), N("h")]));
    // ♩ = 60: dos adornos de una fusa (0,125 s) al inicio; la negra suena desde 0,25 y la siguiente en 1
    expect(r).toEqual([["D", 0, true], ["E", 0.125, true], ["C", 0.25, false], ["C", 1, false], ["C", 2, false]]);
    expect(errors).toEqual([]);
  });

  test("escribir adornos con Alt+G y borrar el último", async ({ page }) => {
    const { errors } = await openAtril(page);
    await page.evaluate((sc) => { load(sc); render(); cursor = { staff: 0, voice: 0, index: 2, tickHint: null }; mode = "select"; decorate(); }, one([N("q"), N("q"), N("h")]));
    await page.locator("#desk").focus();
    await page.keyboard.press("Alt+g");
    await page.keyboard.press("d");
    await page.keyboard.press("b");
    expect(await page.evaluate(() => score.staves[0].voices[0].notes[1].grace.map((g) => g.keys[0].s + g.keys[0].o + (g.slash ? "/" : "")))).toEqual(["D5/", "B4/"]);
    await page.keyboard.press("Backspace");
    expect(await page.evaluate(() => score.staves[0].voices[0].notes[1].grace.length)).toBe(1);
    await page.keyboard.press("Escape");
    await page.keyboard.press("e"); // fuera del modo adorno vuelve a escribir notas
    expect(await page.evaluate(() => score.staves[0].voices[0].notes.length)).toBe(4);
    expect(errors).toEqual([]);
  });

  test("se transponen con la partitura", async ({ page }) => {
    await openAtril(page);
    const g = await page.evaluate((sc) => { load(sc); const df = 2 - score.key; transposeScore(intervalForKeys(df, "up"), df); return score.staves[0].voices[0].notes[0].grace[0].keys[0]; }, one([N("q", { grace: [G("E", 5)] }), N("q"), N("h")]));
    expect(g).toEqual({ s: "F", a: 1, o: 5 });
  });
});

test.describe("anacrusa", () => {
  test("el primer compás dura lo que dice la anacrusa y la numeración parte después", async ({ page }) => {
    const { errors } = await openAtril(page);
    const sc = one([N("q"), N("q"), N("q"), N("q"), N("q"), N("w")], { pickup: 1 });
    expect(await measures(page, sc)).toEqual([1, 4, 4]);
    const r = await page.evaluate(() => { const P = performance(); return { starts: P.events.map((e) => +P.timeOf(e.start).toFixed(3)), bars: [0, 1, 2].map(barNum) }; });
    expect(r.starts).toEqual([0, 1, 2, 3, 4, 5]);
    expect(r.bars).toEqual([0, 1, 2]);
    expect(errors).toEqual([]);
  });

  test("se elige en el panel de compás", async ({ page }) => {
    const { errors } = await openAtril(page);
    await page.evaluate(() => { cursor = { staff: 0, voice: 0, index: 1, tickHint: null }; decorate(); });
    await page.selectOption("#pPickup", "0.5");
    expect(await page.evaluate(() => [score.pickup, meterTable().len(0) / TQ])).toEqual([0.5, 0.5]);
    await expect(page.locator("#pMeterAt")).toHaveText("anacrusa (inicio)");
    await page.selectOption("#pPickup", "");
    expect(await page.evaluate(() => score.pickup)).toBeUndefined();
    expect(errors).toEqual([]);
  });

  test("la lectura de la skill deja la anacrusa como compás incompleto", async ({ page }) => {
    await openAtril(page);
    const r = await page.evaluate(() => {
      const res = { title: "x", key: 0, time: "3/4", pickup: true, staves: [{ name: "", clef: "treble", voices: ["S", "A"] }],
        systems: [{ staves: [[["G4:q", "C5:h E5:q", "D5:h."], ["", "E4:h G4:q", "F4:h."]]] }] };
      const ctx = { staves: null, key: 0, time: "4/4", tempo: null, title: "", composer: "", pickup: false, systems: [], warnings: [], wholePages: [] };
      mergeOmr(ctx, res, true);
      const { score: sc, report } = buildFromOmr(ctx);
      return { pickup: sc.pickup, report: report.pickup, alto: sc.staves[0].voices[1].notes.slice(0, 1).map((n) => n.rest + n.d) };
    });
    expect(r).toEqual({ pickup: 1, report: true, alto: ["trueq"] });
  });
});

test.describe("MusicXML", () => {
  const comparable = (sc) => ({ marks: sc.marks || {}, notes: sc.staves[0].voices[0].notes.map((n) => [n.d, n.dots || 0, !!n.rest, n.tup ? [n.tup.n, n.tup.of, n.tup.u] : null, !!n.ferm]) });
  test("tresillos, cinquillo, doble puntillo, fusas, calderón y swing ida y vuelta", async ({ page }) => {
    const { errors } = await openAtril(page);
    const sc = one([
      tri("8"), tri("8"), { ...tri("8"), rest: true, keys: [] }, tri("q", "8"), tri("8"), N("h", { ferm: true }),
      // c.2: cinquillo (1 negra) + negra con doble puntillo y semicorchea (2) + 8 fusas (1)
      ...Array.from({ length: 5 }, () => N("16", { tup: { n: 5, of: 4, u: "16" } })), N("q", { dots: 2 }), N("16"), ...Array.from({ length: 8 }, () => N("32")),
    ], { marks: { 0: { swing: "8" }, 1: { swing: "no" } } });
    const back = await page.evaluate((sc) => { load(sc); return fromMusicXML(toMusicXML()); }, sc);
    expect(comparable(back)).toEqual(comparable(sc));
    expect(errors).toEqual([]);
  });

  test("adornos y anacrusa ida y vuelta", async ({ page }) => {
    await openAtril(page);
    const grace = [{ keys: [{ s: "D", a: 0, o: 5 }], d: "8", slash: true }, { keys: [{ s: "F", a: 1, o: 5 }], d: "16", slash: false }];
    const sc = one([N("q", { grace }), N("q"), N("q"), N("q"), N("q"), N("w")], { pickup: 1 });
    const back = await page.evaluate((sc) => { load(sc); return fromMusicXML(toMusicXML()); }, sc);
    expect(back.pickup).toBe(1);
    expect(back.staves[0].voices[0].notes.length).toBe(6);
    expect(back.staves[0].voices[0].notes[0].grace).toEqual(grace);
  });
});
