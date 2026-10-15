// Abre Atril con internet bloqueado: cualquier pedido fuera de localhost se corta y queda anotado.
// También junta los errores de consola y de página para que cada prueba los revise.
export async function openAtril(page, url = "/") {
  const external = [], errors = [];
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "localhost" || u.protocol === "data:" || u.protocol === "blob:") return route.continue();
    external.push(u.href);
    return route.abort();
  });
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(() => typeof score !== "undefined" && score && document.querySelector("#pages svg"));
  return { external, errors };
}

// Partitura mínima con las marcas dadas: una voz, compases de 4/4 llenos de negras.
export function scoreWithMarks(measures, marks) {
  const notes = [];
  for (let m = 0; m < measures; m++) for (let b = 0; b < 4; b++) notes.push({ d: "q", dots: 0, rest: false, tie: false, keys: [{ s: "C", a: 0, o: 5 }] });
  return { id: "t", title: "Prueba", composer: "", tempo: 120, time: "4/4", key: 0, changes: [], marks, layout: { staff: 6, perSystem: 0 }, groups: [],
    staves: [{ name: "", clef: "treble", voices: [{ name: "", notes }] }] };
}
