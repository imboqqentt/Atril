import { defineConfig } from "@playwright/test";

const PORT = 8123;
export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  use: { baseURL: `http://localhost:${PORT}/`, browserName: "chromium", serviceWorkers: "block" },
  webServer: { command: `node tests/serve.mjs ${PORT}`, url: `http://localhost:${PORT}/`, reuseExistingServer: true },
});
