import { defineConfig } from "@playwright/test";

const PORT = 8123;
export default defineConfig({
  // en GitHub Actions, cada error queda como anotación visible sin iniciar sesión
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  testDir: "tests",
  timeout: 30_000,
  use: { baseURL: `http://localhost:${PORT}/`, browserName: "chromium", serviceWorkers: "block" },
  webServer: { command: `node tests/serve.mjs ${PORT}`, url: `http://localhost:${PORT}/`, reuseExistingServer: true },
});
