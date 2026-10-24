import { test, expect } from "@playwright/test";
import { openAtril } from "./helpers.mjs";

const pageWidth = (page) => page.evaluate(() => document.querySelector(".page").getBoundingClientRect().width);

test.describe("zoom", () => {
  test("botones, teclado y Ctrl+rueda; se recuerda al recargar", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    const { errors } = await openAtril(page);
    const w0 = await pageWidth(page);
    await page.click("#zIn");
    await expect(page.locator("#zReset")).toHaveText("110 %");
    expect(await pageWidth(page)).toBeCloseTo(w0 * 1.1, 0);

    await page.locator("#desk").focus();
    await page.keyboard.press("Control+Minus");
    await page.keyboard.press("Control+Minus");
    await expect(page.locator("#zReset")).toHaveText("90 %");
    await page.keyboard.press("Control+0");
    await expect(page.locator("#zReset")).toHaveText("100 %");

    // Ctrl+rueda sobre la partitura acerca (y no hace zoom del navegador)
    const box = await page.locator(".page").first().boundingBox();
    await page.mouse.move(box.x + 200, box.y + 300);
    await page.keyboard.down("Control"); await page.mouse.wheel(0, -100); await page.keyboard.up("Control");
    await expect(page.locator("#zReset")).toHaveText("110 %");

    // a 200 % la hoja es más ancha que el escritorio y se puede desplazar hacia los lados
    await page.evaluate(() => setZoom(2));
    const d = await page.evaluate(() => { const k = document.getElementById("desk"); return { sw: k.scrollWidth, cw: k.clientWidth }; });
    expect(d.sw).toBeGreaterThan(d.cw);

    await page.reload();
    await page.waitForFunction(() => typeof score !== "undefined" && document.querySelector("#pages svg"));
    await expect(page.locator("#zReset")).toHaveText("200 %");
    expect(await page.evaluate(() => getComputedStyle(document.getElementById("desk")).getPropertyValue("--zoom").trim())).toBe("2");
    expect(errors).toEqual([]);
  });

  test("con zoom, el clic sigue eligiendo la nota correcta", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openAtril(page);
    await page.evaluate(() => setZoom(1.75));
    const note = page.locator('[id="vf-n0_0_2_0"]'); // tercera nota de la soprano (Do5)
    await note.scrollIntoViewIfNeeded();
    const b = await note.boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height - 4);
    expect(await page.evaluate(() => ({ s: cursor.staff, v: cursor.voice, i: cursor.index }))).toEqual({ s: 0, v: 0, i: 3 });
  });
});

// Himno con acordes fijados y corcheas agudas de plica arriba en la soprano (las que tapaban el cifrado)
async function himnoConAcordes(page, marks = {}) {
  await openAtril(page);
  await page.evaluate((marks) => {
    chordMode = "en"; fixDetectedChords(); score.marks = marks;
    commit(() => { score.staves[0].voices[0].notes.splice(0, 4, ...["D5", "E5", "F5", "G5", "A5", "G5", "F5", "E5"].map((p) => ({ d: "8", dots: 0, rest: false, tie: false, keys: [{ s: p[0], a: p[0] === "F" ? 1 : 0, o: +p[1] }] }))); });
  }, marks);
}
// Cajas de los acordes, de las notas del pentagrama de arriba y de las casillas, en la primera página
const boxes = (page) => page.evaluate(() => {
  const svg = document.querySelector("#pages svg"), bb = (e) => { const b = e.getBBox(), t = e.transform.baseVal.consolidate(), m = t ? t.matrix : { e: 0, f: 0 }; return { x: b.x + m.e, y: b.y + m.f, w: b.width, h: b.height }; };
  const chords = [...svg.querySelectorAll(".chordsym")].map((e) => ({ t: e.textContent, ...bb(e) }));
  const notes = layout.rendered[0].flat().filter((r) => r.svg === svg).map((r) => { const b = r.vf.getBoundingBox(); return { x: b.getX(), y: b.getY(), w: b.getW(), h: b.getH() }; });
  return { chords, notes };
});

