import { test, expect } from "@playwright/test";
import { openAtril } from "./helpers.mjs";

const one = (notes, extra = {}, staff = {}) => ({ id: "t", title: "Prueba", composer: "", tempo: 60, time: "4/4", key: 0, changes: [], marks: {}, layout: { staff: 6, perSystem: 0 }, groups: [],
  staves: [{ name: "", clef: "treble", voices: [{ name: "", notes }], ...staff }], ...extra });
const N = (s, o, d = "q", extra = {}) => ({ d, dots: 0, rest: false, tie: false, keys: [{ s, a: 0, o }], ...extra });
const shownKeys = (page) => page.evaluate(() => layout.rendered[0][0].map((r) => r.vf.keys.join("+")));
const keysOf = (page) => page.evaluate(() => score.staves[0].voices[0].notes.map((n) => n.rest ? "-" : n.keys.map((k) => k.s + ["b", "", "#"][(k.a || 0) + 1] + k.o).join("+")));

test.describe("instrumentos transpositores", () => {
  test("sax alto: se escribe en La mayor, suena en Do", async ({ page }) => {
    const { errors } = await openAtril(page);
    const r = await page.evaluate((sc) => {
      load(sc); render();
      const st = score.staves[0];
      return { written: writtenKey(st, score.key), sounds: performance().events.map((e) => staffMidi(e.keys[0], st)) };
    }, one([N("A", 4), N("C", 5, "q", { keys: [{ s: "C", a: 1, o: 5 }] }), N("E", 5, "h")], {}, { trans: "eb" }));
    expect(r).toEqual({ written: 3, sounds: [60, 64, 67] }); // La-Do#-Mi escritos = Do-Mi-Sol reales
    expect(errors).toEqual([]);
  });

  test("elegir el instrumento reescribe las notas para que suenen igual", async ({ page }) => {
    await openAtril(page);
    await page.evaluate((sc) => { load(sc); render(); setStaffTrans(0, "bb"); }, one([N("C", 4), N("E", 4), N("G", 4), N("C", 5)]));
    expect(await keysOf(page)).toEqual(["D4", "F#4", "A4", "D5"]);
    await page.evaluate(() => setStaffTrans(0, "ten")); // de Si♭ a tenor: una octava más arriba en lo escrito
    expect(await keysOf(page)).toEqual(["D5", "F#5", "A5", "D6"]);
    await page.evaluate(() => setStaffTrans(0, ""));
    expect(await keysOf(page)).toEqual(["C4", "E4", "G4", "C5"]);
  });

  test("ver en tono real y escribir mirando en tono real", async ({ page }) => {
    const { errors } = await openAtril(page);
    await page.evaluate((sc) => { load(sc); render(); }, one([N("A", 4), N("B", 4)], {}, { trans: "eb" }));
    expect(await shownKeys(page)).toEqual(["a/4", "b/4"]);
    await page.evaluate(() => setConcertView(true));
    expect(await shownKeys(page)).toEqual(["c/4", "d/4"]);
    // con la vista real se escribe lo que suena: Mi real → Do# escrito
    await page.evaluate(() => { cursor = { staff: 0, voice: 0, index: 2, tickHint: null }; mode = "input"; insertNote("E"); });
    expect(await keysOf(page)).toEqual(["A4", "B4", "C#5"]);
    await page.evaluate(() => setConcertView(false));
    expect(errors).toEqual([]);
  });

  test("MusicXML: <transpose> y armadura escrita, ida y vuelta", async ({ page }) => {
    await openAtril(page);
    const r = await page.evaluate((sc) => {
      load(sc); const xml = toMusicXML(); const back = fromMusicXML(xml);
      return { hasTr: /<transpose><diatonic>-1<\/diatonic><chromatic>-2<\/chromatic><octave-change>-1<\/octave-change><\/transpose>/.test(xml), fifths: (xml.match(/<fifths>(-?\d)<\/fifths>/) || [])[1], trans: back.staves[0].trans, key: back.key, notes: back.staves[0].voices[0].notes.map((n) => n.keys[0].s + n.keys[0].o) };
    }, one([N("D", 5), N("E", 5), N("F", 5, "h", { keys: [{ s: "F", a: 1, o: 5 }] })], { key: -2 }, { trans: "ten" }));
    expect(r).toEqual({ hasTr: true, fifths: "0", trans: "ten", key: -2, notes: ["D5", "E5", "F5"] });
  });
});

