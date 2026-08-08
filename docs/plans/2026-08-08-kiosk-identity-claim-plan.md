# Kiosk identity and claim Implementation Plan

> **For agentic workers:** Execute this plan task-by-task in this worktree. Each task follows red-green-refactor and ends with a focused check.

**Goal:** Add the `kiosks` persistence model, stateless HMAC kiosk cookie, and `listKiosks()`/`claimKiosk()` TanStack Start server functions.

**Architecture:** Keep kiosk identity in a three-field `kiosks` table and expose it through named server functions only. `claimKiosk` validates the shared setup password, selects or creates a row, and emits an HttpOnly signed cookie; the cookie helper contains no database lookup or session state. Tests use the existing in-memory libSQL plus mocked TanStack Start context and response headers.

**Tech Stack:** Bun test, TypeScript, TanStack Start `createServerFn`, Drizzle ORM/libSQL, Valibot, Node `crypto` HMAC-SHA256, Drizzle SQLite migrations.

## Global Constraints

- Follow `main/docs/PRD.md` kiosk identity requirements and decisions as authoritative.
- Keep the boundary to named `createServerFn` functions; do not add an `/api/*` route.
- Kiosks contain only `id`, `name`, and unique `prefix`; do not add session, heartbeat, order-sequence, or online columns.
- Use `KIOSK_CLAIM_PASSWORD` as the shared claim gate and `KIOSK_COOKIE_SECRET` as the server-only HMAC secret.
- Parse `KIOSK_COOKIE_SECURE` as a boolean with default `false`; add `Secure` to `kiosk_session` only when it is true. Never require the `__Host-` prefix.
- Cookie is `kiosk_session=<token>; HttpOnly; SameSite=Lax; Path=/`, optionally followed by `; Secure`; do not set `Max-Age`.
- New kiosk creation requires a nonblank name and accepts an optional one-to-five-character ASCII alphanumeric prefix; omitted prefixes are derived uniquely from the name.
- Use integer/text conventions already present in `src/db/schema.ts`; do not add dependencies.
- Run only focused Bun tests while iterating; run the full requested checks once after implementation.

---

### Task 1: Write the failing kiosk identity test

**Files:**
- Create: `src/lib/kiosk.functions.test.ts`
- Test setup: in-memory `file::memory:` libSQL database and mocked modules

**Interfaces:**
- Consumes: the approved public contract `listKiosks(): Promise<Kiosk[]>` and `claimKiosk({ data: ClaimKioskInput }): Promise<Kiosk>` once implementation exists.
- Produces: executable red assertions that lock the response shape, validation, persistence, and cookie behavior before implementation.

- [ ] **Step 1: Create an isolated database and test response-header capture.**

Create the `kiosks` table directly in the test before importing the implementation, matching the eventual migration:

```ts
import { expect, mock, test } from "bun:test";
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
```

Use the same `runWithStartContext` object used by `src/lib/catalog.functions.test.ts` when invoking extracted handlers; the context request is `new Request("http://localhost")` and `handlerType` is `"serverFn"`.

- [ ] **Step 2: Add concrete failing assertions for list, claim, errors, and cookies.**

Cover the observable contract with tests equivalent to:

```ts
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
  expect(responseHeaders.get("Set-Cookie")).toMatch(/^kiosk_session=.+; HttpOnly; SameSite=Lax; Path=\/$/);
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
    withStartContext(() => claimKioskHandler({ password: "setup-secret", name: "Duplicate", prefix: "a" })),
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
```

The helper `withStartContext` must use `runWithStartContext` exactly as the catalog test does; it is test-only and does not become production code. Add direct cookie-helper assertions in the same colocated test after the helper exists: decode the emitted payload, assert `kioskId`/numeric `issuedAt`, verify it with the configured secret, assert a one-character signature tamper returns `null`, and cover both `KIOSK_COOKIE_SECURE=false` and `true` attribute output.

- [ ] **Step 3: Run the focused test and record the red result.**

Run:

