import { expect, mock, test } from "bun:test";
import { runWithStartContext } from "@tanstack/start-storage-context";
import { sql } from "drizzle-orm";
import { createDatabase } from "#/db/client";

const db = createDatabase("file::memory:");
await db.run(sql`
  CREATE TABLE kiosks (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL UNIQUE
  )
`);
await db.run(sql`
  INSERT INTO kiosks (id, name, prefix) VALUES
    ('kiosk-b', 'Beta kiosk', 'B'),
    ('kiosk-a', 'Alpha kiosk', 'A')
`);

const responseHeaders = new Map<string, string>();
mock.module("#/db/client.server", () => ({ db }));
mock.module("#/env.server", () => ({
  serverEnv: {
    KIOSK_CLAIM_PASSWORD: "setup-secret",
    KIOSK_COOKIE_SECRET: "cookie-secret",
    KIOSK_COOKIE_SECURE: false,
  },
}));
mock.module("@tanstack/react-start/server", () => ({
  setResponseHeader: (name: string, value: string) => responseHeaders.set(name, value),
}));

const { listKiosksHandler, claimKioskHandler } = await import("./kiosk.functions");

const withStartContext = <T>(handler: () => Promise<T>) =>
  runWithStartContext(
    {
      getRouter: async () => {
        throw new Error("router is not needed for direct server-function execution");
      },
      request: new Request("http://localhost"),
      startOptions: {},
      contextAfterGlobalMiddlewares: {},
      executedRequestMiddlewares: new Set(),
      handlerType: "serverFn",
    },
    handler,
  );

test("listKiosks returns every kiosk ordered by name then id", async () => {
  const kiosks = await withStartContext(() => listKiosksHandler());
  expect(kiosks).toEqual([
    { id: "kiosk-a", name: "Alpha kiosk", prefix: "A" },
    { id: "kiosk-b", name: "Beta kiosk", prefix: "B" },
  ]);
});

test("claimKiosk rejects the wrong shared password", async () => {
  await expect(
    withStartContext(() => claimKioskHandler({ password: "wrong", kioskId: "kiosk-a" })),
  ).rejects.toMatchObject({ code: "invalid_password" });
});

test("claimKiosk reclaims an existing kiosk and emits a signed cookie", async () => {
  const kiosk = await withStartContext(() =>
    claimKioskHandler({ password: "setup-secret", kioskId: "kiosk-a" }),
  );
  expect(kiosk).toEqual({ id: "kiosk-a", name: "Alpha kiosk", prefix: "A" });
  expect(responseHeaders.get("Set-Cookie")).toMatch(
    /^kiosk_session=.+; HttpOnly; SameSite=Lax; Path=\/$/,
  );
});

test("claimKiosk creates a kiosk and derives an available prefix", async () => {
  const kiosk = await withStartContext(() =>
    claimKioskHandler({ password: "setup-secret", name: "Cedar counter" }),
  );
  expect(kiosk.name).toBe("Cedar counter");
  expect(kiosk.prefix).toBe("C");
});

test("claimKiosk accepts a supplied normalized prefix and rejects duplicates", async () => {
  const kiosk = await withStartContext(() =>
    claimKioskHandler({ password: "setup-secret", name: "Dessert", prefix: " d2 " }),
  );
  expect(kiosk.prefix).toBe("D2");
  await expect(
    withStartContext(() =>
      claimKioskHandler({ password: "setup-secret", name: "Duplicate", prefix: "a" }),
    ),
  ).rejects.toMatchObject({ code: "prefix_taken" });
});

test("claimKiosk validates creation input and existing ids", async () => {
  await expect(
    withStartContext(() => claimKioskHandler({ password: "setup-secret" })),
  ).rejects.toMatchObject({ code: "invalid_input" });
  await expect(
    withStartContext(() => claimKioskHandler({ password: "setup-secret", kioskId: "missing" })),
  ).rejects.toMatchObject({ code: "kiosk_not_found" });
});