test.describe("claves", () => {
  test("tenor, sol 8va alta, fa 8va baja y percusión: dibujo, sonido y MusicXML", async ({ page }) => {
    const { errors } = await openAtril(page);
    const r = await page.evaluate(() => {
      const out = {};
      for (const clef of ["tenor", "treble8va", "bass8vb", "perc"]) {
        load({ id: "t", title: "", composer: "", tempo: 60, time: "4/4", key: 0, changes: [], marks: {}, layout: { staff: 6, perSystem: 0 }, groups: [], staves: [{ name: "", clef, voices: [{ name: "", notes: [{ d: "w", dots: 0, rest: false, tie: false, keys: [{ s: "C", a: 0, o: 4 }] }] }] }] });
        render();
        out[clef] = [staffMidi(score.staves[0].voices[0].notes[0].keys[0], score.staves[0]), fromMusicXML(toMusicXML()).staves[0].clef];
      }
      return out;
    });
    expect(r).toEqual({ tenor: [60, "tenor"], treble8va: [72, "treble8va"], bass8vb: [48, "bass8vb"], perc: [60, "perc"] });
    expect(errors).toEqual([]);
  });
});

test.describe("8va y pedal", () => {
  test("8va se dibuja una octava abajo y suena igual", async ({ page }) => {
    const { errors } = await openAtril(page);
    const r = await page.evaluate((sc) => {
      load(sc); render();
      return { shown: layout.rendered[0][0].map((r) => r.vf.keys[0]), ott: document.querySelectorAll("#pages .ottava").length, midi: performance().events.map((e) => staffMidi(e.keys[0], score.staves[0])) };
    }, one([N("C", 6, "q", { ova: "8va" }), N("D", 6), N("E", 6, "q", { ovae: true }), N("C", 5)]));
    expect(r).toEqual({ shown: ["c/5", "d/5", "e/5", "c/5"], ott: 1, midi: [84, 86, 88, 72] });
    expect(errors).toEqual([]);
  });

  test("con pedal las notas siguen sonando hasta soltarlo", async ({ page }) => {
    await openAtril(page);
    const r = await page.evaluate((sc) => {
      load(sc); render(); const P = performance();
      return { sus: P.events.map((e) => (e.sus ? +P.timeOf(e.sus).toFixed(2) : null)), marks: [document.querySelectorAll("#pages .pedal").length, document.querySelectorAll("#pages .pedal-up").length] };
    }, one([N("C", 4, "q", { ped: true }), N("E", 4), N("G", 4, "q", { pede: true }), N("C", 5)]));
    expect(r).toEqual({ sus: [3, 3, null, null], marks: [1, 1] });
  });

  test("8va, pedal y plicas en MusicXML ida y vuelta", async ({ page }) => {
    await openAtril(page);
    const notes = [N("C", 6, "q", { ova: "8va", ped: true }), N("D", 6), N("E", 6, "q", { ovae: true, pede: true }), N("C", 4, "q", { ova: "8vb" }), N("D", 4, "w", { ovae: true })];
    const back = await page.evaluate((sc) => { load(sc); return fromMusicXML(toMusicXML()).staves[0].voices[0].notes.map((n) => [n.ova || null, !!n.ovae, !!n.ped, !!n.pede]); }, one(notes));
    expect(back).toEqual(notes.map((n) => [n.ova || null, !!n.ovae, !!n.ped, !!n.pede]));
  });
});

test.describe("barras y plicas a mano", () => {
  const beamsOf = (page, sc) => page.evaluate((sc) => {
    load(sc); render();
    const seq = layout.rendered[0][0], bs = [...new Set(seq.map((r) => r.vf.beam).filter(Boolean))];
    return { beams: bs.map((b) => seq.filter((r) => r.vf.beam === b).length), stems: seq.map((r) => r.vf.getStemDirection()) };
  }, sc);
  test("por pulso, unir, cortar y plica forzada", async ({ page }) => {
    const { errors } = await openAtril(page);
    const e8 = (x = {}) => N("C", 5, "8", x);
    expect((await beamsOf(page, one([e8(), e8(), e8(), e8(), N("C", 5, "h")]))).beams).toEqual([2, 2]);
    expect((await beamsOf(page, one([e8(), e8(), e8({ bm: "join" }), e8(), N("C", 5, "h")]))).beams).toEqual([4]);
    expect((await beamsOf(page, one([e8(), e8({ bm: "break" }), e8(), e8(), N("C", 5, "h")]))).beams).toEqual([2]);
    const r = await beamsOf(page, one([N("C", 5, "q", { stem: "up" }), N("C", 5), N("C", 4, "h", { stem: "down" })]));
    expect(r.stems).toEqual([1, -1, -1]);
    expect(errors).toEqual([]);
  });
});
