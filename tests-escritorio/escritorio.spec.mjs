// Pruebas de la app de escritorio ya compilada (npm run test:escritorio, que antes compila con `tauri build --debug`).
// Playwright se conecta a la ventana por el puerto de depuración de WebView2. Cada prueba usa una carpeta
// de datos temporal, así no toca los recientes ni el borrador de quien usa Atril en este equipo.
// Los diálogos de Windows (Abrir, Guardar como) no se pueden manejar desde aquí: se prueba lo que hay detrás.
import { test, expect, chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtempSync, copyFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const EXE = process.env.ATRIL_EXE || resolve(import.meta.dirname, "../src-tauri/target/debug/atril.exe"); // ATRIL_EXE: probar otra compilación
const EJEMPLOS = resolve(import.meta.dirname, "../ejemplos");
test.describe.configure({ mode: "serial" });

let port = 9340;
async function launch(dataDir, args = []) {
  const p = port++;
  const proc = spawn(EXE, args, { env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: dataDir, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${p}` } });
  let out = "", exited = null;
  proc.stdout.on("data", (d) => (out += d)); proc.stderr.on("data", (d) => (out += d)); proc.on("exit", (c) => (exited = c));
  // el primer arranque de WebView2 en un equipo nuevo (como en GitHub Actions) puede tardar bastante
  let browser;
  for (let i = 0; i < 240 && !browser && exited === null; i++) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${p}`); } catch { await new Promise((r) => setTimeout(r, 250)); } }
  if (!browser) throw new Error(`La app no abrió el puerto de depuración (${exited === null ? "sigue abierta" : "se cerró con código " + exited}). Salida: ${out.slice(-2000) || "(nada)"}`);
  let page;
  for (let i = 0; i < 40 && !page; i++) { page = browser.contexts()[0]?.pages()[0]; if (!page) await new Promise((r) => setTimeout(r, 250)); }
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.waitForFunction(() => typeof score !== "undefined" && score && document.querySelector("#pages svg"));
  return { proc, browser, page, errors, close: async () => { await browser.close().catch(() => {}); proc.kill(); await new Promise((r) => setTimeout(r, 500)); } };
}

let dir, app;
test.beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "atril-escritorio-")); });
test.afterEach(async () => { if (app) await app.close(); app = null; try { rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); } catch {} });

test("abre el .atril con que se lanza, guarda en el mismo archivo y todo sale de la app", async () => {
  test.skip(!existsSync(EXE), "Falta compilar: npx tauri build --debug --no-bundle");
  const file = join(dir, "Himno.atril");
  copyFileSync(join(EJEMPLOS, "himno-a-la-alegria.atril"), file);
  app = await launch(join(dir, "datos"), [file]);
  const { page } = app;
  expect(await page.evaluate(() => !!desktop)).toBe(true);
  await expect(page.locator("#savestate")).toHaveText("Himno.atril");
  await expect(page.locator("#docname")).toHaveText("Himno a la alegría");
  expect(await page.title()).toBe("Atril"); // document.title queda igual; el título va a la ventana

  // editar y Ctrl+S: escribe en el mismo archivo sin preguntar
  await page.fill("#pTitle", "Himno editado");
  await page.keyboard.press("Control+s");
  await expect(page.locator("#savestate")).toHaveText("Himno.atril");
  expect(JSON.parse(readFileSync(file, "utf8")).title).toBe("Himno editado");
  expect(existsSync(file + ".guardando")).toBe(false);

  // sonidos, pdf.js y librerías salen de la app (nada de internet)
  await page.evaluate(async () => { await loadSound("piano"); await ensurePdf(); await loadScript(LAME_URL); });
  // (window.performance está tapada por la función performance() de Atril; PerformanceObserver da lo mismo)
  const hosts = await page.evaluate(() => new Promise((res) => new PerformanceObserver((list, obs) => { obs.disconnect(); res([...new Set(list.getEntries().map((r) => new URL(r.name).host))]); }).observe({ type: "resource", buffered: true })));
  expect(hosts).toContain("tauri.localhost");
  expect(hosts.filter((h) => h !== "tauri.localhost" && h !== "ipc.localhost")).toEqual([]);

  // el enlace para compartir apunta a Atril publicada
  expect(await page.evaluate(() => shareLink())).toMatch(/^https:\/\/imboqqentt\.github\.io\/Atril\/#s=/);
  expect(app.errors).toEqual([]);
});

test("escribir y leer archivos binarios, y avisar si un archivo ya no existe", async () => {
  test.skip(!existsSync(EXE), "Falta compilar");
  app = await launch(join(dir, "datos"));
  const { page } = app;
  const out = join(dir, "prueba ñandú.zip");
  const back = await page.evaluate(async (path) => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    await desktop.write(path, new Blob([bytes]));
    return [...(await desktop.read(path))];
  }, out);
  expect(back).toEqual([...Array(256).keys()]);
  expect([...readFileSync(out)]).toEqual([...Array(256).keys()]);

  await page.evaluate((p) => openPath(p), join(dir, "no-existe.atril"));
  await expect(page.locator("#toast")).toContainText("No se pudo abrir no-existe.atril");
  expect(app.errors).toEqual([]);
});

