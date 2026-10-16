import { test, expect } from "@playwright/test";
import { openAtril } from "./helpers.mjs";

const one = (notes, extra = {}) => ({ id: "t", title: "Prueba", composer: "", tempo: 60, time: "4/4", key: 0, changes: [], marks: {}, layout: { staff: 6, perSystem: 0 }, groups: [],
  staves: [{ name: "", clef: "treble", voices: [{ name: "", notes }] }], ...extra });
const N = (s, o, d = "q", extra = {}) => ({ d, dots: 0, rest: false, tie: false, keys: [{ s, a: 0, o }], ...extra });

// Partitura con todas las marcas del bloque B
const full = () => one([
  N("C", 5, "q", { art: ["stacc"], sls: true, hp: "<", txt: "dolce" }), N("D", 5, "q", { art: ["ten"] }), N("E", 5, "q", { art: ["acc"], sle: true }), N("F", 5, "q", { art: ["marc"], hpe: true, dyn: "sfz" }),
  N("G", 5, "q", { orn: "tr" }), N("A", 5, "q", { orn: "prall" }), N("G", 5, "q", { orn: "mord", brk: "breath" }), N("F", 5, "q", { orn: "turn", brk: "caes" }),
  N("E", 5, "q", { orn: "fall", hp: ">" }), N("D", 5, "q", { orn: "doit" }), N("C", 5, "q", { orn: "scoop" }), N("B", 4, "q", { orn: "bend", hpe: true, dyn: "fp" }),
  N("C", 5, "h", { gliss: true, art: ["stmo"] }), N("C", 6, "h"),
], { marks: { 1: { reh: "A" } } });

test.describe("dibujo", () => {
  test("todas las marcas se dibujan sin errores", async ({ page }) => {
    const { errors } = await openAtril(page);
    const r = await page.evaluate((sc) => {
      load(sc); render();
      const q = (sel) => document.querySelectorAll("#pages " + sel).length;
      return { hairpin: q(".hairpin"), dyn: q(".notedyn"), txt: q(".notetxt"), gliss: q(".gliss"), reh: q(".rehearsal"), breath: q(".breath"), caes: q(".caesura") };
    }, full());
    expect(r).toEqual({ hairpin: 2, dyn: 2, txt: 1, gliss: 1, reh: 1, breath: 1, caes: 1 });
    expect(errors).toEqual([]);
  });
});

test.describe("escritura", () => {
  const notes = (page) => page.evaluate(() => score.staves[0].voices[0].notes.map((n) => ({ art: n.art || null, sls: !!n.sls, sle: !!n.sle, hp: n.hp || null, hpe: !!n.hpe })));
  const pick = (page, i) => page.evaluate((i) => { cursor = { staff: 0, voice: 0, index: i + 1, tickHint: null }; mode = "select"; decorate(); }, i);

  test("articulaciones, ligadura de expresión y reguladores con el teclado", async ({ page }) => {
    const { errors } = await openAtril(page);
    await page.evaluate((sc) => { load(sc); render(); }, one([N("C", 5), N("D", 5), N("E", 5), N("F", 5)]));
    await page.locator("#desk").focus();
    await pick(page, 0); await page.keyboard.press("Alt+s");
    await pick(page, 1); await page.keyboard.press("Alt+a"); await page.keyboard.press("Alt+m"); // el marcato reemplaza al acento
    let ns = await notes(page);
    expect(ns[0].art).toEqual(["stacc"]); expect(ns[1].art).toEqual(["marc"]);
    // ligadura de la 1.ª a la 3.ª; pulsar sobre un extremo la quita
    await pick(page, 0); await page.keyboard.press("Alt+l");
    await pick(page, 2); await page.keyboard.press("Alt+l");
    ns = await notes(page); expect([ns[0].sls, ns[2].sle]).toEqual([true, true]);
    await pick(page, 2); await page.keyboard.press("Alt+l");
    ns = await notes(page); expect([ns[0].sls, ns[2].sle]).toEqual([false, false]);
    // crescendo de la 2.ª a la 4.ª, y luego se cambia a decrescendo
    await pick(page, 1); await page.keyboard.press("Alt+r");
    await pick(page, 3); await page.keyboard.press("Alt+r");
    ns = await notes(page); expect([ns[1].hp, ns[3].hpe]).toEqual(["<", true]);
    await pick(page, 1); await page.keyboard.press("Alt+Shift+r");
    ns = await notes(page); expect([ns[1].hp, ns[3].hpe]).toEqual([">", true]);
    // el staccato se quita con la misma tecla
    await pick(page, 0); await page.keyboard.press("Alt+s");
    expect((await notes(page))[0].art).toBeNull();
    expect(errors).toEqual([]);
  });

  test("menú Más…: trino, dinámica y quitar todo", async ({ page }) => {
    const { errors } = await openAtril(page);
    await page.evaluate((sc) => { load(sc); render(); cursor = { staff: 0, voice: 0, index: 1, tickHint: null }; mode = "select"; decorate(); }, one([N("C", 5), N("D", 5), N("E", 5), N("F", 5)]));
    await page.selectOption("#tMore", "tr");
    expect(await page.evaluate(() => score.staves[0].voices[0].notes[0].orn)).toBe("tr");
    await page.selectOption("#tMore", "dyn");
    await page.click('#modal [data-dyn="sfz"]');
    expect(await page.evaluate(() => score.staves[0].voices[0].notes[0].dyn)).toBe("sfz");
    await page.selectOption("#tMore", "clear");
    expect(await page.evaluate(() => { const n = score.staves[0].voices[0].notes[0]; return [n.orn, n.dyn]; })).toEqual([undefined, undefined]);
    expect(errors).toEqual([]);
  });
});

