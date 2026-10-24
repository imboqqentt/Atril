// Arma index.html para publicarlo como artefacto de claude.ai (https://claude.ai/artifact/MCd6RU94PhsQUnpLhMvyr8).
// Uso: node tools/armar-artefacto.mjs  → dist-artefacto/index.html
//
// El artefacto pone su propio <!doctype>/<head>/<body> y solo deja cargar scripts de CDN conocidas y fuentes de
// Google Fonts, así que aquí se quita la envoltura y las librerías locales (vendor/, fonts/) se cambian por las
// mismas versiones en CDN. Los sonidos (snd/) ya están publicados en el artefacto con las mismas rutas.
// La capa de claude.ai (Mis partituras, compartir, descargas, lectura con Claude) está en index.html y se activa sola.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, "dist-artefacto");
const CDN = {
  "vendor/vexflow.js": "https://cdn.jsdelivr.net/npm/vexflow@4.2.5/build/cjs/vexflow.js",
  "vendor/jspdf.umd.min.js": "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  "vendor/jszip.min.js": "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
  "vendor/mp4-muxer.js": "https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.js",
  "vendor/webm-muxer.js": "https://cdn.jsdelivr.net/npm/webm-muxer@5.1.4/build/webm-muxer.js",
  "vendor/lame.min.js": "https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js",
  "vendor/pdf.min.js": "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  "vendor/pdf.worker.min.js": "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
};
const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Libre+Caslon+Text:ital,wght@0,400;0,700;1,400&display=swap">`;

const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
let body = html.match(/<body>([\s\S]*)<\/body>/)[1];

const must = (cond, what) => { if (!cond) throw new Error("No encontré " + what + " en index.html: revisa tools/armar-artefacto.mjs"); };
const title = head.match(/<title>[\s\S]*?<\/title>/); must(title, "<title>");
const metaUrl = head.match(/<meta name="atril-url"[^>]*>/); must(metaUrl, '<meta name="atril-url">');
const styles = head.match(/<style>[\s\S]*<\/style>/); must(styles, "<style>");

for (const [local, url] of Object.entries(CDN)) {
  const n = body.split(`"${local}"`).length - 1;
  must(n > 0, local);
  body = body.split(`"${local}"`).join(`"${url}"`);
}
must(!/(src|href)="(vendor|fonts)\//.test(body), "todas las rutas de vendor/ y fonts/ cambiadas");
body = body.replace(/<script>if \("serviceWorker" in navigator[^\n]*<\/script>\n?/, ""); // el artefacto no admite service workers

const page = [title[0], '<meta name="claude:viewport-fit-sides" content="cover">', metaUrl[0], FONTS, styles[0], body.trim(), ""].join("\n");
mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, "index.html"), page);
console.log(`Artefacto armado en ${resolve(OUT, "index.html")} (${Math.round(page.length / 1024)} KB)`);
