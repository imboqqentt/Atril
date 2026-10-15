// Pruebas de la app de escritorio (Windows). Se corren con: npm run test:escritorio
import { defineConfig } from "@playwright/test";

export default defineConfig({
  // en GitHub Actions, cada error queda como anotación visible sin iniciar sesión
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  testDir: "tests-escritorio",
  timeout: 90_000,
  workers: 1,
});
