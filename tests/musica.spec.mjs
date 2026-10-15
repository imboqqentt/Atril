import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { openAtril, scoreWithMarks } from "./helpers.mjs";

const keysOf = (page, s, v, n) => page.evaluate(([s, v, n]) => score.staves[s].voices[v].notes.slice(0, n).map((x) => x.rest ? "-" : x.keys.map((k) => k.s + ["b", "", "#"][(k.a || 0) + 1] + k.o).join("+")), [s, v, n]);

test.describe("transponer", () => {
  test("de Sol mayor a Re mayor y de vuelta", async ({ page }) => {
    const { errors } = await openAtril(page);
    expect(await keysOf(page, 0, 0, 4)).toEqual(["B4", "B4", "C5", "D5"]);
    expect(await keysOf(page, 1, 1, 3)).toEqual(["G2", "G2", "D3"]);

    const transpose = async (key, dir) => {
      await page.click("#bFile");
      await page.click('#mFile [data-act="transpose"]');
      await page.selectOption("#tpKey", key);
      await page.selectOption("#tpDir", dir);
      await page.click('#modal [data-x="ok"]');
    };
    // la más cercana de Sol a Re es bajar una cuarta
    await transpose("2", "near");
    expect(await page.evaluate(() => score.key)).toBe(2);
    expect(await keysOf(page, 0, 0, 4)).toEqual(["F#4", "F#4", "G4", "A4"]);
    expect(await keysOf(page, 0, 1, 8)).toEqual(["D4", "D4", "E4", "F#4", "F#4", "E4", "D4", "C#4"]);
    expect(await keysOf(page, 1, 1, 3)).toEqual(["D2", "D2", "A2"]);
    await expect(page.locator("#pKey")).toHaveValue("2");

    // y de vuelta hacia arriba: queda igual que al principio
    await transpose("1", "up");
    expect(await page.evaluate(() => score.key)).toBe(1);
    expect(await keysOf(page, 0, 0, 4)).toEqual(["B4", "B4", "C5", "D5"]);
    expect(await keysOf(page, 1, 1, 3)).toEqual(["G2", "G2", "D3"]);

    // se deshace con Ctrl+Z
    await page.locator("#desk").focus();
    await page.keyboard.press("Control+z");
    expect(await page.evaluate(() => score.key)).toBe(2);
    expect(errors).toEqual([]);
  });

  test("bemoles con la ortografía de la nueva tonalidad", async ({ page }) => {
    await openAtril(page);
    // Sol mayor → Mi bemol mayor (bajar 3ª mayor): el Fa# de la contralto pasa a Re natural, el Si a Sol
    await page.evaluate(() => { const df = -3 - score.key; transposeScore(intervalForKeys(df, "down"), df); });
    expect(await page.evaluate(() => score.key)).toBe(-3);
    expect(await keysOf(page, 0, 0, 4)).toEqual(["G4", "G4", "Ab4", "Bb4"]);
    expect(await keysOf(page, 0, 1, 8)).toEqual(["Eb4", "Eb4", "F4", "G4", "G4", "F4", "Eb4", "D4"]);
  });
});

// Lo que debe sobrevivir a MusicXML: alturas, ritmos, ligaduras, letra, compás, tonalidad, tempo, cambios y marcas.
// (Los nombres de las dos voces de un mismo pentagrama no viajan en MusicXML.)
function comparable(sc) {
  return {
    title: sc.title, composer: sc.composer || "", tempo: sc.tempo, time: sc.time, key: sc.key,
    changes: sc.changes || [], marks: sc.marks || {},
    staves: sc.staves.map((st) => ({ clef: st.clef, voices: st.voices.map((v) => v.notes.map((n) => ({
      d: n.d, dots: n.dots || 0, rest: !!n.rest, tie: !!n.tie,
      keys: n.rest ? null : n.keys.map((k) => [k.s, k.a || 0, k.o]),
      ly: (n.ly || []).map((l) => (l ? [l.t, !!l.h] : null)),
    }))) })),
  };
}
const roundTrip = (page, sc) => page.evaluate((sc) => { load(sc); return fromMusicXML(toMusicXML()); }, sc);

