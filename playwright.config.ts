import { defineConfig } from "@playwright/test";

export default defineConfig({
  workers: 1,
  testDir: "e2e/browser",
  webServer: [
    {
      command: "PORT=3101 bun .output-e2e-abandonment/server/index.mjs",
      url: "http://127.0.0.1:3101",
      timeout: 30_000,
      reuseExistingServer: false,
    },
    {
      command: "PORT=3102 bun .output-e2e-core/server/index.mjs",
      url: "http://127.0.0.1:3102",
      timeout: 30_000,
      reuseExistingServer: false,
    },
  ],
  projects: [
    {
      name: "abandonment",
      testMatch: /abandonment-ux\.spec\.ts/,
      use: { baseURL: "http://127.0.0.1:3101" },
    },
    {
      name: "core",
      testIgnore: /abandonment-ux\.spec\.ts/,
      use: { baseURL: "http://127.0.0.1:3102" },
    },
  ],
});
