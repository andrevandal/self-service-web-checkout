import { expect, mock, test } from "bun:test";
import { sql } from "drizzle-orm";
import { createTestDatabase, mockDatabaseModule, withStartContext } from "#/test/db-test-support";

const db = await createTestDatabase();
await db.run(sql`
  INSERT INTO kiosks (id, name, prefix) VALUES
    ('kiosk-b', 'Beta kiosk', 'B'),
    ('kiosk-a', 'Alpha kiosk', 'A')
`);

const responseHeaders = new Map<string, string>();
let requestCookie = "";
mockDatabaseModule(db);
mock.module("#/env.server", () => ({
  serverEnv: {
    KIOSK_CLAIM_PASSWORD: "setup-secret",
    KIOSK_COOKIE_SECRET: "cookie-secret",
    KIOSK_COOKIE_SECURE: false,
  },
}));
mock.module("@tanstack/react-start/server", () => ({
  getRequestHeader: () => requestCookie,
  setResponseHeader: (name: string, value: string) => responseHeaders.set(name, value),
}));

const { listKiosksHandler, claimKioskHandler, verifySetupPasswordHandler } =
  await import("./kiosk.functions.server");
const { setKioskCookie, signKioskCookie, verifyKioskCookie, readKioskCookie } =
  await import("./kiosk-cookie.server");

test("kiosk cookies sign, verify, and reject tampering", () => {
  const payload = { kioskId: "kiosk-a", issuedAt: 1_754_672_000_000 };
  const token = signKioskCookie(payload, "cookie-secret");
  expect(verifyKioskCookie(token, "cookie-secret")).toEqual(payload);
  expect(verifyKioskCookie(`${token}x`, "cookie-secret")).toBeNull();
  expect(verifyKioskCookie("not-a-token", "cookie-secret")).toBeNull();
});

test("kiosk cookie attributes honor the secure toggle", () => {
  const payload = { kioskId: "kiosk-a", issuedAt: 1_754_672_000_000 };
  setKioskCookie(payload, "cookie-secret", false);
  expect(responseHeaders.get("Set-Cookie")).toMatch(
    /^kiosk_session=.+; HttpOnly; SameSite=Lax; Path=\/$/,
  );

  setKioskCookie(payload, "cookie-secret", true);
  expect(responseHeaders.get("Set-Cookie")).toMatch(
    /^kiosk_session=.+; HttpOnly; SameSite=Lax; Path=\/; Secure$/,
  );
});

test("readKioskCookie preserves the complete token after the first equals sign", () => {
  const token = signKioskCookie(
    { kioskId: "kiosk-a", issuedAt: 1_754_672_000_000 },
    "cookie-secret",
  );
  requestCookie = `other=value; kiosk_session=${token}; trailing=value`;
  expect(readKioskCookie("cookie-secret")).toEqual({
    kioskId: "kiosk-a",
    issuedAt: 1_754_672_000_000,
  });
});

test("listKiosks returns every kiosk ordered by name then id", async () => {
  const kiosks = await withStartContext(() => listKiosksHandler());
  expect(kiosks).toEqual([
    { id: "kiosk-a", name: "Alpha kiosk", prefix: "A" },
    { id: "kiosk-b", name: "Beta kiosk", prefix: "B" },
  ]);
});

test("verifySetupPassword accepts the correct shared password", async () => {
  await expect(
    withStartContext(() => verifySetupPasswordHandler({ password: "setup-secret" })),
  ).resolves.toEqual({ valid: true });
});

test("verifySetupPassword rejects the wrong shared password", async () => {
  await expect(
    withStartContext(() => verifySetupPasswordHandler({ password: "wrong" })),
  ).rejects.toMatchObject({ code: "invalid_password" });
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