test("recientes guardan la ruta y reabren el archivo desde el disco", async () => {
  test.skip(!existsSync(EXE), "Falta compilar");
  const a = join(dir, "a.atril"), b = join(dir, "b.atril");
  copyFileSync(join(EJEMPLOS, "himno-a-la-alegria.atril"), a);
  copyFileSync(join(EJEMPLOS, "fui-la-razon.atril"), b);
  app = await launch(join(dir, "datos"), [a]);
  const { page } = app;
  await expect(page.locator("#savestate")).toHaveText("a.atril");
  await page.evaluate((p) => openPath(p), b);
  await expect(page.locator("#savestate")).toHaveText("b.atril");
  await page.keyboard.press("Control+o");
  await expect(page.locator("#recList .libitem")).toHaveCount(2);
  await page.locator("#recList .libitem", { hasText: "a.atril" }).locator(".open").click();
  await expect(page.locator("#docname")).toHaveText("Himno a la alegría");
  expect(await page.evaluate(() => fileHandle)).toBe(a);
});

test("con Atril abierta, el doble clic en otro .atril lo abre en la misma ventana", async () => {
  test.skip(!existsSync(EXE), "Falta compilar");
  const a = join(dir, "a.atril"), b = join(dir, "b.atril");
  copyFileSync(join(EJEMPLOS, "himno-a-la-alegria.atril"), a);
  copyFileSync(join(EJEMPLOS, "fui-la-razon.atril"), b);
  app = await launch(join(dir, "datos"), [a]);
  const { page } = app;
  await expect(page.locator("#savestate")).toHaveText("a.atril");
  await page.evaluate(() => commit(() => { score.title = "Cambio sin guardar"; }));

  // segunda instancia: entrega el archivo a la primera y se cierra
  const second = spawn(EXE, [b], { env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: join(dir, "datos") } });
  const code = await new Promise((r) => second.on("exit", r));
  expect(code).toBe(0);
  await expect(page.locator("#savestate")).toHaveText("b.atril");
  await expect(page.locator("#docname")).toHaveText("Fui La Razón");

  // los cambios sin guardar no se pierden
  await page.keyboard.press("Control+o");
  await expect(page.locator("#recPrev")).toContainText("Cambio sin guardar");
});

// ---------- lectura de PDF con Audiveris (se salta si Audiveris no está instalado) ----------
const PDF = resolve(import.meta.dirname, "fixtures/himno.pdf"); // el himno de ejemplo, exportado a PDF por Atril

test("sin Audiveris, explica cómo instalarlo", async () => {
  test.skip(!existsSync(EXE), "Falta compilar");
  app = await launch(join(dir, "datos"));
  const { page } = app;
  await page.evaluate(() => { const inv = desktop.invoke; desktop.invoke = (c, a, o) => (c === "buscar_audiveris" ? Promise.resolve(null) : inv(c, a, o)); });
  await expect(page.locator("#omrHint")).toHaveText("Con Audiveris, en tu equipo y sin internet");
  await page.click("#bFile");
  await page.click('#mFile [data-act="omr"]');
  await expect(page.locator("#modal")).toContainText("No lo encontré en este equipo");
  await expect(page.locator('#modal [data-x="web"]')).toBeVisible();
  await expect(page.locator('#modal [data-x="locate"]')).toBeVisible();
});

test("lee un PDF con Audiveris y lo abre como partitura nueva", async () => {
  test.skip(!existsSync(EXE), "Falta compilar");
  test.setTimeout(240_000);
  app = await launch(join(dir, "datos"));
  const { page } = app;
  const exe = await page.evaluate(() => findAudiveris());
  test.skip(!exe, "Audiveris no está instalado");
  const steps = [];
  await page.exposeFunction("__step", (t) => steps.push(t));
  const r = await page.evaluate(async (pdf) => {
    const { score: sc, parts, ocrMissing } = await readWithAudiveris(await findAudiveris(), pdf, null, (t) => window.__step(t));
    return { title: sc.title, key: sc.key, time: sc.time, parts, ocrMissing: typeof ocrMissing, staves: sc.staves.length,
      sop: sc.staves[0].voices[0].notes.slice(0, 8).map((n) => n.rest ? "-" : n.keys[0].s + n.keys[0].o + n.d) };
  }, PDF);
  expect(r).toMatchObject({ title: "himno", key: 1, time: "4/4", parts: 1, ocrMissing: "boolean", staves: 2 });
  expect(r.sop).toEqual(["B4q", "B4q", "C5q", "D5q", "D5q", "C5q", "B4q", "A4q"]);
  expect(steps).toContain("Leyendo: buscando los pentagramas");
  expect(steps).toContain("Abriendo en Atril");
  expect(app.errors).toEqual([]);
});

test("detener la lectura cierra Audiveris", async () => {
  test.skip(!existsSync(EXE), "Falta compilar");
  test.setTimeout(120_000);
  app = await launch(join(dir, "datos"));
  const { page } = app;
  test.skip(!(await page.evaluate(() => findAudiveris())), "Audiveris no está instalado");
  const t0 = Date.now();
  const msg = await page.evaluate(async (pdf) => {
    const exe = await findAudiveris();
    const run = desktop.invoke("leer_pdf", { audiveris: exe, pdf }).then(() => "terminó", (e) => String(e));
    await new Promise((res) => window.__TAURI__.event.listen("audiveris", (e) => { if (/StepMonitoring/.test(e.payload)) res(); }));
    await desktop.invoke("cancelar_audiveris");
    return run;
  }, PDF);
  expect(msg).toBe("cancelado");
  expect(Date.now() - t0).toBeLessThan(60_000);
  const { execSync } = await import("node:child_process");
  // solo cuentan los Audiveris en modo batch (los que abre Atril); una ventana de Audiveris abierta por la persona no
  const batch = execSync(`powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"Name='Audiveris.exe'\\" | Where-Object { $_.CommandLine -match '-batch' }).Count"`, { encoding: "utf8" }).trim();
  expect(batch).toBe("0");
});
