import { test, expect } from "@playwright/test";
import { openAtril } from "./helpers.mjs";

// JSON compacto que entrega la skill skills/leer-partitura (.atril-omr.json)
const omr = {
  title: "Cuán grande es Él", composer: "Himnario", tempo: 72, key: 1, time: "3/4", pickup: false,
  staves: [{ name: "", clef: "treble", voices: ["Soprano", "Contralto"] }, { name: "", clef: "bass", voices: ["Tenor", "Bajo"] }],
  systems: [
    { staves: [
      [["@repStart G4:q/Se-|Cuan- A4:q/ñor B4:q/mi", "D5:h./Dios"], ["D4:q D4:q G4:q", "B4:h."]],
      [["B3:q C4:q D4:q", "G3:h."], ["G2:q G2:q G2:q", "G2:h."]],
    ] },
    { staves: [
      [["@key=-1 @repEnd F4:q~ F4:q E4:q", "@dyn=f F4:h C5:q"], ["@key=-1 C4:h C4:q", "C4:h A4:q"]],
      [["@key=-1 A3:h G3:q", "A3:h F3:q"], ["@key=-1 F2:h. ", "F2:h F3:q"]],
    ] },
  ],
  warnings: ["Sistema 2, compás 1: tresillo aproximado."],
};

test("importar el JSON de lectura (skill leer-partitura)", async ({ page }) => {
  const { errors } = await openAtril(page);
  await page.setInputFiles("#fileIn", { name: "cuan-grande.atril-omr.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(omr)) });
  await expect(page.locator("#modal h3")).toHaveText("Partitura leída");
  await expect(page.locator("#modal .stat")).toContainText("4compases");
  await expect(page.locator("#modal .report")).toContainText("tresillo aproximado");
  await page.click('#modal [data-x="close"]');

  await expect(page.locator("#docname")).toHaveText("Cuán grande es Él");
  await expect(page.locator("#savestate")).toHaveText("Sin guardar");
  const sc = await page.evaluate(() => score);
  expect(sc.key).toBe(1); expect(sc.time).toBe("3/4"); expect(sc.tempo).toBe(72);
  expect(sc.staves.map((s) => [s.clef, s.voices.map((v) => v.name)])).toEqual([["treble", ["Soprano", "Contralto"]], ["bass", ["Tenor", "Bajo"]]]);
  expect(sc.changes).toEqual([{ m: 2, key: -1 }]);
  expect(sc.marks[0].repStart).toBe(true);
  expect(sc.marks[2].repEnd).toBeTruthy();
  expect(sc.marks[3].dyn).toBe("f");
  const sop = sc.staves[0].voices[0].notes;
  expect(sop.slice(0, 4).map((n) => n.keys[0].s + n.keys[0].o + n.d + (n.dots ? "." : ""))).toEqual(["G4q", "A4q", "B4q", "D5h."]);
  expect(sop[0].ly).toEqual([{ t: "Se", h: true }, { t: "Cuan", h: true }]);
  expect(sop[4].tie).toBe(true);
  expect(errors).toEqual([]);
});

test("un .json que no es de Atril avisa", async ({ page }) => {
  await openAtril(page);
  await page.setInputFiles("#fileIn", { name: "otra.json", mimeType: "application/json", buffer: Buffer.from('{"hola":1}') });
  await expect(page.locator("#toast")).toHaveText("Ese archivo no es una partitura de Atril.");
});
