import { test, expect } from "@playwright/test";
import { openAtril } from "./helpers.mjs";

test("carga sin errores y sin pedir nada a internet", async ({ page }) => {
  const { external, errors } = await openAtril(page);
  await expect(page.locator("#docname")).toHaveText("Himno a la alegría");
  expect(await page.locator("#pages svg").count()).toBeGreaterThan(0);

  // fuentes locales
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return ["IBM Plex Sans", "Libre Caslon Text"].map((f) => document.fonts.check(`16px "${f}"`));
  });
  expect(fonts).toEqual([true, true]);

  // banco de sonido desde snd/
  const piano = await page.evaluate(async () => { await loadSound("piano"); return banks.piano.decoded.length; });
  expect(piano).toBe(30);

  // pdf.js y su worker desde vendor/
  const pdf = await page.evaluate(async () => { await ensurePdf(); return !!(window.pdfjsLib && window.pdfjsWorker); });
  expect(pdf).toBe(true);

  // librerías que se cargan bajo demanda
  const libs = await page.evaluate(async () => {
    await loadScript(LAME_URL); await loadScript(MP4MUX_URL); await loadScript(WEBMMUX_URL);
    return [!!window.lamejs, !!window.Mp4Muxer, !!window.WebMMuxer, !!window.jspdf, !!window.JSZip, !!window.Vex];
  });
  expect(libs).toEqual([true, true, true, true, true, true]);

  // reproducir y detener
  await page.click("#tPlay");
  await expect(page.locator("#tPlay")).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(800);
  await page.click("#tPlay");
  await expect(page.locator("#tPlay")).toHaveAttribute("aria-pressed", "false");

  // nada depende de la plataforma Claude
  expect(await page.content()).not.toMatch(/window\.claude|Claude/);

  expect(external, "pedidos a internet").toEqual([]);
  expect(errors, "errores de consola").toEqual([]);
});
