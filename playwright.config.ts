import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e/browser",
  use: {
    baseURL: "http://127.0.0.1:3101",
  },
  webServer: {
    command: "bun run start",
    env: { PORT: "3101" },
    reuseExistingServer: false,
    url: "http://127.0.0.1:3101",
  },
});
