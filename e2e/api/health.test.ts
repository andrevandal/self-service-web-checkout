import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "bun:test";

let baseUrl = "";
let child: Bun.Subprocess;
let databaseDirectory = "";
let databasePath = "";
beforeAll(async () => {
  const port = 3100 + Math.floor(Math.random() * 1000);
  baseUrl = `http://127.0.0.1:${port}`;
  databaseDirectory = await mkdtemp(join(tmpdir(), "scaffold-health-"));
  databasePath = join(databaseDirectory, "runtime.db");
  child = Bun.spawn([process.execPath, "run", "start"], {
    env: { PORT: String(port), DATABASE_URL: `file:${databasePath}` },
    stdout: "ignore",
    stderr: "inherit",
  });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) {
        return;
      }
    } catch {
      // server not ready
    }
    // Poll real child-process startup; fake timers cannot observe network readiness.
    await Bun.sleep(100);
  }
  throw new Error("Server did not become ready");
});
afterAll(async () => {
  child.kill();
  await child.exited;
  await rm(databaseDirectory, { force: true, recursive: true });
});

test("health endpoint reports database connectivity", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(
    expect.objectContaining({
      status: "ok",
      uptime: expect.any(Number),
      timestamp: expect.any(String),
    }),
  );
});

test("uses the database URL supplied when the server starts", async () => {
  expect(await Bun.file(databasePath).exists()).toBe(true);
});
