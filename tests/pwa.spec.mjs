import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

test.use({ serviceWorkers: "allow" });

async function installed(page) {
  await page.goto("/");
  await page.waitForFunction(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; });
  await page.reload(); // ya controlada por el service worker
  await page.waitForFunction(() => !!navigator.serviceWorker.controller && typeof score !== "undefined" && document.querySelector("#pages svg"));
}

test("una versión nueva de index.html llega sin reinstalar", async ({ page, context }) => {
  await installed(page);
  // el servidor publica una versión nueva de la app
  await context.route(/\/(index\.html)?$/, async (route) => {
    const res = await route.fetch();
    route.fulfill({ response: res, body: (await res.text()).replace("<title>Atril</title>", "<title>Atril nueva</title>") });
  });
  await page.reload();
  await expect(page).toHaveTitle("Atril nueva");
});

test("quien tenía el service worker anterior recibe el nuevo y las versiones nuevas", async ({ page, context }) => {
  const oldSw = execSync("git show 610d071:sw.js", { encoding: "utf8" }); // el que guardaba index.html para siempre
  await context.route(/\/sw\.js$/, (route) => route.fulfill({ contentType: "text/javascript", body: oldSw }));
  await installed(page);
  await context.unroute(/\/sw\.js$/);
  await context.route(/\/(index\.html)?$/, async (route) => {
    const res = await route.fetch();
    route.fulfill({ response: res, body: (await res.text()).replace("<title>Atril</title>", "<title>Atril nueva</title>") });
  });
  // al navegar, el navegador revisa sw.js, instala el nuevo y este toma el control (puede tardar una navegación más)
  await expect.poll(async () => {
    await page.reload();
    return page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return r.active && r.active.state === "activated" && !r.installing && !r.waiting && (await caches.keys()).join(); });
  }, { intervals: [500], timeout: 15_000 }).toBe("atril-v2");
  // con el service worker anterior esto no pasaba nunca; con el nuevo, al recargar
  await expect.poll(async () => { await page.reload(); return page.title(); }, { intervals: [500], timeout: 10_000 }).toBe("Atril nueva");
});

test("sin conexión abre la app y los sonidos ya usados", async ({ page, context }) => {
  await installed(page);
  await page.evaluate(() => loadSound("piano"));
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => typeof score !== "undefined" && document.querySelector("#pages svg"));
  await expect(page.locator("#docname")).toHaveText("Himno a la alegría");
  // banco nuevo en memoria, leído desde la caché
  const n = await page.evaluate(async () => { delete banks.piano; await loadSound("piano"); return banks.piano.decoded.length; });
  expect(n).toBe(30);
  expect(await page.evaluate(async () => { await ensurePdf(); return !!window.pdfjsLib; })).toBe(true);
});
