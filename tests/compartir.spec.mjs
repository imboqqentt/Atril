import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { openAtril, scoreWithMarks } from "./helpers.mjs";

// Los enlaces creados en el equipo apuntan a Atril publicada; en las pruebas se abren en el servidor local.
const local = (link) => "/" + link.slice(link.indexOf("#"));

test("empaquetar y desempaquetar no pierde nada", async ({ page }) => {
  await openAtril(page);
  const sc = JSON.parse(await readFile("ejemplos/fui-la-razon.atril", "utf8"));
  const out = await page.evaluate(async (sc) => { const p = await packScore(sc); return { len: p.length, ok: /^[A-Za-z0-9_-]+$/.test(p), back: await unpackScore(p) }; }, sc);
  expect(out.ok).toBe(true);
  expect(out.len).toBeLessThan(5000);
  expect(out.back).toEqual(sc);
});

test("copiar enlace y abrirlo en otra pestaña", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const { errors } = await openAtril(page);
  await page.click("#bShare");
  const link = await page.inputValue("#shLink");
  expect(link).toMatch(/^https:\/\/imboqqentt\.github\.io\/Atril\/#s=[A-Za-z0-9_-]+$/);
  await expect(page.locator("#shLocal")).toHaveCount(0);
  await expect(page.locator("#shLong")).toHaveCount(0);
  await page.click('#modal [data-x="copy"]');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  const original = await page.evaluate(() => score);

  const other = await context.newPage();
  const o = await openAtril(other, local(link));
  await expect(other.locator("#docname")).toHaveText("Himno a la alegría");
  await expect(other.locator("#toast")).toContainText("Te compartieron «Himno a la alegría»");
  await expect(other.locator("#savestate")).toHaveText("Sin guardar");
  expect(new URL(other.url()).hash).toBe(""); // al recargar no vuelve a abrir el enlace encima de los cambios
  const opened = await other.evaluate(() => score);
  expect(opened.id).not.toBe(original.id);
  expect(opened.staves).toEqual(original.staves);
  expect(opened.sample).toBeUndefined();
  expect([...errors, ...o.errors]).toEqual([]);
});

test("sin Atril publicada, avisa que el enlace solo funciona en este equipo", async ({ page }) => {
  await openAtril(page);
  await page.evaluate(() => document.querySelector('meta[name="atril-url"]').remove());
  await page.click("#bShare");
  expect(await page.inputValue("#shLink")).toMatch(/^http:\/\/localhost:\d+\/#s=/);
  await expect(page.locator("#shLocal")).toBeVisible();
});

test("enlace demasiado largo: avisa y ofrece el archivo", async ({ page }) => {
  await openAtril(page);
  await page.evaluate(() => {
    // muchas notas al azar con letra: se comprime mal
    const notes = [], rnd = (n) => Math.floor(Math.random() * n);
    for (let i = 0; i < 6000; i++) notes.push({ d: ["q", "8", "h"][rnd(3)], dots: 0, rest: false, tie: false, keys: [{ s: "CDEFGAB"[rnd(7)], a: rnd(3) - 1, o: 3 + rnd(3) }], ly: [{ t: Math.random().toString(36).slice(2, 6), h: false }] });
    load({ ...score, staves: [{ name: "", clef: "treble", voices: [{ name: "", notes }] }] }); render();
  });
  await page.click("#bShare");
  await expect(page.locator("#shLong")).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click('#modal [data-x="file"]')]);
  expect(dl.suggestedFilename()).toBe("himno-a-la-alegria.atril");
});

test("abrir un enlace guarda el borrador sin guardar y se puede recuperar", async ({ page }) => {
  await openAtril(page);
  const link = await page.evaluate(async () => { const sc = { ...score, title: "Compartida" }; return "#s=" + (await packScore(sc)); });
  // borrador propio con cambios
  await page.evaluate(() => commit(() => { score.title = "Mi borrador"; }));
  await page.evaluate((h) => { location.hash = h; }, link);
  await expect(page.locator("#docname")).toHaveText("Compartida");

  await page.click("#bOpen");
  await expect(page.locator("#recPrev")).toContainText("Mi borrador");
  await page.locator("#recPrev .open").click();
  await expect(page.locator("#docname")).toHaveText("Mi borrador");
  await expect(page.locator("#savestate")).toHaveText("Sin guardar");
});

test("enlace dañado: avisa y abre lo de siempre", async ({ page }) => {
  const { errors } = await openAtril(page, "/#s=estonoesunapartitura");
  await expect(page.locator("#toast")).toContainText("Este enlace está incompleto o dañado");
  await expect(page.locator("#docname")).toHaveText("Himno a la alegría");
  expect(errors).toEqual([]);
});

test("las marcas y cambios viajan en el enlace", async ({ page, context }) => {
  await openAtril(page);
  const sc = scoreWithMarks(8, { 1: { segno: true }, 3: { toCoda: true }, 5: { jump: "DSalCoda" }, 6: { coda: true } });
  sc.changes = [{ m: 4, key: -2 }];
  const link = await page.evaluate(async (sc) => { load(sc); render(); return shareLink(); }, sc);
  const other = await context.newPage();
  await openAtril(other, local(link));
  await expect(other.locator("#docname")).toHaveText("Prueba");
  const got = await other.evaluate(() => ({ marks: score.marks, changes: score.changes, order: playOrder(scoreLen(buildModel())).map((m) => m + 1) }));
  expect(got.marks).toEqual(sc.marks);
  expect(got.changes).toEqual(sc.changes);
  expect(got.order).toEqual([1, 2, 3, 4, 5, 6, 2, 3, 4, 7, 8]);
});
