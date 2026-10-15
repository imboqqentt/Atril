// Pruebas de la app de escritorio (Windows). Se corren con: npm run test:escritorio
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests-escritorio",
  timeout: 60_000,
  workers: 1,
});
