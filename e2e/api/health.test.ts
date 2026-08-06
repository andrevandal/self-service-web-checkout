import { afterAll, beforeAll, expect, test } from "bun:test";

let child: Bun.Subprocess;
let baseUrl = "";
beforeAll(async () => {
  const port = 3100 + Math.floor(Math.random() * 1000);
  baseUrl = `http://127.0.0.1:${port}`;
  child = Bun.spawn([process.execPath, "run", "start"], {
    env: { PORT: String(port) },
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
afterAll(() => child.kill());

test("health endpoint records a ping", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(
    expect.objectContaining({ ok: true, ping: expect.any(Object) }),
  );
});