```bash
bun test src/lib/kiosk.functions.test.ts
```

Expected: **FAIL** because `src/lib/kiosk.functions.ts` and its schema/helper dependencies do not exist yet. Do not weaken or skip the assertions to obtain a pass.

- [ ] **Step 4: Commit the red test.**

```bash
git add src/lib/kiosk.functions.test.ts
git commit -m "test(kiosk-identity): define claim contracts"
```

---

### Task 2: Add environment fields, kiosk schema, and migration

**Files:**
- Modify: `src/env.ts`
- Modify: `.env.example`
- Modify: `src/env.test.ts`
- Modify: `src/db/schema.ts`
- Create via Drizzle: `drizzle/0002_*.sql` and matching `drizzle/meta/*`

**Interfaces:**
- Consumes: no new application interfaces; preserve existing env defaults and schema exports.
- Produces: `serverEnv.KIOSK_CLAIM_PASSWORD`, `serverEnv.KIOSK_COOKIE_SECRET`, `serverEnv.KIOSK_COOKIE_SECURE`, and exported `kiosks` Drizzle table with `id`, `name`, and unique `prefix`.

- [ ] **Step 1: Extend server env parsing without making app startup depend on claim configuration.**

Add optional fields to `serverEnvFields`, keeping claim/signing configuration fail-closed in the handler while permitting normal app startup:

```ts
KIOSK_CLAIM_PASSWORD: v.optional(v.string(), ""),
KIOSK_COOKIE_SECRET: v.optional(v.string(), ""),
KIOSK_COOKIE_SECURE: v.pipe(
  v.optional(v.union([v.boolean(), v.string()]), false),
  v.transform((value) => (typeof value === "string" ? value === "true" : value)),
),
```

Update `.env.example` with `KIOSK_CLAIM_PASSWORD=`, `KIOSK_COOKIE_SECRET=`, and `KIOSK_COOKIE_SECURE=false`. Extend `src/env.test.ts` to assert both unset strings parse as empty, configured strings are preserved, the secure flag defaults false, string `true` parses true, and string `false` parses false.

- [ ] **Step 2: Add the exact three-column Drizzle table.**

In `src/db/schema.ts`, add:

```ts
export const kiosks = sqliteTable("kiosks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  prefix: text("prefix").notNull().unique(),
});
```

Do not add timestamps, status flags, order counters, or cookie/session fields.

- [ ] **Step 3: Generate and inspect the migration.**

Run:

```bash
bun run db:generate
```

Inspect the generated SQL and ensure it creates only `kiosks` with a unique prefix index. If Drizzle emits unrelated changes, stop and correct the schema before continuing; do not hand-wave extra tables into the migration.

- [ ] **Step 4: Run schema/env focused tests.**

Run:

```bash
bun test src/env.test.ts src/db/client.test.ts
```

Expected: PASS, with the new env assertions proving defaults/coercion and the database smoke test still green.

- [ ] **Step 5: Commit the persistence/configuration slice.**

```bash
git add src/env.ts src/env.test.ts .env.example src/db/schema.ts drizzle
git commit -m "feat(kiosk-identity): add kiosk schema and config"
```

---

### Task 3: Implement and test the stateless kiosk cookie helper

**Files:**
- Create: `src/lib/kiosk-cookie.server.ts`
- Extend: `src/lib/kiosk.functions.test.ts`

**Interfaces:**
- Consumes: `KIOSK_COOKIE_SECRET` and `KIOSK_COOKIE_SECURE` from the server function plus TanStack Start `setResponseHeader`/`getRequestHeader` utilities.
- Produces: `KioskCookiePayload`, `signKioskCookie(payload, secret)`, `verifyKioskCookie(token, secret)`, `readKioskCookie(secret)`, and `setKioskCookie(payload, secret, secure)`.

- [ ] **Step 1: Add helper-focused red assertions.**

