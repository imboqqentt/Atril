import { test, expect } from "@playwright/test";
import { openAtril } from "./helpers.mjs";

// Atril como artefacto de claude.ai: se simula window.claude con capacidades falsas (base de datos en memoria,
// usuario, descargas y lectura con Claude). Así se prueba la capa del artefacto sin publicar nada.
async function fakeClaude(page, { owner = true, seed = {}, omr = null } = {}) {
  await page.addInitScript(({ owner, seed, omr }) => {
    const store = JSON.parse(JSON.stringify(seed)); // ruta de colección → { id: datos }
    const subs = {};
    const snap = (path, field) => ({ docs: Object.entries(store[path] || {}).sort((a, b) => String(b[1][field] || "").localeCompare(String(a[1][field] || ""))).map(([id, d]) => ({ id, data: () => d })) });
    const notify = (path) => (subs[path] || []).forEach((f) => f());
    const collection = (path) => ({
      doc: (id) => ({
        async set(o) { (store[path] ||= {})[id] = JSON.parse(JSON.stringify(o)); notify(path); },
        async get() { const d = (store[path] || {})[id]; return { exists: !!d, data: () => d }; },
        async delete() { delete (store[path] || {})[id]; notify(path); },
      }),
      orderBy(field) {
        const q = { limit: () => q, get: async () => snap(path, field), onSnapshot(cb) { (subs[path] ||= []).push(() => cb(snap(path, field))); setTimeout(() => cb(snap(path, field)), 0); return () => {}; } };
        return q;
      },
    });
    window.__store = store; window.__saved = []; window.__prompts = [];
    const caps = {
      db: { collection },
      user: { isOwner: async () => owner, id: async () => "u_yo" },
      downloads: { save: async ({ filename, data }) => { window.__saved.push({ filename, size: data.size || data.length || data.byteLength || 0 }); return { status: "saved" }; } },
      sample: omr && { limits: async () => ({ maxPromptBytes: 262144, images: { maxCount: 4 } }), json: async (prompt, opts) => { window.__prompts.push({ len: prompt.length, images: (opts.images || []).length }); return omr; } },
    };
    window.claude = { use: (name) => new Promise((r) => setTimeout(() => r(caps[name] || null), 50)) };
  }, { owner, seed, omr });
}
const himno = (title) => ({ id: "s_otra", title, composer: "", tempo: 90, time: "3/4", key: 0, changes: [], marks: {}, layout: { staff: 6, perSystem: 0 }, groups: [],
  staves: [{ name: "", clef: "treble", voices: [{ name: "", notes: [{ d: "h", dots: 1, rest: false, tie: false, keys: [{ s: "G", a: 0, o: 4 }] }] }] }] });

test("Guardar va a «Mis partituras» y después se guarda solo con cada cambio", async ({ page }) => {
  await fakeClaude(page, { seed: { "data/users/u_yo": { s_otra: { title: "Gratitud", composer: "", updatedAt: "2026-10-17T17:58:01Z", data: JSON.stringify(himno("Gratitud")) } } } });
  const { errors } = await openAtril(page);
  await page.waitForFunction(() => cloud.lib && cloud.downloads);
  await page.locator("#desk").focus();
  await page.keyboard.press("Control+s");
  await expect(page.locator("#savestate")).toHaveText("Guardado en tu cuenta");
  const id = await page.evaluate(() => score.id);
  expect(await page.evaluate((id) => JSON.parse(window.__store["data/users/u_yo"][id].data).title, id)).toBe("Himno a la alegría");

  // un cambio queda pendiente y se guarda solo a los 2,5 s
  await page.fill("#pTitle", "Himno editado"); await page.locator("#desk").focus();
  await expect(page.locator("#savestate")).toHaveText("Cambios sin guardar");
  await expect(page.locator("#savestate")).toHaveText("Guardado en tu cuenta", { timeout: 6000 });
  expect(await page.evaluate((id) => window.__store["data/users/u_yo"][id].title, id)).toBe("Himno editado");

  // Abrir muestra Mis partituras y abre una
  await page.click("#bOpen");
  await expect(page.locator("#cloudList .libitem")).toHaveCount(2);
  await page.locator("#cloudList .libitem", { hasText: "Gratitud" }).locator(".open").click();
  await expect(page.locator("#docname")).toHaveText("Gratitud");
  await expect(page.locator("#savestate")).toHaveText("Guardado en tu cuenta");

  // Guardar como entrega una copia .atril por la capacidad de descargas
  await page.keyboard.press("Control+Shift+S");
  await expect.poll(() => page.evaluate(() => window.__saved.map((x) => x.filename))).toEqual(["gratitud.atril"]);
  expect(errors).toEqual([]);
});