test.describe("MusicXML ida y vuelta", () => {
  test("partitura SATB con letra y cambio de tonalidad", async ({ page }) => {
    await openAtril(page);
    const sc = JSON.parse(await readFile("ejemplos/fui-la-razon.atril", "utf8"));
    expect(comparable(await roundTrip(page, sc))).toEqual(comparable(sc));
  });

  test("repeticiones, casillas, segno, coda, tempo y dinámica", async ({ page }) => {
    await openAtril(page);
    const sc = scoreWithMarks(8, { 0: { repStart: true, segno: true }, 2: { volta: [1], repEnd: 2 }, 3: { volta: [2], toCoda: true, dyn: "f" }, 4: { tempo: 80 }, 5: { jump: "DSalCoda" }, 6: { coda: true } });
    sc.key = -2; sc.changes = [{ m: 6, key: 3 }];
    expect(comparable(await roundTrip(page, sc))).toEqual(comparable(sc));
  });

  test("descargar .mxl desde el menú e importarlo", async ({ page }) => {
    const { errors } = await openAtril(page);
    const before = comparable(await page.evaluate(() => score));
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#bFile").then(() => page.click('#mFile [data-act="mxl"]'))]);
    expect(dl.suggestedFilename()).toMatch(/\.(mxl|zip)$/);
    const buffer = await readFile(await dl.path());
    await page.evaluate(() => { score.title = "otra cosa"; });
    await page.setInputFiles("#fileIn", { name: dl.suggestedFilename(), mimeType: "application/zip", buffer });
    await expect(page.locator("#docname")).toHaveText("Himno a la alegría");
    await expect(page.locator("#savestate")).toHaveText("Sin guardar");
    expect(comparable(await page.evaluate(() => score))).toEqual(before);
    expect(errors).toEqual([]);
  });
});

test.describe("playOrder", () => {
  const order = (page, measures, marks) => page.evaluate((sc) => { load(sc); render(); return playOrder(scoreLen(buildModel())).map((m) => m + 1); }, scoreWithMarks(measures, marks));

  test("repetición simple y ×3", async ({ page }) => {
    await openAtril(page);
    expect(await order(page, 4, { 1: { repStart: true }, 2: { repEnd: 2 } })).toEqual([1, 2, 3, 2, 3, 4]);
    expect(await order(page, 3, { 1: { repEnd: 3 } })).toEqual([1, 2, 1, 2, 1, 2, 3]);
  });

  test("casillas de 1ª y 2ª", async ({ page }) => {
    await openAtril(page);
    expect(await order(page, 6, { 2: { volta: [1], repEnd: 2 }, 3: { volta: [2] } })).toEqual([1, 2, 3, 1, 2, 4, 5, 6]);
  });

  test("D.S. al Coda", async ({ page }) => {
    await openAtril(page);
    expect(await order(page, 8, { 1: { segno: true }, 3: { toCoda: true }, 5: { jump: "DSalCoda" }, 6: { coda: true } })).toEqual([1, 2, 3, 4, 5, 6, 2, 3, 4, 7, 8]);
  });

  test("D.C. al Fine", async ({ page }) => {
    await openAtril(page);
    expect(await order(page, 4, { 1: { fine: true }, 3: { jump: "DCalFine" } })).toEqual([1, 2, 3, 4, 1, 2]);
  });

  test("repetición con casillas y luego D.S. al Coda: al volver se toma la última casilla", async ({ page }) => {
    await openAtril(page);
    expect(await order(page, 8, { 0: { repStart: true, segno: true }, 2: { volta: [1], repEnd: 2 }, 3: { volta: [2], toCoda: true }, 5: { jump: "DSalCoda" }, 6: { coda: true } }))
      .toEqual([1, 2, 3, 1, 2, 4, 5, 6, 1, 2, 4, 7, 8]);
  });
});