test.describe("altura de los acordes", () => {
  test("no quedan tapados por plicas ni barras, y cada sistema tiene una sola fila", async ({ page }) => {
    const { errors } = await (async () => { const r = { errors: [] }; page.on("pageerror", (e) => r.errors.push(String(e))); return r; })();
    await himnoConAcordes(page);
    const { chords, notes } = await boxes(page);
    expect(chords.length).toBeGreaterThan(5);
    for (const c of chords) for (const n of notes) {
      const sameSystem = n.y + n.h > c.y && n.y < c.y + 120; // notas del pentagrama de arriba de ese mismo sistema
      if (sameSystem && n.x < c.x + c.w && n.x + n.w > c.x) expect(c.y + c.h, `«${c.t}» tapado por una nota`).toBeLessThanOrEqual(n.y + 1);
    }
    // la primera fila (sistema 1) a una sola altura
    const ys = await page.evaluate(() => [...document.querySelectorAll("#pages svg .chordsym")].map((e) => +e.getAttribute("y")));
    const firstRow = ys.filter((y) => Math.abs(y - ys[0]) < 30);
    expect(new Set(firstRow).size).toBe(1);
    expect(errors).toEqual([]);
  });

  test("tempo y casillas suben sobre la fila de acordes sin montarse", async ({ page }) => {
    await himnoConAcordes(page, { 2: { volta: [1], repEnd: 2 }, 3: { volta: [2] } });
    const r = await page.evaluate(() => {
      const svg = document.querySelector("#pages svg"), line0 = layout.rects.find((x) => x.staff === 0 && x.page === 0).top;
      const abs = (e) => { const b = e.getBBox(), t = e.transform.baseVal.consolidate(), m = t ? t.matrix : { e: 0, f: 0 }; return { x: b.x + m.e, y: b.y + m.f, w: b.width, h: b.height }; };
      const chords = [...svg.querySelectorAll(".chordsym")].map(abs);
      const marks = [...svg.children].filter((e) => !e.classList.contains("chordsym") && e.tagName !== "g").map(abs).filter((b) => b.h > 0 && b.y + b.h < line0 - 2 && b.y > line0 - 120);
      return { chords, marks };
    });
    expect(r.marks.length).toBeGreaterThan(0);
    for (const m of r.marks) for (const c of r.chords) {
      if (m.x < c.x + c.w && m.x + m.w > c.x) expect(m.y + m.h, "una marca quedó encima de un acorde").toBeLessThanOrEqual(c.y + 0.5);
    }
  });

  test("↑ ↓ suben y bajan el acorde elegido; se deshace y se guarda", async ({ page }) => {
    await himnoConAcordes(page);
    const yOf = () => page.evaluate(() => +document.querySelector('#pages .chordsym.own[data-ci="1"]').getAttribute("y"));
    const y0 = await yOf();
    await page.evaluate(() => { const c = score.chords[1]; chordSel = { m: c.m, at: c.at }; paintChordSel(); });
    await page.locator("#desk").focus();
    await page.keyboard.press("ArrowUp"); await page.keyboard.press("ArrowUp");
    expect(await page.evaluate(() => score.chords[1].dy)).toBe(1);
    expect(y0 - (await yOf())).toBeCloseTo(10, 0); // un espacio del pentagrama
    await page.keyboard.press("ArrowDown");
    expect(await page.evaluate(() => score.chords[1].dy)).toBe(0.5);
    await page.keyboard.press("Control+z");
    expect(await page.evaluate(() => score.chords[1].dy)).toBe(1);
    // el resto de la fila no se mueve
    expect(await page.evaluate(() => +document.querySelector('#pages .chordsym.own[data-ci="2"]').getAttribute("y"))).toBeCloseTo(y0, 0);

    // cambiar el nombre conserva la altura; la casilla del diálogo la vuelve a automática
    await page.keyboard.press("Enter");
    await page.fill("#chIn", "Em7");
    await page.click('#modal [data-x="ok"]');
    const c = await page.evaluate(() => score.chords.find((x) => x.q === "m7" && x.root.s === "E"));
    expect(c.dy).toBe(1);
    await page.evaluate(() => { const c = score.chords.find((x) => x.q === "m7" && x.root.s === "E"); chordDialog({ m: c.m, at: c.at }); });
    await page.check("#chAuto");
    await page.click('#modal [data-x="ok"]');
    expect(await page.evaluate(() => score.chords.find((x) => x.q === "m7" && x.root.s === "E").dy)).toBeUndefined();
  });

  test("arrastrar hacia arriba sube el acorde (de a medio espacio)", async ({ page }) => {
    await himnoConAcordes(page);
    const el = page.locator('#pages .chordsym.own[data-ci="2"]');
    const b = await el.boundingBox();
    const scale = await page.evaluate(() => { const s = document.querySelector("#pages svg"); return s.getBoundingClientRect().width / s.viewBox.baseVal.width; });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 15 * scale, { steps: 5 }); // 1,5 espacios hacia arriba
    await page.mouse.up();
    const c = await page.evaluate(() => score.chords[2]);
    expect(c.dy).toBe(1.5);
  });

  test("la altura a mano viaja en MusicXML (relative-y)", async ({ page }) => {
    await himnoConAcordes(page);
    const r = await page.evaluate(() => {
      commit(() => { score.chords[0].dy = 2; score.chords[3].dy = -0.5; });
      const xml = toMusicXML(), back = fromMusicXML(xml);
      return { hasAttr: /relative-y="20"/.test(xml), dys: back.chords.map((c) => c.dy || 0).slice(0, 4) };
    });
    expect(r.hasAttr).toBe(true);
    expect(r.dys).toEqual([2, 0, 0, -0.5]);
  });
});