test("el dueño comparte en este Atril; el enlace abre Atril web", async ({ page }) => {
  await fakeClaude(page);
  await openAtril(page);
  await page.waitForFunction(() => cloud.db && cloud.lib);
  await page.click("#bShare");
  await expect(page.locator("#modal")).toContainText("En este Atril");
  expect(await page.inputValue("#shLink")).toMatch(/^https:\/\/imboqqentt\.github\.io\/Atril\/#s=/);
  await page.click('#modal [data-x="shOn"]');
  await expect(page.locator("#toast")).toContainText("Compartida");
  const id = await page.evaluate(() => score.id);
  expect(await page.evaluate((id) => JSON.parse(window.__store.shared[id].data).title, id)).toBe("Himno a la alegría");
  expect(await page.evaluate((id) => !!window.__store["data/users/u_yo"][id], id)).toBe(true); // también queda en su cuenta

  await page.click("#bShare");
  await page.click('#modal [data-x="shOff"]');
  await expect.poll(() => page.evaluate((id) => !!window.__store.shared[id], id)).toBe(false);
});

test("quien llega por el enlace ve la última partitura compartida", async ({ page }) => {
  await fakeClaude(page, { owner: false, seed: { shared: { s_otra: { title: "Fui La Razón", composer: "Dottie Rambo", updatedAt: "2026-10-16T23:39:14Z", data: JSON.stringify(himno("Fui La Razón")) } } } });
  const { errors } = await openAtril(page);
  await expect(page.locator("#docname")).toHaveText("Fui La Razón");
  await expect(page.locator("#toast")).toContainText("compartida contigo");
  await page.click("#bShare");
  await expect(page.locator("#modal")).toContainText("Compartidas en este Atril");
  await expect(page.locator('#modal [data-x="shOn"]')).toHaveCount(0); // solo el dueño comparte
  expect(errors).toEqual([]);
});

test("las descargas pasan por la capacidad de claude.ai", async ({ page }) => {
  await fakeClaude(page);
  await openAtril(page);
  await page.waitForFunction(() => cloud.downloads);
  await page.click("#bFile"); await page.click('#mFile [data-act="pdf"]');
  await expect.poll(() => page.evaluate(() => window.__saved.map((x) => x.filename))).toEqual(["himno-a-la-alegria.pdf"]);
  expect(await page.evaluate(() => window.__saved[0].size)).toBeGreaterThan(10000);
});

test("leer una partitura con Claude", async ({ page }) => {
  const omr = { title: "Leída por Claude", composer: "", tempo: 80, key: 0, time: "4/4", pickup: false,
    staves: [{ name: "", clef: "treble", voices: ["Soprano"] }, { name: "", clef: "bass", voices: ["Bajo"] }],
    systems: [{ staves: [[["C5:w"]], [["C3:w"]]] }, { staves: [[["D5:w"]], [["D3:w"]]] }], warnings: [] };
  await fakeClaude(page, { omr });
  await openAtril(page);
  await page.waitForFunction(() => cloud.sample);
  await expect(page.locator("#omrHint")).toHaveText("Claude la transcribe y la abres para corregir");
  await page.click("#bFile"); await page.click('#mFile [data-act="omr"]');
  await page.setInputFiles("#oFile", "tests-escritorio/fixtures/himno.pdf");
  await expect(page.locator('#modal [data-x="go"]')).toBeEnabled();
  await page.click('#modal [data-x="go"]');
  await expect(page.locator("#modal h3")).toHaveText("Partitura leída", { timeout: 20000 });
  const prompts = await page.evaluate(() => window.__prompts);
  expect(prompts.length).toBe(1);
  expect(prompts[0].images).toBe(3); // encabezado + los 2 sistemas del himno
  await page.click('#modal [data-x="close"]');
  await expect(page.locator("#docname")).toHaveText("Leída por Claude");
});

test("las partituras que la versión anterior guardaba en el navegador siguen apareciendo en Abrir", async ({ page }) => {
  await fakeClaude(page);
  await page.addInitScript(() => { try { localStorage.setItem("atril.biblioteca", JSON.stringify({ s_vieja: { title: "Cuán grande es Él", updatedAt: "2026-10-12T10:00:00Z", data: JSON.stringify({ id: "s_vieja", title: "Cuán grande es Él", tempo: 80, time: "4/4", key: 0, staves: [{ name: "", clef: "treble", voices: [{ name: "", notes: [] }] }] }) } })); } catch (e) {} });
  await openAtril(page);
  await page.click("#bOpen");
  await page.locator("#oldLib .libitem .open").click();
  await expect(page.locator("#docname")).toHaveText("Cuán grande es Él");
});