Before implementation, assert that a signed token verifies to the exact `{ kioskId, issuedAt }` payload, a changed payload/signature returns `null`, malformed base64/JSON returns `null`, and `setKioskCookie` emits exactly `HttpOnly; SameSite=Lax; Path=/` when secure is false and adds one `; Secure` attribute when true. Assert that no output uses `__Host-` or `Max-Age`. Also assert `readKioskCookie` splits only at the first `=` so base64 padding cannot truncate a value.

- [ ] **Step 2: Implement HMAC signing and verification with Node standard crypto.**

Use `createHmac("sha256", secret)` and base64url encoding via `Buffer.toString("base64url")`. Keep signing canonical:

```ts
export type KioskCookiePayload = { kioskId: string; issuedAt: number };

export function signKioskCookie(payload: KioskCookiePayload, secret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}
```

`verifyKioskCookie` must split into exactly two segments, recompute the MAC, compare equal-length decoded signature bytes with `timingSafeEqual`, parse JSON, and reject empty/non-string ids or non-finite/non-positive `issuedAt`. The helper must not query the database. `readKioskCookie` reads the `cookie` request header and returns the matching `kiosk_session` value or `null`; `setKioskCookie` calls `setResponseHeader("Set-Cookie", `kiosk_session=${token}; HttpOnly; SameSite=Lax; Path=/${secure ? "; Secure" : ""}`)`.

- [ ] **Step 3: Run the focused helper tests.**

Run:

```bash
bun test src/lib/kiosk.functions.test.ts
```

Expected: helper assertions pass while the server-function assertions remain red until Task 4.

- [ ] **Step 4: Commit the cookie helper.**

```bash
git add src/lib/kiosk-cookie.server.ts src/lib/kiosk.functions.test.ts
git commit -m "feat(kiosk-identity): sign kiosk session cookies"
```

---

### Task 4: Implement `listKiosks()` and `claimKiosk()`

**Files:**
- Create: `src/lib/kiosk.functions.ts`
- Extend: `src/lib/kiosk.functions.test.ts`

**Interfaces:**
- Consumes: `kiosks` table, `serverEnv`, and cookie helper from Tasks 2–3.
- Produces: `Kiosk`, `ClaimKioskInput`, `KioskClaimError`, `listKiosks`, `listKiosksHandler`, `claimKiosk`, and `claimKioskHandler` with the exact signatures in the design spec.

- [ ] **Step 1: Define the public types and typed error.**

Add:

```ts
export type Kiosk = { id: string; name: string; prefix: string };
export type ClaimKioskInput = {
  password: string;
  kioskId?: string;
  name?: string;
  prefix?: string;
};
type KioskClaimErrorCode =
  | "invalid_password"
  | "configuration"
  | "invalid_input"
  | "kiosk_not_found"
  | "prefix_taken";
export class KioskClaimError extends Error {
  constructor(public readonly code: KioskClaimErrorCode, message: string) {
    super(message);
    this.name = "KioskClaimError";
  }
}
```

Use a Valibot object validator for the server function input (`password` required string, other fields optional strings) so malformed RPC data is rejected before domain logic.

- [ ] **Step 2: Implement deterministic listing.**

Implement `listKiosksHandler` with a single Drizzle select projected to `{ id, name, prefix }`, ordered by `asc(kiosks.name)` then `asc(kiosks.id)`. Wrap it exactly as:

```ts
export const listKiosks = createServerFn({ method: "GET" }).handler(listKiosksHandler);
```

Database errors must propagate; do not turn failures into an empty list.

- [ ] **Step 3: Implement password/configuration validation.**

Before any database read/write in `claimKioskHandler`, reject empty `serverEnv.KIOSK_CLAIM_PASSWORD` or `serverEnv.KIOSK_COOKIE_SECRET` with `KioskClaimError("configuration", ...)`. Compare the supplied password to the configured password using SHA-256 digests and `timingSafeEqual` so differing lengths do not create a comparison branch. Reject wrong passwords with code `invalid_password`.

- [ ] **Step 4: Implement existing-kiosk reclaim.**