test.describe("sonido", () => {
  const evs = (page, sc) => page.evaluate((sc) => {
    load(sc); const P = performance();
    return P.events.map((e) => ({ k: e.keys[0].s + ["b", "", "#"][(e.keys[0].a || 0) + 1] + e.keys[0].o, t: +P.timeOf(e.start).toFixed(3), d: +(P.timeOf(e.start + e.dur) - P.timeOf(e.start)).toFixed(3), vel: +(e.vel || 1).toFixed(3), len: e.len, dyn: e.dyn }));
  }, sc);

  test("staccato acorta, acento y sfz suben el volumen, tenuto liga", async ({ page }) => {
    await openAtril(page);
    const r = await evs(page, one([N("C", 5, "q", { art: ["stacc"] }), N("D", 5, "q", { art: ["acc"] }), N("E", 5, "q", { dyn: "sfz" }), N("F", 5, "q", { art: ["ten"] })]));
    expect(r.map((e) => [e.len, e.vel])).toEqual([[0.5, 1], [0.97, 1.3], [0.97, 1.55], [1, 1.08]]);
  });

  test("crescendo sube de a poco y se mantiene hasta la siguiente dinámica", async ({ page }) => {
    await openAtril(page);
    const r = await evs(page, one([N("C", 5, "q", { hp: "<" }), N("C", 5), N("C", 5), N("C", 5, "q", { hpe: true }), N("C", 5), N("C", 5, "q", { dyn: "p" }), N("C", 5, "h")]));
    const v = r.map((e) => e.vel);
    [1, 1.1125, 1.225, 1.3375].forEach((x, i) => expect(v[i]).toBeCloseTo(x, 2));
    expect(v[4]).toBeCloseTo(1.45, 3); // después del regulador, hasta la próxima dinámica
    expect([v[5], r[5].dyn]).toEqual([1, "p"]);
  });

  test("ornamentos y glissando reparten la nota en varias alturas", async ({ page }) => {
    await openAtril(page);
    const keys = async (n, extra = []) => (await evs(page, one([n, ...extra, N("C", 5, "w")]))).filter((e) => e.t < 1).map((e) => e.k);
    expect(await keys(N("C", 5, "q", { orn: "prall" }))).toEqual(["C5", "D5", "C5"]);
    expect(await keys(N("C", 5, "q", { orn: "mord" }))).toEqual(["C5", "B4", "C5"]);
    expect(await keys(N("C", 5, "q", { orn: "turn" }))).toEqual(["D5", "C5", "B4", "C5"]);
    expect(await keys(N("C", 5, "q", { orn: "fall" }))).toEqual(["C5", "B4", "A#4", "A4"]);
    expect(await keys(N("C", 5, "q", { orn: "doit" }))).toEqual(["C5", "C#5", "D5", "D#5"]);
    const tr = await keys(N("C", 5, "q", { orn: "tr" }));
    expect(tr.length).toBeGreaterThan(6); expect(tr.slice(0, 4)).toEqual(["C5", "D5", "C5", "D5"]); expect(tr[tr.length - 1]).toBe("C5");
    const gl = await keys(N("C", 5, "q", { gliss: true }), [N("G", 5, "q")]);
    expect(gl[0]).toBe("C5"); expect(gl.length).toBe(1 + 6);
  });

  test("la cesura detiene la música un momento", async ({ page }) => {
    await openAtril(page);
    const r = await evs(page, one([N("C", 5, "q", { brk: "caes" }), N("D", 5, "q", { brk: "breath" }), N("E", 5, "h")]));
    expect(r.map((e) => e.t)).toEqual([0, 1.45, 2.45]);
    expect(r[1].len).toBe(0.8);
  });
});

test.describe("MusicXML", () => {
  const FIELDS = ["art", "orn", "brk", "gliss", "sls", "sle", "hp", "hpe", "dyn", "txt"];
  const comparable = (sc) => ({ reh: (sc.marks || {})[1] && sc.marks[1].reh, notes: sc.staves[0].voices[0].notes.map((n) => Object.fromEntries(FIELDS.map((f) => [f, n[f] === undefined ? null : n[f]]))) });
  test("todas las marcas de expresión ida y vuelta", async ({ page }) => {
    const { errors } = await openAtril(page);
    const sc = full();
    const back = await page.evaluate((sc) => { load(sc); return fromMusicXML(toMusicXML()); }, sc);
    expect(comparable(back)).toEqual(comparable(sc));
    expect(back.marks[0] && back.marks[0].dyn).toBeUndefined(); // las dinámicas de nota no se vuelven dinámicas de compás
    expect(errors).toEqual([]);
  });
});
