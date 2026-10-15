import { test, expect } from "@playwright/test";
import { openAtril } from "./helpers.mjs";

// Los diálogos nativos de archivo no se pueden manejar en una prueba: se reemplazan por archivos reales
// del almacenamiento privado del navegador (OPFS), que son FileSystemFileHandle de verdad.
async function fakePickers(page) {
  await page.addInitScript(() => {
    window.__picks = [];
    const dir = () => navigator.storage.getDirectory();
    window.showSaveFilePicker = async (o) => { const name = window.__picks.shift() || o.suggestedName; return (await dir()).getFileHandle(name, { create: true }); };
    window.showOpenFilePicker = async () => [await (await dir()).getFileHandle(window.__picks.shift())];
  });
}
const readOpfs = (page, name) => page.evaluate(async (n) => (await (await (await navigator.storage.getDirectory()).getFileHandle(n)).getFile()).text(), name);

test("Ctrl+S guarda en un .atril y vuelve a guardar en el mismo archivo", async ({ page }) => {
  await fakePickers(page);
  const { errors } = await openAtril(page);
  await page.locator("#desk").focus();
  await page.keyboard.press("Control+s");
  await expect(page.locator("#savestate")).toHaveText("himno-a-la-alegria.atril");
  let saved = JSON.parse(await readOpfs(page, "himno-a-la-alegria.atril"));
  expect(saved.title).toBe("Himno a la alegría");
  expect(saved.sample).toBeUndefined();

  // un cambio deja la partitura sin guardar; Ctrl+S escribe en el mismo archivo sin preguntar
  await page.fill("#pTitle", "Himno editado");
  await page.keyboard.press("Control+s"); // con el foco en el título: primero lo confirma
  await expect(page.locator("#savestate")).toHaveText("himno-a-la-alegria.atril");
  saved = JSON.parse(await readOpfs(page, "himno-a-la-alegria.atril"));
  expect(saved.title).toBe("Himno editado");

  // Guardar como crea una copia aparte
  const firstId = saved.id;
  await page.evaluate(() => window.__picks.push("copia.atril"));
  await page.keyboard.press("Control+Shift+S");
  await expect(page.locator("#savestate")).toHaveText("copia.atril");
  const copy = JSON.parse(await readOpfs(page, "copia.atril"));
  expect(copy.id).not.toBe(firstId);

  // los dos aparecen en recientes (Ctrl+O) y se pueden reabrir
  await page.keyboard.press("Control+o");
  await expect(page.locator("#recList .libitem")).toHaveCount(2);
  await page.locator("#recList .libitem", { hasText: "himno-a-la-alegria.atril" }).locator(".open").click();
  await expect(page.locator("#savestate")).toHaveText("himno-a-la-alegria.atril");
  expect(await page.evaluate(() => score.id)).toBe(firstId);
  expect(errors).toEqual([]);
});

test("abrir un .atril con el selector y recordar el archivo al recargar", async ({ page }) => {
  await fakePickers(page);
  await openAtril(page);
  await page.evaluate(async () => {
    const h = await (await navigator.storage.getDirectory()).getFileHandle("mia.atril", { create: true });
    const w = await h.createWritable(); await w.write(JSON.stringify({ ...score, id: "mia", title: "Mi partitura", sample: undefined })); await w.close();
    window.__picks.push("mia.atril");
  });
  await page.click("#bOpen");
  await page.click('[data-x="pick"]');
  await expect(page.locator("#docname")).toHaveText("Mi partitura");
  await expect(page.locator("#savestate")).toHaveText("mia.atril");

  // escribir una nota: queda pendiente; al recargar, el borrador sigue unido a mia.atril
  await page.locator("#desk").focus();
  await page.keyboard.press("c");
  await expect(page.locator("#savestate")).toHaveText("mia.atril · cambios sin guardar");
  await page.reload();
  await page.waitForFunction(() => typeof score !== "undefined" && score && score.id === "mia");
  await expect(page.locator("#savestate")).toHaveText("mia.atril · cambios sin guardar");
  await page.waitForFunction(() => !!fileHandle);
  await page.locator("#desk").focus();
  await page.keyboard.press("Control+s");
  await expect(page.locator("#savestate")).toHaveText("mia.atril");
  const saved = JSON.parse(await readOpfs(page, "mia.atril"));
  expect(saved.staves[0].voices[0].notes.length).toBe(await page.evaluate(() => score.staves[0].voices[0].notes.length));
});

test("sin File System Access: guardar descarga el .atril y se puede volver a abrir", async ({ page }) => {
  await page.addInitScript(() => { delete window.showSaveFilePicker; delete window.showOpenFilePicker; });
  await openAtril(page);
  await page.locator("#desk").focus();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.keyboard.press("Control+s")]);
  expect(dl.suggestedFilename()).toBe("himno-a-la-alegria.atril");
  const buffer = await (await import("node:fs/promises")).readFile(await dl.path());

  await page.evaluate(() => { score.title = "Otra"; syncProps(); });
  await page.setInputFiles("#fileIn", { name: dl.suggestedFilename(), mimeType: "application/json", buffer });
  await expect(page.locator("#docname")).toHaveText("Himno a la alegría");
  await expect(page.locator("#savestate")).toHaveText("himno-a-la-alegria.atril");

  // recientes guarda una copia: se reabre aunque no haya acceso al archivo
  await page.click("#bOpen");
  await expect(page.locator("#recList .libitem")).toHaveCount(1);
});
