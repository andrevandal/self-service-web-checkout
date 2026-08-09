import { defineConfig } from "@playwright/test";

// PW_PROJECT scopes both `webServer` and `projects` to a single leg so CI can
// run "core" and "abandonment" as independent, parallel matrix jobs - each
// only builds and boots its own server, with no shared state or contention
// against the other leg. Unset (local `bun run test:e2e`) runs both, as before.
const target = process.env.PW_PROJECT;

const abandonmentServer = {
  command: "PORT=3101 bun .output-e2e-abandonment/server/index.mjs",
  url: "http://127.0.0.1:3101",
  timeout: 30_000,
  reuseExistingServer: false,
};
const coreServer = {
  command: "PORT=3102 bun .output-e2e-core/server/index.mjs",
  url: "http://127.0.0.1:3102",
  timeout: 30_000,
  reuseExistingServer: false,
};
const abandonmentProject = {
  name: "abandonment",
  testMatch: /abandonment-ux\.spec\.ts/,
  use: { baseURL: "http://127.0.0.1:3101" },
};
const coreProject = {
  name: "core",
  testIgnore: /abandonment-ux\.spec\.ts/,
  use: { baseURL: "http://127.0.0.1:3102" },
};

export default defineConfig({
  workers: 1,
  testDir: "e2e/browser",
  webServer:
    target === "core"
      ? [coreServer]
      : target === "abandonment"
        ? [abandonmentServer]
        : [abandonmentServer, coreServer],
  projects:
    target === "core"
      ? [coreProject]
      : target === "abandonment"
        ? [abandonmentProject]
        : [abandonmentProject, coreProject],
});
