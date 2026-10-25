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

  // fuera de claude.ai la capa del artefacto queda apagada y no se ve nada de Claude (ni en la página ni en la ayuda)
  expect(await page.evaluate(() => ({ inClaude, lib: cloud.lib, sample: cloud.sample, dl: cloud.downloads }))).toEqual({ inClaude: false, lib: null, sample: null, dl: null });
  expect(await page.evaluate(() => document.body.innerText)).not.toMatch(/Claude/);
  await page.click("#bHelp");
  expect(await page.locator("#modal").innerText()).not.toMatch(/Claude/);
  await page.keyboard.press("Escape");

  expect(external, "pedidos a internet").toEqual([]);
  expect(errors, "errores de consola").toEqual([]);
});

test("en Mac los atajos se muestran con ⌘ y funcionan con Cmd", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "platform", { get: () => "MacIntel" }));
  const { errors } = await openAtril(page);
  expect(await page.getAttribute("#bSave", "title")).toBe("⌘S");
  expect(await page.getAttribute("#zOut", "title")).toBe("Alejar (⌘−, o ⌘ + rueda del mouse)");
  await expect(page.locator("#mFile [data-act=saveas] span")).toContainText("(⌘⇧S)");
  await page.click("#bHelp");
  await expect(page.locator("#modal")).toContainText("⌘Z · ⌘Y");
  await expect(page.locator("#modal")).not.toContainText("Ctrl");
  await page.click('#modal [data-x="close"]');
  await page.locator("#desk").focus();
  await page.keyboard.press("Meta+=");
  await expect(page.locator("#zReset")).not.toHaveText("100 %");
  expect(errors).toEqual([]);
});
