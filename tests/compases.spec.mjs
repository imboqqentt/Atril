import { test, expect } from "@playwright/test";
import { openAtril } from "./helpers.mjs";

const one = (notes, extra = {}) => ({ id: "t", title: "Prueba", composer: "", tempo: 60, time: "4/4", key: 0, changes: [], marks: {}, layout: { staff: 6, perSystem: 0 }, groups: [],
  staves: [{ name: "", clef: "treble", voices: [{ name: "", notes }] }], ...extra });
const N = (s, o, d = "q", extra = {}) => ({ d, dots: 0, rest: false, tie: false, keys: [{ s, a: 0, o }], ...extra });
const R = (d) => ({ d, dots: 0, rest: true, tie: false, keys: [] });
const bar = () => [N("C", 5), N("E", 5, "8"), N("D", 5, "8"), N("G", 4, "h")];

test.describe("compás de repetición (%)", () => {
  test("la tecla % copia el compás anterior y lo muestra con el signo", async ({ page }) => {
    const { errors } = await openAtril(page);
    await page.evaluate((sc) => { load(sc); render(); cursor = { staff: 0, voice: 0, index: score.staves[0].voices[0].notes.length, tickHint: null }; mode = "input"; decorate(); }, one(bar()));
    await page.locator("#desk").focus();
    await page.keyboard.press("%");
    const r = await page.evaluate(() => ({ n: score.staves[0].voices[0].notes.length, rpt: score.marks[1], signs: document.querySelectorAll("#pages .mrepeat").length, starts: (() => { const P = performance(); return P.events.map((e) => +P.timeOf(e.start).toFixed(2)); })() }));
    expect(r).toEqual({ n: 8, rpt: { rpt: true }, signs: 1, starts: [0, 1, 1.5, 2, 4, 5, 5.5, 6] }); // suena dos veces
    // si se cambia una nota del compás repetido, vuelve a verse con sus notas
    await page.evaluate(() => { score.staves[0].voices[0].notes[5].keys[0].s = "F"; render(); });
    expect(await page.evaluate(() => document.querySelectorAll("#pages .mrepeat").length)).toBe(0);
    expect(errors).toEqual([]);
  });

  test("no repite si el compás ya tiene notas", async ({ page }) => {
    await openAtril(page);
    const n = await page.evaluate((sc) => { load(sc); render(); repeatPrevMeasure(1); return score.staves[0].voices[0].notes.length; }, one([...bar(), ...bar()]));
    expect(n).toBe(8);
    await expect(page.locator("#toast")).toContainText("tiene que estar vacío");
  });
});

test.describe("silencios agrupados", () => {
  test("cinco compases vacíos seguidos ocupan un solo lugar", async ({ page }) => {
    const { errors } = await openAtril(page);
    const notes = [...bar(), ...Array.from({ length: 5 }, () => R("w")), ...bar()];
    const r = await page.evaluate((sc) => {
      load(sc); render();
      const without = layout.systems.reduce((a, s) => a + s.ms.length, 0);
      score.layout.mmRest = true; render();
      return { without, with: layout.systems.reduce((a, s) => a + s.ms.length, 0), spans: layout.systems.map((s) => s.spans), playSec: +performance().totalSec.toFixed(2) };
    }, one(notes));
    expect(r.without - r.with).toBe(4);
    expect(r.spans[0]).toEqual({ 1: 5 });
    expect(r.playSec).toBe(28); // la música no cambia: 7 compases de 4 s
    expect(errors).toEqual([]);
  });
});

test.describe("barras de ritmo", () => {
  test("se dibujan sin errores y el compás sigue sonando igual", async ({ page }) => {
    const { errors } = await openAtril(page);
    const n = await page.evaluate((sc) => { load(sc); render(); return performance().events.length; }, one([...bar(), ...bar()], { marks: { 1: { slash: true } } }));
    expect(n).toBe(8);
    expect(errors).toEqual([]);
  });
});

test("MusicXML: %, barras de ritmo y silencios agrupados ida y vuelta", async ({ page }) => {
  const { errors } = await openAtril(page);
  const back = await page.evaluate((sc) => { load(sc); render(); return fromMusicXML(toMusicXML()); },
    one([...bar(), ...bar(), R("w"), R("w"), R("w"), ...bar()], { marks: { 1: { rpt: true }, 5: { slash: true } }, layout: { staff: 6, perSystem: 0, mmRest: true } }));
  expect(back.marks).toEqual({ 1: { rpt: true }, 5: { slash: true } });
  expect(back.layout.mmRest).toBe(true);
  expect(errors).toEqual([]);
});
