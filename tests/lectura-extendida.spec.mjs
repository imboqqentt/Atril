import { test, expect } from "@playwright/test";
import { openAtril } from "./helpers.mjs";

// Lectura de la skill (formato compacto) con las fichas nuevas: grupos irregulares, adornos, marcas, acordes y transpositores.
const build = (page, res) => page.evaluate((res) => {
  const ctx = { staves: null, key: 0, time: "4/4", tempo: null, title: "", composer: "", pickup: false, systems: [], warnings: [], wholePages: [] };
  mergeOmr(ctx, res, true);
  const { score: sc, report } = buildFromOmr(ctx);
  return { sc, report };
}, res);

test("fichas extendidas: tresillos, fusas, doble puntillo, adornos, marcas y acordes", async ({ page }) => {
  const { errors } = await openAtril(page);
  const { sc, report } = await build(page, { title: "x", key: 0, time: "4/4", staves: [{ name: "", clef: "treble", voices: [""] }],
    systems: [{ staves: [[[
      "@swing=8 @reh=A [Cmaj7] E5:8*3^st^( D5:8*3 C5:8*3^) D5:g E5:q^ac^fe [Am7] C5:q..^sfz^< D5:32 E5:32^!",
      "@slash [Dm7] F5:q^tr^8va G5:q^8e^t=dolce A5:q^ped^br B5:q^pe^gl",
    ]]] }] });
  expect(report.badTokens).toBe(0);
  expect(report.uneven).toEqual([]);
  const n = sc.staves[0].voices[0].notes;
  expect(n.map((x) => [x.d, x.dots, x.tup ? x.tup.n : 0])).toEqual([["8", 0, 3], ["8", 0, 3], ["8", 0, 3], ["q", 0, 0], ["q", 2, 0], ["32", 0, 0], ["32", 0, 0], ["q", 0, 0], ["q", 0, 0], ["q", 0, 0], ["q", 0, 0]]);
  expect([n[0].art, n[0].sls, n[2].sle, n[3].grace, n[3].art, n[3].ferm]).toEqual([["stacc"], true, true, [{ keys: [{ s: "D", a: 0, o: 5 }], d: "8", slash: true }], ["acc"], true]);
  expect([n[4].dyn, n[4].hp, n[6].hpe, n[7].orn, n[7].ova, n[8].ovae, n[8].txt, n[9].ped, n[9].brk, n[10].pede, n[10].gliss]).toEqual(["sfz", "<", true, "tr", "8va", true, "dolce", true, "breath", true, true]);
  expect(sc.marks).toEqual({ 0: { swing: "8", reh: "A" }, 1: { slash: true } });
  expect(sc.chords.map((c) => [c.m, c.at, c.root.s + c.q])).toEqual([[0, 0, "Cmaj7"], [0, 2, "Am7"], [1, 0, "Dm7"]]);
  // la partitura leída se dibuja sin errores
  await page.evaluate((sc) => { load(sc); render(); }, sc);
  expect(errors).toEqual([]);
});

test("pentagrama transpositor: la armadura leída es la escrita y se guarda la real", async ({ page }) => {
  await openAtril(page);
  const { sc } = await build(page, { key: 2, time: "4/4", staves: [{ name: "Trompeta", clef: "treble", voices: [""], trans: "bb" }],
    systems: [{ staves: [[["D5:h E5:h", "@key=3 E5:w"]]] }] });
  expect([sc.staves[0].trans, sc.key, sc.changes]).toEqual(["bb", 0, [{ m: 1, key: 1 }]]);
});