When `kioskId` is present, query by id. Throw `kiosk_not_found` when no row exists; ignore `name` and `prefix` on this branch. Call `setKioskCookie({ kioskId: kiosk.id, issuedAt: Date.now() }, serverEnv.KIOSK_COOKIE_SECRET, serverEnv.KIOSK_COOKIE_SECURE)` only after the row is found, then return the projected Kiosk.

- [ ] **Step 5: Implement new-kiosk creation and prefix uniqueness.**

When `kioskId` is absent, trim and require `name`. Normalize a supplied prefix with `trim().toUpperCase()` and require `/^[A-Z0-9]{1,5}$/`. For an omitted prefix, normalize the name to ASCII alphanumeric uppercase, try progressively longer prefixes up to five characters, then try numeric suffixes that remain at most five characters; query existing prefixes before each candidate and throw `invalid_input` only if no candidate can be generated. Pre-check a supplied prefix and throw `prefix_taken` if already present. Insert `crypto.randomUUID()`, the trimmed name, and chosen prefix; map a SQLite unique-prefix failure from a concurrent insert to `prefix_taken` while rethrowing other database errors. Set the cookie only after the insert succeeds and return the inserted row.

- [ ] **Step 6: Wrap the mutation as the named server function.**

Use the approved boundary:

```ts
export const claimKiosk = createServerFn({ method: "POST" })
  .validator((input) => parseClaimKioskInput(input))
  .handler(({ data }) => claimKioskHandler(data));
```

`claimKioskHandler` remains exported for the colocated in-memory test; the wrapper is what frontend code imports and invokes as `claimKiosk({ data: input })`.

- [ ] **Step 7: Run all kiosk tests green and refactor only after the pass.**

Run:

```bash
bun test src/lib/kiosk.functions.test.ts
```

Expected: PASS for listing, password/configuration/input errors, existing reclaim, new creation/derived prefix, duplicate prefixes, both secure-cookie modes, payload verification, and tamper rejection. Refactor only naming/duplication after this green result, then rerun the same command.

- [ ] **Step 8: Commit the server-function slice.**

```bash
git add src/lib/kiosk.functions.ts src/lib/kiosk.functions.test.ts
 git commit -m "feat(kiosk-identity): add kiosk claim functions"
```

---

### Task 5: Final verification, documentation sync, and handoff

**Files:**
- Verify: all files from Tasks 1–4 and generated migration metadata
- Update: `GOAL.md` completion log after checks pass

**Interfaces:**
- Consumes: complete kiosk identity implementation and exact contracts already sent to `KioskUi-2`.
- Produces: green repository checks, committed completion log, and handoff status to `Main`.

- [ ] **Step 1: Run the required final checks once.**

Run exactly:

```bash
bun run lint && bun run format && bun run typecheck && bun run test
```

Expected: each command exits zero. If a check fails, fix the source and rerun the complete chain; do not claim completion from a narrowed test alone.

- [ ] **Step 2: Verify the migration contains only the intended kiosk table.**

Inspect the generated migration and confirm its SQL has one `CREATE TABLE kiosks` and one unique prefix index, with no heartbeat/session/order fields. Confirm `src/db/schema.ts` matches the SQL columns.

- [ ] **Step 3: Update the goal completion log.**

Append a dated entry to `GOAL.md` recording the design/plan/implementation commit hashes, public server-function signatures, cookie name/flags (including the `KIOSK_COOKIE_SECURE` toggle), HMAC mechanism, and final check command. Do not rewrite the existing spec 1 history.

- [ ] **Step 4: Commit the goal log.**

```bash
git add GOAL.md
git commit -m "docs(kiosk-identity): record spec completion"
```

- [ ] **Step 5: Send final handoff.**

Message `Main` over `hub` with the implementation commit(s), migration path, exact signatures, red→green focused test evidence, and final check output. Message `KioskUi-2` again only if any implementation detail differs from the already-sent contract; otherwise the earlier contract message remains authoritative.
