// Copia a una carpeta solo lo que usa la app (sin pruebas, skills, node_modules ni src-tauri).
// La usan GitHub Pages y la app de escritorio (Tauri). Uso: node tools/armar-sitio.mjs [carpeta=dist]
import { cpSync, rmSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, process.argv[2] || "dist");
const FILES = ["index.html", "sw.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "CREDITS.md", "fonts", "vendor", "snd", "ejemplos"];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const f of FILES) cpSync(join(ROOT, f), join(OUT, f), { recursive: true });
console.log(`Sitio armado en ${OUT}`);
