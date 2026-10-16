import { test, expect } from "@playwright/test";
import { openAtril } from "./helpers.mjs";

const one = (notes, extra = {}) => ({ id: "t", title: "Prueba", composer: "", tempo: 90, time: "4/4", key: 0, changes: [], marks: {}, layout: { staff: 6, perSystem: 0 }, groups: [],
  staves: [{ name: "", clef: "treble", voices: [{ name: "", notes }] }], ...extra });
const N = (keys, d = "q") => ({ d, dots: 0, rest: false, tie: false, keys: keys.map(([s, o, a = 0]) => ({ s, a, o })) });
// C mayor (c.1), G7 (c.2), Am (c.3)
const triads = () => one([N([["C", 4], ["E", 4], ["G", 4]], "w"), N([["G", 4], ["B", 4], ["D", 5], ["F", 5]], "w"), N([["A", 4], ["C", 5], ["E", 5]], "w")], { layout: { staff: 6, perSystem: 3 } });
const shown = (page) => page.evaluate(() => [...document.querySelectorAll("#pages .chordsym")].map((e) => e.textContent + (e.classList.contains("auto") ? "*" : "")));

test.describe("leer el cifrado", () => {
  test("inglés, latino, sinónimos y bajos", async ({ page }) => {
    await openAtril(page);
    const r = await page.evaluate(() => ["C", "Cm7", "F#m7b5", "Bb/D", "G7(b9)", "Do7", "Sib/Re", "Lam(add9)", "Ebmaj7", "CΔ7", "C-7", "Cø", "Bbdim7", "E7#9", "Dsus", "A13", "F6/9", "N.C.", "(A7)", "Xm7", "C7zz"]
      .map((t) => { const c = parseChord(t); return c ? chordText(c, "en") : null; }));
    expect(r).toEqual(["C", "Cm7", "F♯m7(♭5)", "B♭/D", "G7(♭9)", "C7", "B♭/D", "Am(add9)", "E♭maj7", "Cmaj7", "Cm7", "Cm7(♭5)", "B♭°7", "E7(♯9)", "Dsus4", "A13", "F6/9", "N.C.", "(A7)", null, null]);
    expect(await page.evaluate(() => chordText(parseChord("Sib7/Re"), "es"))).toBe("Si♭7/Re");
  });
});

