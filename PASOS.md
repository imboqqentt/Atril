# Paso a paso: llevar Atril a GitHub y seguir con Claude Code

## 1. Descomprimir
Descomprime `atril-app.zip` en una carpeta fija, por ejemplo `C:\Users\<tú>\Proyectos\atril-app`.

## 2. Probarlo ya (2 minutos)
Doble clic en `iniciar-atril.bat`. Se abre Atril en el navegador (http://localhost:8080).
Si dice que no encuentra Python ni Node, instala Python desde python.org (marca “Add Python to PATH”).

## 3. Crear el repositorio en GitHub
1. En github.com → **New repository** → nombre `atril` → **Private** → sin README → **Create**.
2. En la carpeta de Atril, abre una terminal (clic derecho → “Abrir en terminal”) y ejecuta:
```
git init
git add .
git commit -m "Atril: versión inicial independiente"
git branch -M main
git remote add origin https://github.com/<tu-usuario>/atril.git
git push -u origin main
```
(Si no tienes Git: git-scm.com. La primera vez te pedirá iniciar sesión en GitHub.)

## 4. Abrir Claude Code
En esa misma carpeta, abre Claude Code (app de escritorio → elegir la carpeta, o en la terminal: `claude`).
Claude Code lee `CLAUDE.md` solo: ahí está el mapa del código y el plan por fases.

## 5. Mensaje para pegarle a Claude Code
Copia y pega esto tal cual:

> Lee CLAUDE.md. Vamos con la Fase 1: deja Atril funcionando 100% local y sin nada de `window.claude`.
> 1. Sirve la carpeta y verifica en un navegador que carga sin errores de consola y sin pedir nada a internet (fuentes, vendor, snd, worker de pdf.js).
> 2. Quita o aísla el código de la plataforma Claude (db, compartir por base de datos, lectura con IA vía sample) y los mensajes que mencionan Claude.
> 3. Cambia “Mis partituras” por guardar/abrir archivos `.atril` (File System Access API con respaldo de descarga) + lista de recientes, con Ctrl+S / Ctrl+O.
> 4. Agrega pruebas con Playwright para: cargar, transponer, exportar e importar MusicXML ida y vuelta, y `playOrder` con repeticiones y D.S. al Coda.
> Haz commits pequeños por cada paso y muéstrame el resultado antes de pasar a la Fase 2.

## 6. Fases siguientes (mensajes cortos)
- **Fase 2:** “Sigue con la Fase 2 de CLAUDE.md: enlace para compartir con la partitura comprimida en el enlace y publicación en GitHub Pages.”
- **Fase 3:** “Fase 3: empaqueta Atril con Tauri 2 para Windows, con abrir/guardar nativo y asociación de archivos .atril.”
- **Fase 4:** “Fase 4: integra Audiveris para leer PDF a MusicXML desde la app de escritorio.”

## 7. Lectura de PDF con Claude (opcional, mientras tanto)
La skill está en `skills/leer-partitura/SKILL.md`. Para usarla en claude.ai: comprime esa carpeta en .zip y súbela en la sección de Skills de la configuración (o pídele a Claude que te la instale). Luego en un chat: “lee esta partitura para Atril” + el PDF.
(El botón para importar ese archivo en Atril se agrega en la Fase 4; hasta entonces pídele a Claude que te entregue MusicXML.)

## Qué contiene
- `index.html` — Atril completo, ya sin CDN: todo carga desde la carpeta.
- `vendor/`, `fonts/`, `snd/` — librerías, fuentes y 190 sonidos.
- `ejemplos/` — “Fui La Razón” y el Himno de ejemplo, listos para importar.
- `CLAUDE.md` — instrucciones y plan para Claude Code.
