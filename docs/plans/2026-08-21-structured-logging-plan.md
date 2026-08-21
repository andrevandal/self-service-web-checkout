# Structured logging with consola Implementation Plan

> **For agentic workers:** Execute this plan task-by-task in this worktree. Task 1 creates the logger every other task imports. Tasks 2–6 instrument the server, and Tasks 7 and 10 instrument the two screens Track A never touches (`kiosk-claim-screen.tsx`, `kitchen-screen.tsx`); all of those may run once Task 1 is green, with no Track A dependency. Tasks 8 and 9 instrument the customer journey and must wait until Track A's Task 11 completes (see the Sequencing note). Steps use checkbox (`- [ ]`) syntax for tracking. Each task ends with a focused check and a commit; do not batch commits across tasks.

**Goal:** Add `consola`-based tagged/sub-tagged structured logging across the real kiosk data and user flow — backend server functions, the kitchen SSE transport, and every frontend touch point named in `GOAL.md` item 18 (setup, menu/cart, checkout, kitchen, idle abandonment — spread across more files than five once Track A's route split lands) — without changing any user-visible behavior or any existing PostHog capture.

**Architecture:** One isomorphic module, `src/lib/logger.ts`, exports `resolveLogLevel`, `createLogger`, and a configured `logger` built with `createConsola`. consola's package export map resolves the terminal build under Node/Bun and the browser build in the client bundle, so no server/client split is needed. Each module creates its tag once at module scope (`logger.withTag("payment")`) plus hoisted sub-scopes (`log.withTag("reconcile")` → `payment:reconcile`). Server modules that throw typed errors route every rejection through one module-private factory that logs and returns the error, so the visible `throw` and control-flow analysis stay unchanged. Level comes from `LOG_LEVEL` (server, runtime) or `VITE_LOG_LEVEL` (client, build-time), both declared in `src/env.ts` and both defaulting to `info`.

**Tech Stack:** Bun, TypeScript, `consola@3.4.2`, `@vite-env/core` + Valibot env declaration, TanStack Start `createServerFn`, TanStack Query, Drizzle ORM/libSQL, `bun test`, Playwright (existing suites only).

## Global Constraints

- The design contract is `docs/specs/2026-08-21-structured-logging-design.md`; `GOAL.md` item 18 is the accepted intent. Do not invent alternate tags, levels, or touch points.
- Every log call is **additive**. Do not change, remove, reorder, or gate any existing control flow, return value, thrown error, error code, error message, response status, or `captureDomainEvent` call.
- Never make a log call conditional on PostHog being configured, and never make a `captureDomainEvent` call conditional on a log level. consola must never become an analytics transport (no custom reporter, no log shipping).
- Exact tag strings — no others: `kiosk`, `kiosk:session`, `kiosk:verify-password`, `kiosk:list`, `kiosk:claim`, `catalog`, `order:create`, `payment:start`, `payment:reconcile`, `payment:expire`, `kitchen:claim`, `kitchen:session`, `kitchen:list`, `kitchen:advance`, `kitchen:sse`, `ui:setup`, `ui:menu`, `ui:menu:cart`, `ui:menu:checkout`, `ui:checkout`, `ui:checkout:phase`, `ui:kitchen`, `ui:kitchen:sse`, `ui:idle`.
- Level policy: `success` = user/business action completed (kiosk claimed, order paid, order marked done, item added to cart); `info` = lifecycle milestone (order created, payment attempt started, SSE client connected, checkout phase change); `warn` = recoverable/expected-but-notable (payment declined, idle warning shown, attempt expired, wrong setup password, empty catalog, rejected input); `error` = exception or configuration/consistency failure (missing secret, receipt mismatch, otherwise-silent catch block); `debug` = verbose payload/state (request shapes, computed amounts, SSE listener counts, row counts).
- Rejection-level rule: a typed error code the UI renders as recoverable copy logs at `warn`; the `configuration` code and any non-typed exception logs at `error`.
- Accepted `LOG_LEVEL` / `VITE_LOG_LEVEL` values, exactly: `silent`, `error`, `warn`, `info` (default), `debug`, `trace`, `verbose`.
- Always pass an explicit `level` to `createConsola`. consola's Node factory defaults to `warn` in test-like environments and honors `CONSOLA_LEVEL`; the explicit option must win.
- Create `withTag` scopes at module scope only. Never call `withTag` inside a request handler, loop, or React render — it allocates a full Consola instance.
- Never log a password value, cookie secret, or signed cookie. Log ids, counts, amounts, statuses, and existing human-readable error details only. Cart contents and request payloads are `debug`-only and reduced to counts/ids.
- `src/lib/logger.ts` must not import `src/env.server.ts` or `virtual:env/server`. That module is server-only (top-level `await`) and would break TanStack Start import protection in the client graph.
- Write the client env read as a plain member access, `import.meta.env.VITE_LOG_LEVEL`, so Vite's static replacement applies (same form as `src/lib/use-abandonment.ts:47`).
- Do not add a new `e2e/browser/*.spec.ts` spec and do not assert on console output in Playwright: that would bind the browser suite to consola's `%c` badge formatting and to log copy. Frontend proof is the unchanged e2e suite plus the documented manual dev-console walkthrough in Task 11.
- Tests assert on `{ tag, type }` plus a stable id/substring in the payload. Never assert full formatted output, and never assert a call count for a repeated identical message — consola throttles identical messages (`throttle: 1000`, `throttleMin: 5`).
- Reporters and level are inherited by `withTag` children **at creation time**. A collecting reporter must be installed before the module under test is imported, using the repo's existing `mock.module(...)`-then-`await import(...)` ordering.
- `scripts/affected-tests.ts` maps `foo.ts` → `foo.test.ts` only, so `src/routes/api/kitchen/-events.test.ts` and every `.tsx` file are invisible to the `pre-push` hook. Run those suites explicitly where a task says so.
- Track A gate, stated identically in the Sequencing note and in each affected task header: Tasks 1–6, 7, and 10 have **no Track A dependency**. Tasks 8 and 9 run only after **Track A's Task 11** (final integration/reconciliation) completes. Never gate 8/9 on an earlier Track A task.
- Log payload field names are **camelCase**, matching the source objects (`PaymentOutcomeEvent`, `transactionResult.event`) — `amountCents`, `attemptCount`, `elapsedMs`, `failureReason`, `subtotalCents`, `issuedAt`, `secondsRemaining`, `idleDurationMs`. The snake_case names in `toPaymentEventProperties` (`payment.functions.server.ts:124-142`) are the PostHog wire format only; no log call passes through that mapper.
- Conventional Commits with a scope, per `AGENTS.md`. Never bypass hooks.
- Run the full `bun run lint && bun run format && bun run typecheck && bun run test && bun run build` sequence once, in Task 11 — not per task.

## Sequencing note

Track A (`GOAL.md` items 1–17, its own design/plan pair) rewrites some of the UI files this track annotates. Item 8 moves search, item details, and checkout onto real routes (`/search?q=`, `/details?id=`, `/pay?step=`) behind a shell layout route; items 5, 6, 7, 10, 11, and 13 rewrite `menu-screen.tsx` and the payment screens further. Track A never edits `src/components/kiosk-claim-screen.tsx` or `src/components/kitchen-screen.tsx`.

- Tasks 1–6 (backend, `src/lib/logger.ts`, `src/env.ts`, docs) touch no file Track A edits and may land in parallel with Track A at any time.
- Tasks 7 (`kiosk-claim-screen.tsx`) and 10 (`kitchen-screen.tsx`) have **no Track A dependency** — Track A never touches either file — so they run in the same wave as Tasks 1–6.
- Tasks 8 (menu/cart/details instrumentation) and 9 (`checkout-screen.tsx` plus `use-abandonment.ts` instrumentation) **must wait until Track A's Task 11 (final integration and reconciliation) completes** — not merely until Track A's Task 7 or its item 8 nav split. Track A Task 11 is where it deletes dead code, drops stale exports and selectors, and re-runs route generation, so instrumenting earlier risks targeting call sites Task 11 then deletes or moves again. If a listed call site has still moved by then, instrument the equivalent site in the new structure and record the substitution in `GOAL.md`; do not skip it.
- Only non-UI overlap risk: `src/env.ts` and its generated `vite-env.d.ts`. Track A has confirmed it plans no env change. If it adds a `VITE_*` key anyway, the two additions are independent keys and `vite-env.d.ts` is regenerated by any `bun run dev` / `bun run build`.

---

### Task 1: Logger module, env keys, and documentation

**Files:**
- Create: `src/lib/logger.ts`
- Create: `src/lib/logger.test.ts`
- Create: `src/test/logger-test-support.ts`
- Modify: `src/env.ts`
- Modify: `src/env.test.ts`
- Modify: `vite-env.d.ts` (regenerated, committed)
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/deployment.md`
- Modify: `package.json` and `bun.lock` (via `bun add consola`)

**Interfaces:**
- Consumes: `createConsola`, `LogLevels`, `type LogObject`, `type ConsolaInstance` from `consola`; `v.picklist` from Valibot; `process.env.LOG_LEVEL`; `import.meta.env.VITE_LOG_LEVEL`.
- Produces: `resolveLogLevel(name: string | undefined): number`, `createLogger(levelName?: string): ConsolaInstance`, `logger: ConsolaInstance`, `type LogLevelName` from `#/lib/logger`; `captureLogs(): { records: LogRecord[]; reset: () => void; find: (tag: string, type: string) => LogRecord[] }` from `#/test/logger-test-support`; validated `LOG_LEVEL` / `VITE_LOG_LEVEL` env fields.

- [ ] **Step 1: Promote consola to a direct dependency.**

```bash
bun add consola
```

Expected: `package.json` `dependencies` gains `"consola": "3.4.2"` (it is already resolved at `3.4.2` in `bun.lock` as a transitive dependency of `nitro`), and `bun.lock` gains the direct entry. If the resolved version is not `3.4.2`, stop and report — the design's verified behavior is pinned to that version.

- [ ] **Step 2: Write the failing logger unit test.**

Create `src/lib/logger.test.ts`:

```ts
import { expect, test } from "bun:test";
import { LogLevels, type LogObject } from "consola";
import { createLogger, resolveLogLevel } from "./logger";

const collector = (levelName?: string) => {
  const records: LogObject[] = [];
  const instance = createLogger(levelName);
  instance.setReporters([{ log: (logObj: LogObject) => records.push(logObj) }]);
  return { instance, records };
};

test("resolveLogLevel defaults to info for missing or unknown names", () => {
  expect(resolveLogLevel(undefined)).toBe(LogLevels.info);
  expect(resolveLogLevel("")).toBe(LogLevels.info);
  expect(resolveLogLevel("chatty")).toBe(LogLevels.info);
});

test("resolveLogLevel maps every accepted level name", () => {
  expect(resolveLogLevel("silent")).toBe(LogLevels.silent);
  expect(resolveLogLevel("error")).toBe(LogLevels.error);
  expect(resolveLogLevel("warn")).toBe(LogLevels.warn);
  expect(resolveLogLevel("info")).toBe(LogLevels.info);
  expect(resolveLogLevel("debug")).toBe(LogLevels.debug);
  expect(resolveLogLevel("trace")).toBe(LogLevels.trace);
  expect(resolveLogLevel("verbose")).toBe(LogLevels.verbose);
});

test("withTag composes nested sub-scopes with a colon", () => {
  const { instance, records } = collector("debug");
  instance.withTag("payment").withTag("reconcile").info("approved");
  instance.withTag("kitchen").withTag("sse").debug("listeners", 2);

  expect(records.map((record) => record.tag)).toEqual(["payment:reconcile", "kitchen:sse"]);
});

test("info level keeps success and suppresses debug", () => {
  const { instance, records } = collector("info");
  const log = instance.withTag("order").withTag("create");
  log.success("order paid");
  log.info("order created");
  log.warn("order rejected");
  log.error("configuration missing");
  log.debug("payload");

  expect(records.map((record) => record.type)).toEqual(["success", "info", "warn", "error"]);
  expect(records.every((record) => record.tag === "order:create")).toBe(true);
});

test("debug level emits debug records", () => {
  const { instance, records } = collector("debug");
  instance.withTag("catalog").debug("menu loaded", { categoryCount: 4 });

  expect(records).toHaveLength(1);
  expect(records[0]?.level).toBe(LogLevels.debug);
});

test("silent level suppresses everything", () => {
  const { instance, records } = collector("silent");
  const log = instance.withTag("kiosk");
  log.error("configuration missing");
  log.success("kiosk claimed");

  expect(records).toEqual([]);
});
```

- [ ] **Step 3: Run the test to verify it fails.**

Run: `bun test src/lib/logger.test.ts`
Expected: FAIL — module `./logger` cannot be resolved.

- [ ] **Step 4: Implement the logger module.**

Create `src/lib/logger.ts`:

```ts
import { createConsola, LogLevels } from "consola";

export type LogLevelName = "silent" | "error" | "warn" | "info" | "debug" | "trace" | "verbose";

const DEFAULT_LOG_LEVEL: LogLevelName = "info";

export const resolveLogLevel = (name: string | undefined): number =>
  name && name in LogLevels ? LogLevels[name as LogLevelName] : LogLevels[DEFAULT_LOG_LEVEL];

const configuredLogLevelName = (): string | undefined =>
  (typeof process === "undefined" ? undefined : process.env.LOG_LEVEL) ||
  import.meta.env.VITE_LOG_LEVEL;

export const createLogger = (levelName?: string) =>
  createConsola({ level: resolveLogLevel(levelName) });

export const logger = createLogger(configuredLogLevelName());
```

Do not add reporters, formatters, or a wrapper API: consola selects Fancy in an interactive terminal, Basic in CI/non-interactive stdout, and Browser in the client automatically.

- [ ] **Step 5: Run the test to verify it passes.**

Run: `bun test src/lib/logger.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Declare both env variables.**

In `src/env.ts`, add to `serverEnvFields` (beside `POSTHOG_HOST`):

```ts
  LOG_LEVEL: v.optional(
    v.picklist(["silent", "error", "warn", "info", "debug", "trace", "verbose"]),
    "info",
  ),
```

and to `clientEnvFields`:

```ts
  VITE_LOG_LEVEL: v.optional(
    v.picklist(["silent", "error", "warn", "info", "debug", "trace", "verbose"]),
  ),
```

Server boot then fails fast on a mistyped `LOG_LEVEL`, exactly as the existing `DATABASE_URL` regex does; `resolveLogLevel` still falls back to `info` for the client, which has no boot validation.

- [ ] **Step 7: Add the env regression tests.**

Append to `src/env.test.ts`:

```ts
test("defaults LOG_LEVEL to info", () => {
  expect(parseServerEnv({}).LOG_LEVEL).toBe("info");
});

test("rejects an unsupported LOG_LEVEL", () => {
  expect(() => parseServerEnv({ LOG_LEVEL: "chatty" })).toThrow();
});
```

Run: `bun test src/env.test.ts`
Expected: PASS with the existing cases plus these two.

- [ ] **Step 8: Regenerate the committed env declaration file.**

`vite-env.d.ts` is regenerated by the `@vite-env/core` plugin on every dev-server start and build. Regenerate it now:

```bash
bun run build
```

Expected: `vite-env.d.ts` now declares `VITE_LOG_LEVEL` under `virtual:env/client` and `LOG_LEVEL` plus `VITE_LOG_LEVEL` under `virtual:env/server`. Commit the regenerated file; it is auto-generated but tracked.

- [ ] **Step 9: Add the shared logger test helper.**

Create `src/test/logger-test-support.ts`, mirroring the existing `src/test/db-test-support.ts` convention:

```ts
import { LogLevels, type LogObject } from "consola";
import { logger } from "#/lib/logger";

export type LogRecord = {
  tag: string;
  type: string;
  args: unknown[];
};

// Reporters and level are inherited by `withTag` children at creation time, so
// this must run before the module under test is imported.
export const captureLogs = () => {
  const records: LogRecord[] = [];
  logger.level = LogLevels.debug;
  logger.setReporters([
    {
      log: (logObj: LogObject) => {
        records.push({ tag: logObj.tag ?? "", type: logObj.type, args: logObj.args });
      },
    },
  ]);

  return {
    records,
    reset: () => {
      records.length = 0;
    },
    find: (tag: string, type: string) =>
      records.filter((record) => record.tag === tag && record.type === type),
  };
};
```

- [ ] **Step 10: Document the two variables.**

In `.env.example`, after the `PORT` line:

```dotenv
# silent | error | warn | info | debug | trace | verbose
LOG_LEVEL=info
```

and beside the commented client block:

```dotenv
# VITE_LOG_LEVEL=info
```

In `README.md`, inside `## First-time setup` after the "Copied sample values are development-only…" bullet, add:

```markdown
- Log verbosity is `LOG_LEVEL` on the server and `VITE_LOG_LEVEL` in the browser
  bundle (`silent`, `error`, `warn`, `info` — the default —, `debug`, `trace`,
  `verbose`). Use `debug` to see request payloads, computed amounts, and kitchen
  SSE listener counts.
```

In `docs/deployment.md`, in the paragraph beginning "The compose examples require an initialized database" (`:57-65`), extend the variable list sentence so it reads that compose also reads `LOG_LEVEL`, and add: `LOG_LEVEL` is optional and defaults to `info`; `VITE_LOG_LEVEL` is build-time only and must be set when building the client bundle, not at container start. Do not hand-edit `CHANGELOG.md` — it is release-please-generated.

- [ ] **Step 11: Commit the logger foundation.**

```bash
git add package.json bun.lock src/lib/logger.ts src/lib/logger.test.ts src/test/logger-test-support.ts src/env.ts src/env.test.ts vite-env.d.ts .env.example README.md docs/deployment.md docs/specs/2026-08-21-structured-logging-design.md docs/plans/2026-08-21-structured-logging-plan.md
git commit -m "feat(logging): add isomorphic consola logger and level config"
```

---

### Task 2: Instrument the kiosk server functions

**Files:**
- Modify: `src/lib/kiosk.functions.server.ts`
- Test: `src/lib/kiosk.functions.test.ts`

**Interfaces:**
- Consumes: `logger` from `#/lib/logger`; `type ConsolaInstance` from `consola`; existing `KioskClaimError`, `KioskClaimErrorCode`.
- Produces: `kiosk:session`, `kiosk:verify-password`, `kiosk:list`, `kiosk:claim` records; module-private `kioskRejection(scope, code, detail): KioskClaimError`. No exported signature changes.

- [ ] **Step 1: Write the failing spy assertions.**

At the very top of `src/lib/kiosk.functions.test.ts`, before the existing module mocks and dynamic imports, add the capture (keep the file's existing mock/import ordering intact — `captureLogs()` must run before `await import("./kiosk.functions.server")`):

```ts
import { captureLogs } from "#/test/logger-test-support";

const logs = captureLogs();
```

Then add two tests beside the existing claim tests, reusing that file's existing setup helpers for a configured password and a seeded kiosk:

```ts
test("logs a warn when the claim password is wrong", async () => {
  logs.reset();
  await expect(claimKioskHandler({ password: "wrong", name: "Front" })).rejects.toThrow();

  const records = logs.find("kiosk:claim", "warn");
  expect(records).toHaveLength(1);
  expect(String(records[0]?.args[0])).toContain("invalid_password");
});

test("logs a success record when a kiosk is claimed", async () => {
  logs.reset();
  const kiosk = await claimKioskHandler({ password: PASSWORD, name: "Front Counter" });

  const records = logs.find("kiosk:claim", "success");
  expect(records).toHaveLength(1);
  expect(records[0]?.args[1]).toMatchObject({ kioskId: kiosk.id, created: true });
});
```

Use the file's existing constant for the configured password instead of `PASSWORD` if it is named differently; do not change any existing mock or assertion.

- [ ] **Step 2: Run the test to verify it fails.**

Run: `bun test src/lib/kiosk.functions.test.ts`
Expected: FAIL — both new tests report zero matching records.

- [ ] **Step 3: Add the tag scopes and the rejection factory.**

In `src/lib/kiosk.functions.server.ts`, add the imports and, directly below the `KioskClaimError` class, the scopes and factory:

```ts
import type { ConsolaInstance } from "consola";
import { logger } from "#/lib/logger";

const log = logger.withTag("kiosk");
const sessionLog = log.withTag("session");
const verifyLog = log.withTag("verify-password");
const listLog = log.withTag("list");
const claimLog = log.withTag("claim");

const kioskRejection = (
  scope: ConsolaInstance,
  code: KioskClaimErrorCode,
  detail: string,
): KioskClaimError => {
  const message = `kiosk rejected: ${code}`;
  if (code === "configuration") {
    scope.error(message, { detail });
  } else {
    scope.warn(message, { detail });
  }
  return new KioskClaimError(code, detail);
};
```

- [ ] **Step 4: Route every typed rejection through the factory.**

Replace each `throw new KioskClaimError(...)` with the factory, keeping the code and detail strings byte-identical:

```ts
// verifySetupPasswordHandler
throw kioskRejection(verifyLog, "configuration", "Kiosk claim is not configured");
throw kioskRejection(verifyLog, "invalid_password", "Invalid kiosk claim password");

// selectPrefix and claimKioskHandler
throw kioskRejection(claimLog, "invalid_input", "Prefix must be 1-5 letters or digits");
throw kioskRejection(claimLog, "prefix_taken", "That kiosk prefix is already in use");
throw kioskRejection(claimLog, "invalid_input", "Unable to derive a unique kiosk prefix");
throw kioskRejection(claimLog, "configuration", "Kiosk claim is not configured");
throw kioskRejection(claimLog, "invalid_password", "Invalid kiosk claim password");
throw kioskRejection(claimLog, "kiosk_not_found", "Kiosk not found");
throw kioskRejection(claimLog, "invalid_input", "Kiosk name is required");
```

Leave the bare `throw new Error("Kiosk insert did not return a row")` and the `isUniquePrefixError` re-throw path structurally unchanged; the unique-prefix branch already converts to `prefix_taken`, so use the factory there too.

- [ ] **Step 5: Add the success and debug records.**

```ts
// getKioskSessionHandler — after resolving the cookie/row
if (!payload) {
  sessionLog.debug("no kiosk session cookie");
  return null;
}
// …after the query
sessionLog.debug("kiosk session resolved", { kioskId: kiosk ? kiosk.id : null });

// verifySetupPasswordHandler — before `return { valid: true }`
verifyLog.info("setup password verified");

// listKiosksHandler — before `return rows.map(toKiosk)`
listLog.debug("kiosks listed", { count: rows.length });

// claimKioskHandler — before each of the two `return result` statements
claimLog.success("kiosk claimed", { kioskId: result.id, prefix: result.prefix, created: false });
claimLog.success("kiosk claimed", { kioskId: result.id, prefix: result.prefix, created: true });
```

- [ ] **Step 6: Run the test to verify it passes.**

Run: `bun test src/lib/kiosk.functions.test.ts`
Expected: PASS — every pre-existing test plus the two new ones.

- [ ] **Step 7: Commit the kiosk slice.**

```bash
git add src/lib/kiosk.functions.server.ts src/lib/kiosk.functions.test.ts
git commit -m "feat(logging): instrument kiosk server functions"
```

---

### Task 3: Instrument the catalog server function

**Files:**
- Modify: `src/lib/catalog.functions.server.ts`
- Test: `src/lib/catalog.functions.test.ts`

**Interfaces:**
- Consumes: `logger` from `#/lib/logger`.
- Produces: `catalog` records (`warn` for an empty catalog stage, `debug` for loaded counts). `loadMenu`'s signature and return value are unchanged.

- [ ] **Step 1: Write the failing spy assertion.**

At the top of `src/lib/catalog.functions.test.ts`, before its existing mocks and dynamic import:

```ts
import { captureLogs } from "#/test/logger-test-support";

const logs = captureLogs();
```

Insert this new test **immediately after** the existing test named `getMenu returns no categories when no active categories exist` (`src/lib/catalog.functions.test.ts:107-110`) and **before** the test named `getMenu returns active categories with empty products when none are available` (`:112`). Position is load-bearing: the first of those tests runs `DELETE FROM categories`, and the second re-inserts a category, so anywhere after the second test the catalog is populated again and the `warn` never fires. Do not move or modify either existing test.

Wrap `loadMenu()` in `withStartContext`, as every existing call in that file does (`:40`, `:109`, `:124`) — it is already imported there from `#/test/db-test-support`; calling `loadMenu()` bare fails outside a TanStack Start context:

```ts
test("warns when the catalog has no active categories", async () => {
  logs.reset();
  await withStartContext(() => loadMenu());

  expect(logs.find("catalog", "warn")).toHaveLength(1);
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `bun test src/lib/catalog.functions.test.ts`
Expected: FAIL — zero `catalog`/`warn` records.

- [ ] **Step 3: Add the tag and the three records.**

```ts
import { logger } from "#/lib/logger";

const log = logger.withTag("catalog");
```

```ts
// after the categories query
if (categoryRows.length === 0) {
  log.warn("catalog has no active categories");
  return { categories: [] };
}

// inside the existing zero-product early return
log.warn("catalog has no available products", { categoryCount: categoryRows.length });

// immediately before the final populated return
log.debug("menu loaded", {
  categoryCount: categoryRows.length,
  productCount: productRows.length,
});
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `bun test src/lib/catalog.functions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the catalog slice.**

```bash
git add src/lib/catalog.functions.server.ts src/lib/catalog.functions.test.ts
git commit -m "feat(logging): instrument catalog menu load"
```

---

### Task 4: Instrument order creation

**Files:**
- Modify: `src/lib/order.functions.server.ts`
- Test: `src/lib/order.functions.test.ts`

**Interfaces:**
- Consumes: `logger` from `#/lib/logger`; existing `CreateOrderError`, `CreateOrderErrorCode`.
- Produces: `order:create` records; module-private `orderRejection(code, detail): CreateOrderError`. `createOrderHandler`'s signature, result, and thrown codes are unchanged.

- [ ] **Step 1: Write the failing spy assertions.**

At the top of `src/lib/order.functions.test.ts`, before its existing mocks and dynamic import:

```ts
import { captureLogs } from "#/test/logger-test-support";

const logs = captureLogs();
```

Add two tests using the suite's existing seeded-catalog helpers:

```ts
test("logs an info record when an order is created", async () => {
  logs.reset();
  const order = await createOrderHandler(validSingleLineInput);

  const records = logs.find("order:create", "info");
  expect(records).toHaveLength(1);
  expect(records[0]?.args[1]).toMatchObject({ orderId: order.id, itemCount: 1 });
});

test("logs a warn record when a selection is rejected", async () => {
  logs.reset();
  await expect(createOrderHandler(inputWithUnknownAddon)).rejects.toThrow();

  const records = logs.find("order:create", "warn");
  expect(records).toHaveLength(1);
  expect(String(records[0]?.args[0])).toContain("selection_invalid");
});
```

Reuse the suite's existing input fixtures/builders rather than the placeholder names above.

- [ ] **Step 2: Run the test to verify it fails.**

Run: `bun test src/lib/order.functions.test.ts`
Expected: FAIL — zero matching records for both tests.

- [ ] **Step 3: Add the tag scope and the rejection factory.**

Below the `CreateOrderError` class in `src/lib/order.functions.server.ts`:

```ts
import { logger } from "#/lib/logger";

const createLog = logger.withTag("order").withTag("create");

const orderRejection = (code: CreateOrderErrorCode, detail: string): CreateOrderError => {
  const message = `order rejected: ${code}`;
  if (code === "configuration") {
    createLog.error(message, { detail });
  } else {
    createLog.warn(message, { detail });
  }
  return new CreateOrderError(code, detail);
};
```

- [ ] **Step 4: Route all eleven typed rejections through the factory.**

Replace every `throw new CreateOrderError(code, detail)` in `validateInput` and `createOrderHandler` with `throw orderRejection(code, detail)`, preserving each code/detail pair exactly: `invalid_input` ("Cart must contain valid line items"), `configuration` ("Kiosk cookie secret is not configured"), `kiosk_identity` ("A valid kiosk session is required", "Kiosk session no longer exists"), `catalog_unavailable` ("Product is not available", "Addon is not available"), and `selection_invalid` ("Modifier selections cannot repeat", "Variant selection is not valid", "Variant selection count is not valid", "Addon selection is not valid", "Addon selection count is not valid").

- [ ] **Step 5: Add the entry debug and the success record.**

```ts
// directly after `const data = validateInput(input);`
createLog.debug("order requested", {
  lineCount: data.lines.length,
  itemQuantity: data.lines.reduce((sum, line) => sum + line.quantity, 0),
});
```

```ts
// inside the transaction, immediately before the final `return { id: orderId, … }`
createLog.info("order created", {
  orderId,
  kioskId: cookie.kioskId,
  itemCount: items.length,
  subtotalCents,
});
```

- [ ] **Step 6: Run the test to verify it passes.**

Run: `bun test src/lib/order.functions.test.ts`
Expected: PASS — all pre-existing tests plus the two new ones.

- [ ] **Step 7: Commit the order slice.**

```bash
git add src/lib/order.functions.server.ts src/lib/order.functions.test.ts
git commit -m "feat(logging): instrument order creation"
```

---

### Task 5: Instrument payment start, reconcile, and expiry

**Files:**
- Modify: `src/lib/payment.functions.server.ts`
- Test: `src/lib/payment.functions.test.ts`

**Interfaces:**
- Consumes: `logger` from `#/lib/logger`; `type ConsolaInstance` from `consola`; existing `PaymentAttemptError`, `PaymentAttemptErrorCode`, `PaymentOutcomeEvent`, `transactionResult`.
- Produces: `payment:start`, `payment:reconcile`, `payment:expire` records; module-private `paymentRejection(scope, code, detail): PaymentAttemptError`. Every handler signature, result, thrown code, and `captureDomainEvent` call is unchanged.

- [ ] **Step 1: Write the failing spy assertions.**

At the top of `src/lib/payment.functions.test.ts`, before its existing mocks and dynamic import:

```ts
import { captureLogs } from "#/test/logger-test-support";

const logs = captureLogs();
```

Add three tests reusing the suite's existing approved/declined/mismatched-receipt fixtures:

```ts
test("logs a success record for an approved reconcile", async () => {
  logs.reset();
  const result = await reconcilePaymentAttemptHandler(approvedInput);

  const records = logs.find("payment:reconcile", "success");
  expect(records).toHaveLength(1);
  expect(records[0]?.args[1]).toMatchObject({ attemptId: result.attemptId });
});

test("logs a warn record for a declined reconcile", async () => {
  logs.reset();
  await reconcilePaymentAttemptHandler(declinedInput);

  expect(logs.find("payment:reconcile", "warn")).toHaveLength(1);
});

test("logs an error record for a receipt mismatch", async () => {
  logs.reset();
  await expect(reconcilePaymentAttemptHandler(mismatchedReceiptInput)).rejects.toThrow();

  expect(logs.find("payment:reconcile", "error")).toHaveLength(1);
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `bun test src/lib/payment.functions.test.ts`
Expected: FAIL — zero matching records in all three.

- [ ] **Step 3: Add the tag scopes and the rejection factory.**

Below the `PaymentAttemptError` class:

```ts
import type { ConsolaInstance } from "consola";
import { logger } from "#/lib/logger";

const log = logger.withTag("payment");
const startLog = log.withTag("start");
const reconcileLog = log.withTag("reconcile");
const expireLog = log.withTag("expire");

const paymentRejection = (
  scope: ConsolaInstance,
  code: PaymentAttemptErrorCode,
  detail: string,
): PaymentAttemptError => {
  const message = `payment rejected: ${code}`;
  if (code === "configuration") {
    scope.error(message, { detail });
  } else {
    scope.warn(message, { detail });
  }
  return new PaymentAttemptError(code, detail);
};
```

`expireAttemptInTransaction` is shared by expiry and reconcile; pass `expireLog` for its two rejections, since both callers are terminating an attempt.

- [ ] **Step 4: Route every typed rejection through the factory.**

Replace each `throw new PaymentAttemptError(code, detail)` with `throw paymentRejection(scope, code, detail)`, using `startLog` inside `startPaymentAttemptHandler`, `reconcileLog` inside `reconcilePaymentAttemptHandler`, `expireLog` inside `expirePaymentAttemptHandler` and `expireAttemptInTransaction`. Codes and detail strings stay byte-identical: `configuration`, `kiosk_identity`, `invalid_input`, `order_not_pending`, `attempt_not_found`, `attempt_ownership`, and `attempt_resolved`.

That includes the three input-validator throws, which are covered exactly the way `order.functions.server.ts`'s `validateInput` throw is covered in Task 4 — same tag as their calling handler, `warn` level via the same factory. Each validator has exactly one caller, so its scope is unambiguous:

```ts
// validateStartPaymentAttemptInput (`:168`), called only from startPaymentAttemptHandler (`:220`)
throw paymentRejection(startLog, "invalid_input", "Order id is required");

// validateReconcilePaymentAttemptInput (`:176`), called only from reconcilePaymentAttemptHandler (`:423`)
throw paymentRejection(reconcileLog, "invalid_input", "Attempt receipt is invalid");

// validateExpirePaymentAttemptInput (`:184`), called only from expirePaymentAttemptHandler (`:315`)
throw paymentRejection(expireLog, "invalid_input", "Attempt id is required");
```

`attempt_expired` is deliberately **absent** from the list above: it is not thrown as a rejection anywhere. It, and `receipt_invalid`, are constructed into `ReconcileTransactionResult` (`kind: "terminal-error"`, `:497` and `:512`) rather than thrown at construction time — leave those two `new PaymentAttemptError(...)` expressions exactly as they are. The outcome log in Step 6 covers both, and routing them through the factory would double-log.

- [ ] **Step 5: Log the attempt start and the expiry.**

```ts
// startPaymentAttemptHandler, after the existing captureDomainEvent("payment_attempt_started", …)
startLog.info("payment attempt started", {
  attemptId: transactionResult.result.id,
  orderId: transactionResult.result.orderId,
  method: transactionResult.result.method,
  amountCents: transactionResult.result.expectedAmountCents,
  attemptCount: transactionResult.attemptCount,
});
```

```ts
// expirePaymentAttemptHandler, after the existing captureDomainEvent("order_expired", …)
expireLog.warn("payment attempt expired", {
  attemptId: transactionResult.event.attemptId,
  orderId: transactionResult.event.orderId,
  amountCents: transactionResult.event.amountCents,
  attemptCount: transactionResult.event.attemptCount,
  elapsedMs: transactionResult.event.elapsedMs,
  failureReason: transactionResult.event.failureReason,
});
```

- [ ] **Step 6: Log the single reconcile outcome.**

In `reconcilePaymentAttemptHandler`, insert immediately after the existing `captureDomainEvent("payment_attempt_result", …)` call and **before** the `if (transactionResult.kind === "terminal-error")` throw, so terminal outcomes are logged too:

```ts
const { event } = transactionResult;
const outcome = {
  attemptId: event.attemptId,
  orderId: event.orderId,
  amountCents: event.amountCents,
  attemptCount: event.attemptCount,
  elapsedMs: event.elapsedMs,
  failureReason: event.failureReason,
};
if (event.outcome === "approved") {
  reconcileLog.success("payment approved", {
    ...outcome,
    orderNumber: transactionResult.kind === "result" ? transactionResult.value.orderNumber : null,
  });
} else if (event.outcome === "invalid") {
  reconcileLog.error("payment receipt mismatch", outcome);
} else {
  reconcileLog.warn(`payment ${event.outcome}`, outcome);
}
```

Do not touch the `captureDomainEvent("order_paid", …)` call, the `getKitchenOrderSnapshot` lookup, or the `kitchenEventDispatcher.emit` that follow.

- [ ] **Step 7: Run the test to verify it passes.**

Run: `bun test src/lib/payment.functions.test.ts`
Expected: PASS — all pre-existing tests plus the three new ones.

- [ ] **Step 8: Commit the payment slice.**

```bash
git add src/lib/payment.functions.server.ts src/lib/payment.functions.test.ts
git commit -m "feat(logging): instrument payment attempt lifecycle"
```

---

### Task 6: Instrument kitchen functions, the event dispatcher, and the SSE route

**Files:**
- Modify: `src/lib/kitchen.functions.server.ts`
- Modify: `src/lib/kitchen-events.server.ts`
- Modify: `src/routes/api/kitchen/events.ts`
- Test: `src/lib/kitchen.functions.test.ts`
- Test: `src/routes/api/kitchen/-events.test.ts`

**Interfaces:**
- Consumes: `logger` from `#/lib/logger`; existing `StaffSessionError`, `StaffSessionErrorCode`, `KitchenOrderError`, `KitchenOrderErrorCode`, `KitchenEventDispatcher`.
- Produces: `kitchen:claim`, `kitchen:session`, `kitchen:list`, `kitchen:advance`, `kitchen:sse` records. `subscribe` still returns a zero-argument unsubscribe function typed `() => void`; the route's 401 body/status, `": connected"` payload, heartbeat interval, and headers are unchanged.

- [ ] **Step 1: Write the failing spy assertions.**

At the top of `src/lib/kitchen.functions.test.ts`, before its existing mocks and dynamic import:

```ts
import { captureLogs } from "#/test/logger-test-support";

const logs = captureLogs();
```

```ts
test("logs a success record when an order is marked done", async () => {
  logs.reset();
  await advanceOrderHandler({ orderId: preparingOrderId, toStatus: "done" });

  const records = logs.find("kitchen:advance", "success");
  expect(records).toHaveLength(1);
  expect(records[0]?.args[1]).toMatchObject({ orderId: preparingOrderId });
});
```

At the top of `src/routes/api/kitchen/-events.test.ts`, before its existing `mock.module` calls and dynamic imports:

```ts
import { captureLogs } from "#/test/logger-test-support";

const logs = captureLogs();
```

```ts
test("logs a warn record when the SSE route rejects a request", async () => {
  logs.reset();
  requestCookie = "";
  await getHandler();

  expect(logs.find("kitchen:sse", "warn")).toHaveLength(1);
});

test("logs an info record when an SSE client connects", async () => {
  logs.reset();
  staffCookie();
  const response = await getHandler();
  const reader = response.body!.getReader();
  await reader.read();

  expect(logs.find("kitchen:sse", "info")).toHaveLength(1);
  await reader.cancel();
});
```

- [ ] **Step 2: Run both suites to verify they fail.**

```bash
bun test src/lib/kitchen.functions.test.ts src/routes/api/kitchen/-events.test.ts
```

Expected: FAIL — zero matching records. (`-events.test.ts` is dash-prefixed, so `scripts/affected-tests.ts` never selects it; always name it explicitly.)

- [ ] **Step 3: Add kitchen function scopes and rejection factories.**

Below the `KitchenOrderError` class in `src/lib/kitchen.functions.server.ts`:

```ts
import type { ConsolaInstance } from "consola";
import { logger } from "#/lib/logger";

const log = logger.withTag("kitchen");
const claimLog = log.withTag("claim");
const sessionLog = log.withTag("session");
const listLog = log.withTag("list");
const advanceLog = log.withTag("advance");

const staffRejection = (code: StaffSessionErrorCode, detail: string): StaffSessionError => {
  const message = `staff session rejected: ${code}`;
  if (code === "configuration") {
    claimLog.error(message, { detail });
  } else {
    claimLog.warn(message, { detail });
  }
  return new StaffSessionError(code, detail);
};

const kitchenRejection = (
  scope: ConsolaInstance,
  code: KitchenOrderErrorCode,
  detail: string,
): KitchenOrderError => {
  const message = `kitchen order rejected: ${code}`;
  if (code === "configuration") {
    scope.error(message, { detail });
  } else {
    scope.warn(message, { detail });
  }
  return new KitchenOrderError(code, detail);
};
```

`kitchenRejection` takes its scope as a parameter — the same shape as `kioskRejection` in Task 2 and `paymentRejection` in Task 5 — because its callers span two sub-tags. `staffRejection` stays unparameterized: both of its call sites are inside `claimStaffSessionHandler`, so `claimLog` is the only correct scope.

Call sites:

```ts
// claimStaffSessionHandler `:239`, `:242`
throw staffRejection("configuration", "Staff claim is not configured");
throw staffRejection("invalid_password", "Invalid staff claim password");

// listActiveOrdersHandler `:260-263` — logs under `kitchen:list`, per the design's map
throw kitchenRejection(
  listLog,
  "order_not_found",
  `Active order ${rows[index]?.id ?? "unknown"} is incomplete`,
);

// advanceOrderHandler `:286`, `:291`, `:300` — logs under `kitchen:advance`
throw kitchenRejection(advanceLog, "order_not_found", "Order was not found");
throw kitchenRejection(advanceLog, "invalid_transition", "Order transition is not allowed");
throw kitchenRejection(advanceLog, "invalid_transition", "Order transition is no longer current");
```

Leave the throws inside `requireStaffSession` (`:103`, `:106`) as plain `new StaffSessionError(...)`; they are logged by the guard in Step 4. Every code and detail string above stays byte-identical.

- [ ] **Step 4: Log the shared staff guard, the list, the claim, and the transitions.**

```ts
// requireKitchenStaffSession, inside the existing catch, before each re-throw
sessionLog.error("kitchen staff session rejected: configuration", {
  detail: String(error.cause ?? error.message),
});
// …and for the staff_identity branch
sessionLog.warn("kitchen staff session rejected: staff_identity", {
  detail: String(error.cause ?? error.message),
});
```

```ts
// claimStaffSessionHandler, before `return session`
claimLog.info("staff session claimed", { issuedAt: session.issuedAt });

// listActiveOrdersHandler, before the mapped return
listLog.debug("active orders listed", { count: rows.length });

// advanceOrderHandler, after the existing captureDomainEvent(eventName, …)
if (transition.event.status === "done") {
  advanceLog.success("order marked done", {
    orderId: transition.event.orderId,
    orderNumber: transition.event.orderNumber,
    elapsedMs: Math.max(0, Date.now() - transition.createdAt.getTime()),
  });
} else {
  advanceLog.info("order marked preparing", {
    orderId: transition.event.orderId,
    orderNumber: transition.event.orderNumber,
  });
}
```

Leave `kitchenEventDispatcher.emit(transition.event)` and the returned event untouched.

- [ ] **Step 5: Instrument the event dispatcher.**

In `src/lib/kitchen-events.server.ts`:

```ts
import { logger } from "#/lib/logger";

const log = logger.withTag("kitchen").withTag("sse");
```

```ts
  subscribe(listener: KitchenEventListener): () => void {
    this.listeners.add(listener);
    log.debug("listener subscribed", { listeners: this.listeners.size });
    return () => {
      this.listeners.delete(listener);
      log.debug("listener unsubscribed", { listeners: this.listeners.size });
    };
  }

  emit(event: KitchenOrderEvent): void {
    log.debug("event emitted", {
      type: event.type,
      orderId: event.orderId,
      listeners: this.listeners.size,
    });
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }
```

The unsubscribe closure now has a block body; its declared `() => void` return type is unchanged, so no caller is affected.

- [ ] **Step 6: Instrument the SSE route.**

In `src/routes/api/kitchen/events.ts`:

```ts
import { logger } from "#/lib/logger";

const log = logger.withTag("kitchen").withTag("sse");
```

```ts
        if (!STAFF_COOKIE_SECRET || !readStaffCookie(STAFF_COOKIE_SECRET)) {
          log.warn("sse connection rejected", {
            reason: STAFF_COOKIE_SECRET ? "missing_cookie" : "missing_secret",
          });
          return new Response("Staff session required", { status: 401 });
        }
```

```ts
            enqueue(": connected\n\n");
            log.info("sse client connected");
```

```ts
              } catch {
                closed = true;
                log.debug("sse stream closed on enqueue failure");
                unsubscribe();
```

```ts
          cancel() {
            closed = true;
            log.debug("sse client disconnected");
            unsubscribe();
```

Do not log the five-second heartbeat: an identical repeated message is throttled into a misleading "repeated N times" line and would drown real events.

- [ ] **Step 7: Run both suites to verify they pass.**

```bash
bun test src/lib/kitchen.functions.test.ts src/routes/api/kitchen/-events.test.ts src/components/kitchen-screen.test.ts
```

Expected: PASS — all pre-existing tests plus the three new ones, with the SSE stream contract (`": connected"`, event framing, cleanup on cancel) still asserted unchanged.

- [ ] **Step 8: Commit the kitchen slice.**

```bash
git add src/lib/kitchen.functions.server.ts src/lib/kitchen-events.server.ts src/routes/api/kitchen/events.ts src/lib/kitchen.functions.test.ts src/routes/api/kitchen/-events.test.ts
git commit -m "feat(logging): instrument kitchen queue and SSE transport"
```

---

### Task 7: Instrument the kiosk setup screen

> **No Track A dependency.** Track A never edits `src/components/kiosk-claim-screen.tsx` — its constraints keep kiosk claim behavior, claim cookies, and `window.location.reload()` unchanged. This task may run in the same wave as Tasks 1–6, as soon as Task 1 is green. Do not wait for any Track A task.

**Files:**
- Modify: `src/components/kiosk-claim-screen.tsx`

**Interfaces:**
- Consumes: `logger` from `#/lib/logger`; the component's existing `errorCopy` helper and mutation callbacks.
- Produces: `ui:setup` records. No prop, state, query key, mutation payload, or rendered output changes.

- [ ] **Step 1: Add the tag scope.**

```ts
import { logger } from "#/lib/logger";

const log = logger.withTag("ui").withTag("setup");
```

Place it beside the existing module-level `claimErrorCopy` constant, outside the component, so the instance is created once.

- [ ] **Step 2: Log the password gate.**

```ts
  const continueSetup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!password.trim()) {
      log.warn("setup password missing");
      setPasswordError("Enter the shared setup password to continue.");
      return;
    }
```

In `verifyPasswordMutation`, add to the existing callbacks without changing their behavior:

```ts
    onSuccess: () => {
      log.info("setup password verified");
      setPasswordError(null);
      setSetupReady(true);
    },
    onError: (error) => {
      log.warn("setup password rejected", { reason: String((error as Error).message) });
      setPasswordError(errorCopy(error, "We could not verify that password. Try again."));
    },
```

Never log the `password` state value.

- [ ] **Step 3: Log claim submission, success, and failure.**

```ts
  const claimMutation = useMutation({
    mutationFn: (data: ClaimKioskInput) => claimKiosk({ data }),
    onSuccess: (kiosk) => {
      log.success("kiosk claimed", { kioskId: kiosk.id, prefix: kiosk.prefix });
      void queryClient.invalidateQueries({ queryKey: ["kiosk-session"] });
      window.location.reload();
    },
    onError: (error) => {
      log.warn("kiosk claim failed", { reason: String((error as Error).message) });
    },
  });
```

The `log.success` call must precede `window.location.reload()`, or the record is lost. `onError` is new and log-only; the error copy at the bottom of the component keeps reading `claimMutation.error`.

```ts
  const claimExisting = (kioskId: string) => {
    log.info("claiming existing kiosk", { kioskId });
    setFormError(null);
    claimMutation.mutate({ password, kioskId });
  };
```

- [ ] **Step 4: Log create-kiosk validation and submission.**

```ts
    if (!normalizedName) {
      log.warn("kiosk create rejected locally", { field: "name" });
      setFormError("Enter a name for this kiosk.");
      return;
    }
    if (prefix.trim() && !normalizedPrefix) {
      log.warn("kiosk create rejected locally", { field: "prefix" });
      setFormError("Use 1–5 letters or numbers for the order prefix.");
      return;
    }
    setFormError(null);
    log.info("creating kiosk", { hasPrefix: Boolean(normalizedPrefix) });
```

- [ ] **Step 5: Verify the screen still behaves and typechecks.**

```bash
bun run typecheck
bun run lint
```

Then start the dev server with `VITE_LOG_LEVEL=debug bun run dev`, open `/`, and confirm in the browser console: a `ui:setup` warn for an empty password, an info for a verified password, and a success carrying the kiosk id at claim time — and that the claim still reloads into the menu.

- [ ] **Step 6: Commit the setup-screen slice.**

```bash
git add src/components/kiosk-claim-screen.tsx
git commit -m "feat(logging): instrument kiosk setup screen"
```

---

### Task 8: Instrument cart mutations, product activation, and checkout start

> **Gated on Track A's Task 11.** Every call site below lived in `src/components/menu-screen.tsx` before Track A. Track A relocates all of them: Task 2 moves cart lifecycle into `kiosk-customer-layout.tsx` and the cart markup/remove behavior into `cart-screen.tsx`; Task 3 moves product-card rendering into `product-card.tsx`, the customization UI into `product-details-screen.tsx`, and **deletes `customization-drawer.tsx`**; Task 5 rewrites the menu visuals again. Start this task only after Track A's Task 11 (final integration and reconciliation) has completed, because that is where Track A removes dead local state, drops stale exports/selectors, and re-runs route generation.

**Files:**
- Modify: `src/components/menu-screen.tsx` (the `ProductCard` activation callback: one-tap add and the `/details?id=` navigation)
- Modify: `src/components/product-details-screen.tsx` (customized add)
- Modify: `src/components/cart-screen.tsx` (cart-line removal)
- Modify: `src/components/kiosk-customer-layout.tsx` (`beginCheckout`, `completeCheckout`, idle cart expiry)

If Track A's Task 11 renamed any of these four components, instrument the file that actually owns the named behavior and record the substitution in `GOAL.md`. Do **not** add a call to `src/components/product-card.tsx`: it is a presentational card whose activation callback is supplied per screen, and logging inside it would fire identically for the menu and the search screen.

**Interfaces:**
- Consumes: `logger` from `#/lib/logger`; `useKioskFlow()`'s `cart`, `addCartLine`, `removeCartLine`, `beginCheckout`, `completeCheckout`; `subtotalCents`; TanStack `useNavigate`; `MenuProduct`, `CartLineInput`.
- Produces: `ui:menu`, `ui:menu:cart`, `ui:menu:checkout` records. No cart-reducer action, context value, query key, route search param, navigation target, or rendered output changes.

The three tag strings are unchanged from the design even though the call sites now span four files: `ui:menu:cart` names the cart-mutation domain, not a file. Each file declares only the scopes it uses.

- [ ] **Step 1: Add the tag scopes, once per file, at module scope.**

In `src/components/menu-screen.tsx`, beside its existing module-level helpers, outside the component:

```ts
import { logger } from "#/lib/logger";

const log = logger.withTag("ui").withTag("menu");
const cartLog = log.withTag("cart");
```

In `src/components/product-details-screen.tsx` and `src/components/cart-screen.tsx`, outside the component:

```ts
import { logger } from "#/lib/logger";

const cartLog = logger.withTag("ui").withTag("menu").withTag("cart");
```

In `src/components/kiosk-customer-layout.tsx`, outside the component:

```ts
import { logger } from "#/lib/logger";

const cartLog = logger.withTag("ui").withTag("menu").withTag("cart");
const checkoutLog = logger.withTag("ui").withTag("menu").withTag("checkout");
```

- [ ] **Step 2: Log one-tap add and product activation in `menu-screen.tsx`.**

The menu screen supplies `ProductCard`'s `onActivate` callback. Instrument both of its branches:

```ts
  const activateProduct = (product: MenuProduct) => {
    if (!productHasOptions(product)) {
      cartLog.success("item added to cart", { productId: product.id, name: product.name });
      addCartLine(toCartLineInput(product));
      return;
    }
    log.debug("customization opened", { productId: product.id });
    void navigate({ to: "/details", search: { id: product.id } });
  };
```

Match the real callback and navigation call Track A left in this file — only the two log lines are new. The `log.debug("customization opened", …)` call is the **reassigned** home of the bare `ui:menu` tag: its original site was `customization-drawer.tsx`'s drawer-open path, which Track A deletes outright, and the `/details?id=` navigation is the surviving analog of "the customer opened customization". Keep the message string, level, and payload exactly as above so the tag vocabulary in the Global Constraints stays satisfied; record this substitution in `GOAL.md` per the Sequencing note.

- [ ] **Step 3: Log the customized add in `product-details-screen.tsx`.**

At the add-to-order handler, before it calls `addCartLine` and navigates back:

```ts
    cartLog.success("customized item added to cart", {
      productId: item.productId,
      variantCount: item.variants.length,
      addonCount: item.addons.length,
    });
    addCartLine(item);
```

Do not change the post-add navigation (back when history exists, otherwise replace to `/`), the variant/add-on validation, or the `CartLineInput` mapping.

- [ ] **Step 4: Log cart-line removal in `cart-screen.tsx`.**

At the cart-line remove control's `onClick`:

```tsx
                          onClick={() => {
                            cartLog.info("item removed from cart", {
                              lineId: line.id,
                              productName: line.productName,
                            });
                            removeCartLine(line.id);
                          }}
```

- [ ] **Step 5: Log checkout start and cart clearing in `kiosk-customer-layout.tsx`.**

The layout owns the cart reducer and the flow-context callbacks. Add one record to `beginCheckout` and one to each path that clears the cart — `completeCheckout` and the idle cart-expiry handler passed to `useAbandonment`:

```ts
  const beginCheckout = useCallback(() => {
    checkoutLog.info("checkout started", {
      lineCount: cart.length,
      subtotalCents: subtotalCents(cart),
    });
    // existing snapshot + payment initialization, unchanged
  }, [cart]);
```

```ts
  const completeCheckout = useCallback(() => {
    cartLog.info("cart cleared", { reason: "checkout_complete" });
    // existing reset of cart, checkoutCart, and payment, unchanged
  }, []);
```

```ts
  // the idle cart-expiry callback handed to useAbandonment
    cartLog.info("cart cleared", { reason: "idle_expiry" });
```

Two hard rules here, both about not destabilizing Track A's contract to enrich a log:

- Keep every callback's dependency array exactly as Track A wrote it. `completeCheckout` and the idle-expiry callback feed `useAbandonment` and the memoized flow-context value; adding `cart` to their deps would re-arm the idle timer on every cart change and churn the context identity for every route screen. Those two records therefore carry only the `reason` discriminator — never a line count. The line count is already visible in the preceding `ui:menu:cart` records and in the `ui:idle` record that precedes an idle-triggered clear.
- The two records share the tag and message, so the `reason` field is required, not decoration: consola throttles identical repeated messages, and without a distinguishing field a clear-on-complete and a clear-on-idle would collapse into one misleading "repeated N times" line.

`beginCheckout` already reads `cart` to snapshot it, so logging the count and subtotal there adds no dependency. Full cart contents stay out of every record; counts and totals only.

- [ ] **Step 6: Verify the four screens still behave and typecheck.**

```bash
bun run typecheck
bun run lint
bun test src/lib/cart.test.ts
bun run test:e2e:core
```

Expected: PASS, including Track A's navigation, menu-cart, and checkout browser specs — this task edits four customer-journey files, so the routed e2e suite is the proof that no added call changed behavior. Fix the call site, never the assertion.

Then, in `VITE_LOG_LEVEL=debug bun run dev`: add a no-option item from the menu, activate a configurable product and add it from `/details`, remove a line on `/cart`, and press Pay. Confirm one `ui:menu:cart` success per add, one `ui:menu` debug on the details navigation, one `ui:menu:cart` info on removal, one `ui:menu:checkout` info on Pay, and one `ui:menu:cart` info with `reason: "checkout_complete"` after a completed payment — and that cart totals, the persistent shell, and the idle timer all still behave.

- [ ] **Step 7: Commit the cart/menu slice.**

```bash
git add src/components/menu-screen.tsx src/components/product-details-screen.tsx src/components/cart-screen.tsx src/components/kiosk-customer-layout.tsx
git commit -m "feat(logging): instrument cart mutations and checkout start"
```

---

### Task 9: Instrument the checkout screen and the abandonment hook

> **Gated on Track A's Task 11.** Track A rewrites both files this task touches: its Task 4 moves `CheckoutScreen` under the routed shell and projects the live phase into `/pay?step=`, its Task 6 replaces the confirmation `setTimeout` with confetti plus a per-second countdown, and its Task 4 also edits `use-abandonment.ts`. Start only after Track A's Task 11 (final integration and reconciliation) has completed. The phase-reporting effect, `handleSelectMethod`, and both silent `catch` blocks survive Track A unchanged; the confirmation effect does not — see Step 2.

**Files:**
- Modify: `src/components/checkout-screen.tsx`
- Modify: `src/lib/use-abandonment.ts`

**Interfaces:**
- Consumes: `logger` from `#/lib/logger`; the checkout phase state machine and the idle-timer state machine.
- Produces: `ui:checkout`, `ui:checkout:phase`, `ui:idle` records. No phase name, transition, timer duration, `expirePaymentAttempt` payload, or PostHog capture changes.

- [ ] **Step 1: Add the checkout tag scopes.**

```ts
import { logger } from "#/lib/logger";

const log = logger.withTag("ui").withTag("checkout");
const phaseLog = log.withTag("phase");
```

Place them beside `PAYMENT_FAILURE_COPY`, outside the component.

- [ ] **Step 2: Log the method choice, phase transitions, and confirmation.**

```ts
  const handleSelectMethod = (selected: PaymentMethod) => {
    log.info("payment method chosen", { method: selected });
    setMethod(selected);
    void createPendingOrder(selected);
  };
```

```ts
  useEffect(() => {
    phaseLog.info("checkout phase changed", {
      phase,
      orderId: order?.id ?? null,
      attemptId,
    });
    onPaymentStateChange({
      phase,
      orderId: order?.id ?? null,
      attemptId,
    });
  }, [attemptId, onPaymentStateChange, order?.id, phase]);
```

```ts
  useEffect(() => {
    if (!confirmationPhase) {
      return;
    }
    log.success("payment complete", { orderNumber });
    // Track A Task 6's countdown lifecycle, unchanged: seed remaining seconds
    // from CONFIRMATION_SECONDS, decrement once per second, call onComplete
    // exactly once at zero, and clear the interval on unmount/phase change.
  }, [confirmationPhase, orderNumber]);
```

The 2-second `window.setTimeout(onComplete, 2_000)` this snippet used to wrap no longer exists: Track A's Task 6 replaces it with a per-second decrementing countdown that renders `Returning to menu in N second(s)` and calls `onComplete` once when the counter hits zero, reading `onComplete` through a ref so its identity cannot restart the timer. Attach the record to whichever effect or callback Track A left owning the **entry into** `confirmed` — the one that seeds the countdown — so it fires once per completed payment.

Two rules follow from that shape:

- Never put the log call inside the per-second tick. `log.success` there would fire twice per payment with an identical message and be throttled into a misleading "repeated N times" line.
- Do not re-add `onComplete` to the dependency array to make room for the log. Track A deliberately keeps it out (ref-held) so a parent re-render cannot restart the countdown. Adding `orderNumber` is safe: it is set once, in the same transition that sets `phase` to `confirmed`, so the countdown is still armed exactly once. If Track A's final effect already depends on `orderNumber`, change nothing but the added line.

- [ ] **Step 3: Log the non-approved result and both silent catches.**

```ts
      if (result.attemptStatus !== "approved" || !result.orderNumber) {
        log.warn("payment not approved", { attemptStatus: result.attemptStatus });
        setFailureMessage(PAYMENT_FAILURE_COPY);
        setPhase("failed");
        return;
      }
```

```ts
    } catch (error) {
      log.error("payment attempt failed", { error });
      if (activeRunRef.current === runId) {
        setFailureMessage(PAYMENT_FAILURE_COPY);
        setPhase("failed");
      }
    }
```

```ts
    } catch (error) {
      log.error("order creation failed", { error });
      if (activeRunRef.current === runId) {
        setFailureMessage(START_FAILURE_COPY);
        setPhase("failed");
      }
    }
```

These two `catch` blocks currently discard the real error; binding it and logging it is the highest-value change in this task. Do not otherwise alter the branches.

- [ ] **Step 4: Instrument the abandonment hook.**

In `src/lib/use-abandonment.ts`:

```ts
import { logger } from "#/lib/logger";

const log = logger.withTag("ui").withTag("idle");
```

```ts
  useEffect(() => {
    if (state.phase !== "warning") {
      return;
    }
    log.warn("idle warning shown", {
      secondsRemaining: state.secondsRemaining,
      lineCount: cartRef.current.length,
    });
    countdownIntervalRef.current = window.setInterval(() => {
```

The effect's dependency array stays `[config, state.phase]`, so the record fires once per warning, not once per countdown tick.

```ts
    if (isPendingPayment(pendingPayment)) {
      log.warn("payment expired due to idle", {
        orderId: pendingPayment.orderId,
        attemptId: pendingPayment.attemptId,
      });
      setExpiryPending(true);
      void (async () => {
        try {
          …
        } catch (error) {
          log.error("payment expiry call failed", { error });
          // Release the kiosk even if the local seam rejects; the backend owns expiry.
        }
```

```ts
    const abandonedCart = snapshotRef.current;
    if (abandonedCart.length > 0) {
      log.warn("cart cleared due to idle", {
        lineCount: abandonedCart.length,
        subtotalCents: subtotalCents(abandonedCart),
        idleDurationMs: Math.max(0, expiredAt - state.startedAt),
      });
      void loadPostHogAnalytics()
        …
        .catch((error) => {
          log.debug("cart abandonment analytics failed", { error });
          // Analytics failure must not strand the cart.
        });
    }
```

The PostHog `captureCartAbandoned` payload, the lazy `createClientOnlyFn` load, and the unconditional `onClearCartRef.current()` are unchanged; the log is additive and never gates them.

- [ ] **Step 5: Verify the checkout and abandonment behavior.**

```bash
bun run typecheck
bun run lint
bun test src/lib/idle-timer.test.ts src/lib/checkout.test.ts
bun run test:e2e:abandonment
```

Expected: PASS, including the existing idle-cart and payment-expiry browser scenarios. Then, in `VITE_LOG_LEVEL=debug bun run dev`, run one full payment to completion and one idle abandonment, confirming `ui:checkout:phase` records for each transition, one `ui:checkout` success at completion, and `ui:idle` warn records for the warning and the clear.

- [ ] **Step 6: Commit the checkout slice.**

```bash
git add src/components/checkout-screen.tsx src/lib/use-abandonment.ts
git commit -m "feat(logging): instrument checkout phases and idle abandonment"
```

---

### Task 10: Instrument the kitchen staff screen

> **No Track A dependency.** Track A never edits `src/components/kitchen-screen.tsx` — its constraints keep `/api/kitchen/events`, `KitchenScreen`, staff-cookie behavior, kitchen query keys, and SSE event shapes unchanged, and its only kitchen edit is metadata on the `src/routes/kitchen.tsx` route file. This task may run in the same wave as Tasks 1–6, as soon as Task 1 is green. Do not wait for any Track A task.

**Files:**
- Modify: `src/components/kitchen-screen.tsx`

**Interfaces:**
- Consumes: `logger` from `#/lib/logger`; existing `getKitchenErrorCode`, `errorCopy`, `applyKitchenEvent`, and the `EventSource` effect.
- Produces: `ui:kitchen`, `ui:kitchen:sse` records. No query key, mutation payload, SSE event name, listener registration, or cleanup change.

- [ ] **Step 1: Add the tag scopes.**

```ts
import { logger } from "#/lib/logger";

const log = logger.withTag("ui").withTag("kitchen");
const sseLog = log.withTag("sse");
```

Place them beside `KITCHEN_QUERY_KEY`, outside every component, so `applyKitchenEvent` and its existing test remain untouched.

- [ ] **Step 2: Log the staff gate.**

```ts
  const claimMutation = useMutation({
    mutationFn: (value: string) => claimStaffSession({ data: { password: value } }),
    onSuccess: () => {
      log.info("staff signed in");
      setGateError(null);
      setStaffReady(true);
    },
    onError: (error) => {
      log.warn("staff sign-in rejected", { code: getKitchenErrorCode(error) });
      setGateError(errorCopy(error, "We could not verify that password. Try again."));
    },
  });
```

```ts
    if (!password.trim()) {
      log.warn("staff password missing");
      setGateError(kitchenErrorCopy.invalid_input);
      return;
    }
```

Never log the `password` state value.

- [ ] **Step 3: Log advance outcomes.**

```ts
    onSuccess: (event) => {
      if (event.status === "done") {
        log.success("order marked done", { orderId: event.orderId });
      } else {
        log.info("order marked preparing", { orderId: event.orderId });
      }
      queryClient.setQueryData<KitchenOrder[]>(KITCHEN_QUERY_KEY, (orders) =>
        applyKitchenEvent(orders, event),
      );
    },
    onError: (error, { orderId }) => {
      const code = getKitchenErrorCode(error);
      log.warn("order advance failed", { orderId, code });
      if (code === "staff_identity") {
```

- [ ] **Step 4: Log SSE connection state and the parse failure.**

```ts
    const onOpen = () => {
      sseLog.info("kitchen stream connected");
      setLive(true);
    };
    const onError = () => {
      sseLog.warn("kitchen stream disconnected");
      setLive(false);
    };
```

```ts
        } catch (error) {
          sseLog.error("kitchen stream payload was unreadable", { error });
          setLive(false);
        }
```

```ts
  const refresh = () => {
    log.debug("manual refresh requested");
    void queryClient.invalidateQueries({ queryKey: KITCHEN_QUERY_KEY });
  };
```

- [ ] **Step 5: Verify the staff screen.**

```bash
bun run typecheck
bun run lint
bun test src/components/kitchen-screen.test.ts
bun run test:e2e:core
```

Expected: PASS, including the existing kitchen-queue browser spec. Then, in `VITE_LOG_LEVEL=debug bun run dev`, sign in at `/kitchen`, pay for an order in another tab, and confirm a `ui:kitchen:sse` info on connect, a `ui:kitchen` info/success pair when advancing `paid → preparing → done`, and that the live queue still updates without a refresh.

- [ ] **Step 6: Commit the staff-screen slice.**

```bash
git add src/components/kitchen-screen.tsx
git commit -m "feat(logging): instrument kitchen staff screen"
```

---

### Task 11: Full checks, live proof, and recorded evidence

**Files:**
- Modify: `GOAL.md` Plan/Log sections (git-excluded; keep current during execution)

**Interfaces:**
- Consumes: the fully instrumented application, the existing test scripts, and the built server.
- Produces: command results with test counts, observed server-stdout and browser-console records per tag, and the commit list for handoff.

- [ ] **Step 1: Run the full check sequence once.**

```bash
bun run lint && bun run format && bun run typecheck && bun run test && bun run build
```

Record each command's observed result and the `bun test` count (the pre-change baseline recorded in `GOAL.md` is 74 tests; the new total must be that plus the tests added by Tasks 1–6). Do not claim green on a failure.

- [ ] **Step 2: Run the complete browser suite.**

```bash
bun run test:e2e
```

Expected: PASS for both the `core` and `abandonment` projects with no spec modified by this work. A failure here means an added log call changed behavior — fix the call site, never the assertion.

- [ ] **Step 3: Prove the server tags against a real database.**

```bash
bun run db:migrate
bun run db:seed
LOG_LEVEL=debug bun run start
```

Drive the real flow (claim → menu → cart → pay → kitchen advance → done, plus one idle abandonment and one payment expiry) and record the actual stdout lines observed for each tag: `kiosk:session`, `kiosk:verify-password`, `kiosk:claim`, `kiosk:list`, `catalog`, `order:create`, `payment:start`, `payment:reconcile`, `payment:expire`, `kitchen:claim`, `kitchen:session`, `kitchen:list`, `kitchen:advance`, `kitchen:sse`. Confirm each carries the expected level, and confirm no password, cookie, or secret appears in any line.

- [ ] **Step 4: Prove the level switch.**

Restart with `LOG_LEVEL=warn bun run start` and confirm that `debug` and `info` records disappear while `warn`/`error` records remain, and that `LOG_LEVEL=silent` produces none. Restart at the default (unset) and confirm `info` behavior. This is the only proof that the env plumbing works end to end at runtime.

- [ ] **Step 5: Prove the browser tags.**

Rebuild with `VITE_LOG_LEVEL=debug bun run build`, start the server, and walk the customer and staff journeys with browser control, recording the observed console records for `ui:setup`, `ui:menu`, `ui:menu:cart`, `ui:menu:checkout`, `ui:checkout`, `ui:checkout:phase`, `ui:kitchen`, `ui:kitchen:sse`, and `ui:idle`. This replaces an e2e console assertion by design; the observation must be recorded, not assumed.

- [ ] **Step 6: Record evidence and hand off.**

Add `GOAL.md` Plan entries for `docs/specs/2026-08-21-structured-logging-design.md` and `docs/plans/2026-08-21-structured-logging-plan.md` plus every implementation commit hash, then Log entries containing: the full-check results with the new test count, the `test:e2e` result, the observed server-stdout record per backend tag, the observed console record per frontend tag, the level-switch observations from Step 4, the `ui:menu` tag reassignment from Task 8 Step 2 (`customization opened` now rides the `/details?id=` navigation because Track A deleted `customization-drawer.tsx`), and any further Track A call-site substitution made under Tasks 8–9. Send Main a concise handoff listing the commits, the new files (`src/lib/logger.ts`, `src/lib/logger.test.ts`, `src/test/logger-test-support.ts`), the two new env variables with their default, and confirmation that no `captureDomainEvent` call, error code, or rendered output changed. Do not mark item 18 complete until every tag in Steps 3 and 5 has been directly observed.