test.describe("escribir, mover y fijar", () => {
  test("escribir un acorde en la nota elegida con Alt+K", async ({ page }) => {
    const { errors } = await openAtril(page);
    await page.evaluate((sc) => { load(sc); render(); cursor = { staff: 0, voice: 0, index: 2, tickHint: null }; mode = "select"; decorate(); }, triads());
    await page.locator("#desk").focus();
    await page.keyboard.press("Alt+k");
    await expect(page.locator("#chIn")).toHaveValue("G7"); // sugiere el detectado
    await page.fill("#chIn", "Rem7/Fa");
    await page.click('#modal [data-x="ok"]');
    expect(await page.evaluate(() => score.chords)).toEqual([{ m: 1, at: 0, root: { s: "D", a: 0 }, q: "m7", bass: { s: "F", a: 0 } }]);
    expect(await page.evaluate(() => chordMode)).toBe("en"); // se muestran solos
    expect(await shown(page)).toEqual(["C*", "Dm7/F", "Am*"]);
    expect(errors).toEqual([]);
  });

  test("un texto que no es acorde avisa; se puede usar como texto", async ({ page }) => {
    await openAtril(page);
    await page.evaluate((sc) => { load(sc); render(); cursor = { staff: 0, voice: 0, index: 1, tickHint: null }; mode = "select"; decorate(); }, triads());
    await page.evaluate(() => addChordAtCursor());
    await page.fill("#chIn", "Hola");
    await page.click('#modal [data-x="ok"]');
    await expect(page.locator("#chErr")).toBeVisible();
    await page.click('#modal [data-x="raw"]');
    expect(await page.evaluate(() => score.chords)).toEqual([{ m: 0, at: 0, text: "Hola" }]);
  });

  test("mover con las flechas (pulso y medio pulso, cruzando la barra) y borrar", async ({ page }) => {
    const { errors } = await openAtril(page);
    await page.evaluate((sc) => { load(sc); chordMode = "en"; render(); chordSel = { m: 0, at: 2 }; paintChordSel(); }, { ...triads(), chords: [{ m: 0, at: 2, root: { s: "F", a: 0 }, q: "" }] });
    await page.locator("#desk").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Alt+ArrowRight");
    expect(await page.evaluate(() => score.chords.map((c) => [c.m, c.at]))).toEqual([[0, 3.5]]);
    await page.keyboard.press("ArrowRight");
    expect(await page.evaluate(() => score.chords.map((c) => [c.m, c.at]))).toEqual([[1, 0.5]]);
    await page.keyboard.press("Delete");
    expect(await page.evaluate(() => score.chords)).toBeUndefined();
    expect(errors).toEqual([]);
  });

  test("arrastrar un acorde a otro pulso", async ({ page }) => {
    const { errors } = await openAtril(page);
    await page.evaluate((sc) => { load(sc); chordMode = "en"; render(); }, { ...triads(), chords: [{ m: 0, at: 0, root: { s: "C", a: 0 }, q: "" }] });
    const el = page.locator("#pages .chordsym.own").first();
    const box = await el.boundingBox();
    const r = await page.evaluate(() => { const r = layout.rects.find((r) => r.staff === 0 && r.m === 0); const svg = layout.pages[0].svg, m = svg.getScreenCTM(); return { x: r.nx * m.a + m.e, w: (r.x + r.w - 14 - r.nx) * m.a }; });
    await page.mouse.move(box.x + 3, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(r.x + r.w * 0.5 + 2, box.y + box.height / 2, { steps: 6 }); // mitad del compás = tiempo 3
    await page.mouse.up();
    expect(await page.evaluate(() => score.chords.map((c) => [c.m, c.at]))).toEqual([[0, 2]]);
    expect(errors).toEqual([]);
  });

  test("fijar los detectados, y que la detección complete en gris", async ({ page }) => {
    await openAtril(page);
    await page.evaluate((sc) => { load(sc); chordMode = "en"; render(); }, triads());
    expect(await shown(page)).toEqual(["C*", "G7*", "Am*"]); // todos detectados (en negro: no hay escritos)
    await page.click("#bChordFix");
    expect(await page.evaluate(() => score.chords.map((c) => chordText(c, "en")))).toEqual(["C", "G7", "Am"]);
    expect(await shown(page)).toEqual(["C", "G7", "Am"]);
    await page.evaluate(() => { chordSel = { m: 1, at: 0 }; deleteChord(); });
    expect(await shown(page)).toEqual(["C", "G7*", "Am"]);
    await page.click("#pChordAuto");
    expect(await shown(page)).toEqual(["C", "Am"]);
  });

  test("se transponen con la partitura", async ({ page }) => {
    await openAtril(page);
    const r = await page.evaluate((sc) => { load(sc); const df = 2 - score.key; transposeScore(intervalForKeys(df, "up"), df); return score.chords.map((c) => chordText(c, "en")); },
      { ...triads(), chords: [{ m: 0, at: 0, root: { s: "C", a: 0 }, q: "maj7", bass: { s: "E", a: 0 } }, { m: 1, at: 0, root: { s: "B", a: -1 }, q: "7" }, { m: 2, at: 0, text: "N.C." }] });
    expect(r).toEqual(["Dmaj7/F♯", "C7", "N.C."]);
  });

  test("MusicXML ida y vuelta (con anacrusa y acorde a mitad de compás)", async ({ page }) => {
    const { errors } = await openAtril(page);
    const chords = [{ m: 0, at: 0, root: { s: "C", a: 0 }, q: "" }, { m: 1, at: 1.5, root: { s: "F", a: 1 }, q: "m7(♭5)", bass: { s: "C", a: 0 } }, { m: 2, at: 0, text: "N.C." }, { m: 2, at: 2, root: { s: "G", a: 0 }, q: "7(♭9,♯11)" }];
    const back = await page.evaluate((sc) => { load(sc); return fromMusicXML(toMusicXML()).chords; }, { ...triads(), chords });
    expect(back).toEqual(chords);
    expect(errors).toEqual([]);
  });
});
