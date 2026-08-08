# Fake device and payment reconcile Implementation Plan

> **For agentic workers:** Execute this plan task-by-task with the repository's TDD workflow. Steps use checkbox syntax for tracking.

**Goal:** Add immutable simulated payment attempts and named server functions that reconcile approved terminal receipts into paid, kiosk-numbered orders.

**Architecture:** Extend the existing Drizzle schema with one `payment_attempts` row per terminal command. Keep `startPaymentAttemptHandler` and `reconcilePaymentAttemptHandler` in a colocated payment-functions module, with signed-cookie ownership and all reconciliation writes inside one transaction. Approval atomically allocates the existing kiosk/date counter, updates the order, and resolves the attempt; declined, unavailable, invalid, and expired attempts resolve once and remain audit rows.

**Tech Stack:** Bun, TypeScript, TanStack Start `createServerFn`, Valibot, Drizzle ORM with libSQL/SQLite, Bun Test, shared `src/test/db-test-support.ts`.

## Global Constraints

- Every payment operation is a named POST `createServerFn`; do not add `/api/payment-attempts/:id/reconcile` or another ad-hoc REST route.
- Kiosk identity comes only from the signed `kiosk_session` cookie and server-only `KIOSK_COOKIE_SECRET`; never accept a client kiosk id.
- `payment_attempts` stores one row per generated command; a pending row resolves at most once and is never reused or deleted during checkout.
- `startPaymentAttempt({ data: { orderId } })` reads the pending order's persisted `total_amount_cents`, creates a random command, and uses a two-minute server-clock expiry.
- `reconcilePaymentAttempt({ data: { attemptId, receipt } })` accepts the structured receipt `{ terminalCommand, reference, amountCents, outcome }`; `reference` is opaque, while command and amount are compared to the server row and outcome is one of `approved | declined | unavailable`.
- Ownership, state, expiry, command correlation, and expected amount are checked server-side. Wrong kiosk and already-resolved failures leave rows unchanged; expiry and receipt mismatches resolve the row to `expired` or `invalid` before surfacing typed errors.
- Only approval can set the order to `paid`, allocate a kiosk-prefixed order number, and advance `kiosk_order_counters(kiosk_id, service_date)`. `service_date` comes from server/Docker `TZ`, with UTC fallback, never the browser clock.
- Failed/declined/unavailable attempts remain immutable audit records; retry uses a new attempt for the same still-pending order.
- Use `src/test/db-test-support.ts` (`createTestDatabase`, `mockDatabaseModule`, `withStartContext`) rather than creating a duplicate database fixture.
- Write the colocated test first and run it red before adding schema or production code; skip repo-wide checks until the final task.

---

## File map

- Create: `src/lib/payment.functions.test.ts` — shared migrated SQLite setup, cookie/server mocks, red-green tests for both handlers and persisted transitions.
- Modify: `src/db/schema.ts` — add `paymentAttempts` table and timestamp/foreign-key columns following existing conventions.
- Create via Drizzle: `drizzle/0005_*.sql` and `drizzle/meta/0005_snapshot.json` — migration for `payment_attempts`; do not hand-edit snapshot metadata.
- Create: `src/lib/payment.functions.ts` — receipt/input/result types, typed error, validators, start/reconcile handlers, TZ counter allocation, named server functions.
- Create: `docs/specs/2026-08-08-payment-reconcile-design.md` (already committed) — approved design contract.
- Create: `docs/plans/2026-08-08-payment-reconcile-plan.md` (this file) — implementation sequence and verification.

## Interfaces between tasks

The test and kiosk-ui lane consume these exact names and shapes:

```ts
export type PaymentAttemptStatus =
  | "pending"
  | "approved"
  | "declined"
  | "unavailable"
  | "invalid"
  | "expired";

export type PaymentReceipt = {
  terminalCommand: string;
  reference: string;
  amountCents: number;
  outcome: "approved" | "declined" | "unavailable";
};

export type StartPaymentAttemptInput = { orderId: string };

export type StartPaymentAttemptResult = {
  id: string;
  orderId: string;
  status: "pending";
  terminalCommand: string;
  expectedAmountCents: number;
  expiresAt: string;
};

export type ReconcilePaymentAttemptInput = {
  attemptId: string;
  receipt: PaymentReceipt;
};

export type ReconcilePaymentAttemptResult = {
  attemptId: string;
  orderId: string;
  attemptStatus: "approved" | "declined" | "unavailable";
  orderStatus: "paid" | "payment_pending";
  orderNumber: string | null;
  amountCents: number;
  reference: string;
};

export type PaymentAttemptErrorCode =
  | "configuration"
  | "kiosk_identity"
  | "invalid_input"
  | "order_not_pending"
  | "attempt_not_found"
  | "attempt_ownership"
  | "attempt_resolved"
  | "attempt_expired"
  | "receipt_invalid";

export class PaymentAttemptError extends Error {
  constructor(public readonly code: PaymentAttemptErrorCode, message: string) {
    super(message);
    this.name = "PaymentAttemptError";
  }
}

export const startPaymentAttemptHandler: (
  input: StartPaymentAttemptInput,
) => Promise<StartPaymentAttemptResult>;
export const reconcilePaymentAttemptHandler: (
  input: ReconcilePaymentAttemptInput,
) => Promise<ReconcilePaymentAttemptResult>;

export const startPaymentAttempt: ReturnType<typeof createServerFn>;
export const reconcilePaymentAttempt: ReturnType<typeof createServerFn>;
```

Clients call:

```ts
const started = await startPaymentAttempt({ data: { orderId } });
const result = await reconcilePaymentAttempt({
  data: {
    attemptId: started.id,
    receipt: {
      terminalCommand: started.terminalCommand,
      reference: fakeTerminalReference,
      amountCents: started.expectedAmountCents,
      outcome: "approved",
    },
  },
});
```

## Task 1: Write and prove the failing colocated test

**Files:**
- Create: `src/lib/payment.functions.test.ts`
- Read/reuse: `src/test/db-test-support.ts`, `src/lib/kiosk-cookie.server.ts`, `src/db/schema.ts`, `src/lib/order.functions.ts`

- [ ] **Step 1: Set up the migrated test database and cookie mocks.**

Create the test module with `beforeEach`, `expect`, `mock`, and `test` from `bun:test`; `eq` and `sql` from `drizzle-orm`; `randomUUID` from `node:crypto`; and the shared test-support imports. Use `createTestDatabase(\`file:/tmp/self-service-payment-${randomUUID()}.db\`)` so assertions observe the same file-backed database connection used by `db.transaction`. Insert two kiosks (`kiosk-a`/`A` and `kiosk-b`/`B`). Mock `#/db/client.server` with this database, `#/env.server` with `{ KIOSK_COOKIE_SECRET: "cookie-secret" }`, and `@tanstack/react-start/server` with `getRequestHeader` reading a mutable `requestCookie` and no-op `setResponseHeader`. Import `signKioskCookie` and the not-yet-created payment handlers after those mocks.

Use a helper that signs kiosk A's payload, a helper that inserts a pending order with a chosen id/kiosk/total, and `beforeEach` that deletes payment attempts, orders, and counters in foreign-key-safe order. Import `orders`, `paymentAttempts`, and `kioskOrderCounters` from `#/db/schema` so assertions query actual persisted rows.

- [ ] **Step 2: Write the approval and counter assertions before implementation.**

Write a test named `approved reconciliation marks the order paid and allocates a kiosk-prefixed number`. Insert `order-1` for kiosk A at `1_250` cents, call `startPaymentAttemptHandler({ orderId: "order-1" })`, and assert its pending result has a non-empty command, `expectedAmountCents === 1_250`, and an ISO `expiresAt`. Reconcile with the exact command, opaque reference `receipt-1`, amount `1_250`, and outcome `approved`. Assert the result is approved/paid with `orderNumber === "A-1"`; query the order and attempt to assert `status`, `orderNumber`, `paidAt`, stored reference, and `resolvedAt`; query the counter and assert the current server-timezone date row has `nextNumber === 2`.

Then insert `order-2` for the same kiosk/date, start/reconcile approval, assert `orderNumber === "A-2"`, and verify the counter is shared. Insert a pre-existing counter row for another service date (for example `2000-01-01`, `nextNumber = 41`) and assert it remains independent; the current service-date approval still begins at one for a fresh date and every generated number starts with the kiosk prefix.

- [ ] **Step 3: Add ownership, expiry, state, amount, correlation, and failure-result tests.**

Add focused tests invoking handlers through `withStartContext`:

1. Set the cookie to kiosk B after starting an attempt for kiosk A. Reconcile it and assert `PaymentAttemptError.code === "attempt_ownership"`; query the row and assert it remains `pending` with no receipt/resolved timestamp.
2. Start an attempt, update its `expiresAt` to `new Date(0)` through Drizzle, reconcile with an otherwise valid receipt, and assert `code === "attempt_expired"`; query the row and assert it is `expired` with `resolvedAt` populated.
3. Approve an attempt, then reconcile the same id again and assert `code === "attempt_resolved"`; assert the order remains paid, the number remains unchanged, and the counter was not incremented twice.
4. Reconcile a pending attempt with `amountCents` one cent above the expected value and assert `code === "receipt_invalid"`; assert the row is `invalid`, stores the opaque reference, and has `resolvedAt` populated.
5. Reconcile another pending attempt with a different command and assert `code === "receipt_invalid"` and terminal `invalid` status.
6. Reconcile separate pending attempts with `outcome: "declined"` and `outcome: "unavailable"`; assert each normal result has the matching terminal status, `orderStatus === "payment_pending"`, `orderNumber === null`, and the order remains pending. Start a fresh attempt for that order and assert its id/command differs.

Keep malformed input checks for an empty order/attempt id, empty reference, non-integer amount, and unsupported outcome; assert `invalid_input` before any row is inserted or changed. Use a separate pending order per test or reset rows in `beforeEach` so each test has one observable behavior.

- [ ] **Step 4: Run only the new test to establish red.**

Run:

```bash
bun test src/lib/payment.functions.test.ts
```

Expected: FAIL because `src/lib/payment.functions.ts` and `paymentAttempts` do not exist yet. The failure must be a missing production module/schema symbol, not a malformed test or a passing test; keep the assertions intact.

## Task 2: Add the payment-attempt schema and migration

**Files:**
- Modify: `src/db/schema.ts`
- Create via generator: `drizzle/0005_*.sql`, `drizzle/meta/0005_snapshot.json`

- [ ] **Step 1: Add `paymentAttempts` following existing table conventions.**

Add a `sqliteTable("payment_attempts", { ... })` export with:

```ts
export const paymentAttempts = sqliteTable("payment_attempts", {
  id: text("id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  terminalCommand: text("terminal_command").notNull(),
  receipt: text("receipt"),
  expectedAmountCents: integer("expected_amount_cents").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
});
```

Place it after `orders` so its foreign-key declaration can reference the existing export. Keep the status as text, matching the existing order status convention; runtime validators and transitions enforce the allowed values.

- [ ] **Step 2: Generate and inspect the migration.**

Run:

```bash
bun run db:generate
```

Expected: one new `drizzle/0005_*.sql` plus one `drizzle/meta/0005_snapshot.json`, without edits to migrations 0000–0004. Read the generated SQL and verify `payment_attempts` has a text primary key, required order FK with cascade, required command/amount/timestamps, nullable receipt/resolved timestamp, and no mutable uniqueness constraint that would prevent retry attempts.

- [ ] **Step 3: Rerun the focused test and preserve the red phase.**

Run:

```bash
bun test src/lib/payment.functions.test.ts
```

Expected: the shared migration replay now creates all tables, but the test remains FAIL because the handlers are still absent. Do not add production stubs merely to make this intermediate phase pass.

## Task 3: Implement `startPaymentAttempt` minimally

**Files:**
- Create: `src/lib/payment.functions.ts`

- [ ] **Step 1: Define stable types, errors, and input validators.**

Define the exact exported interfaces from the contract block. Define `PaymentAttemptError` and all nine error codes. Use Valibot object schemas that require a non-empty string for `orderId`, `attemptId`, and receipt `terminalCommand`/`reference`, an integer non-negative `amountCents`, and one of the three allowed receipt outcomes. Convert failed `safeParse` results into `PaymentAttemptError("invalid_input", ...)`; do not trust unknown extra fields or client amount/order/kiosk fields.

- [ ] **Step 2: Authenticate kiosk identity and load the pending order transactionally.**

Read `serverEnv.KIOSK_COOKIE_SECRET`; throw `configuration` when missing. Read the signed cookie with `readKioskCookie`; throw `kiosk_identity` when absent/invalid. In `db.transaction`, query the kiosk by the signed id, then query the order by input id. Throw `kiosk_identity` when the kiosk no longer exists, `order_not_pending` when the order is missing, belongs to another kiosk, or is not `payment_pending`. Use the persisted order total as `expectedAmountCents`; never accept a posted amount.

- [ ] **Step 3: Insert and return one pending attempt.**

Generate an id and one-time command using `randomUUID()` (for example `fake-terminal:${randomUUID()}`), compute `createdAt = new Date()` and `expiresAt = new Date(createdAt.getTime() + 120_000)`, and insert one `payment_attempts` row with `pending`, null receipt/resolved timestamp, the order total, and both timestamps. Return the exact result contract with `expiresAt.toISOString()`. Keep the function handler export for direct tests.

- [ ] **Step 4: Export the named POST server function.**

Export the only client boundary:

```ts
export const startPaymentAttempt = createServerFn({ method: "POST" })
  .validator((input) => validateStartPaymentAttemptInput(input))
  .handler(({ data }) => startPaymentAttemptHandler(data));
```

- [ ] **Step 5: Run the focused tests and confirm the remaining red behavior.**

Run:

```bash
bun test src/lib/payment.functions.test.ts
```

Expected: start-only assertions pass, while reconciliation assertions still fail because `reconcilePaymentAttemptHandler` is not implemented. Keep the failure tied to the missing reconcile behavior.

## Task 4: Implement `reconcilePaymentAttempt` and atomic approval

**Files:**
- Modify: `src/lib/payment.functions.ts`

- [ ] **Step 1: Load the attempt joined to its order and enforce identity/state/expiry.**

Inside `db.transaction`, read the signed kiosk cookie and query `payment_attempts` joined to `orders` and `kiosks` by attempt id. A missing row throws `attempt_not_found`; a kiosk mismatch throws `attempt_ownership` without writes; a non-pending status throws `attempt_resolved` without writes. Require the joined order to still be `payment_pending`, otherwise throw `order_not_pending`. Compare `Date.now()` to the stored `expiresAt`; when expired, update only the attempt to `expired` with `resolvedAt = now`, return an internal terminal-error marker from the transaction, and throw `PaymentAttemptError("attempt_expired", ...)` after the transaction commits so the update is not rolled back.

- [ ] **Step 2: Validate command correlation and expected amount as a terminal invalid transition.**

Compare `receipt.terminalCommand` exactly with the stored command and `receipt.amountCents` exactly with `expectedAmountCents`. On either mismatch, update the pending row to `invalid`, store `receipt.reference`, set `resolvedAt`, return an internal terminal-error marker, and throw `PaymentAttemptError("receipt_invalid", ...)` only after the transaction commits. This preserves the failed attempt while preventing a second reconciliation.

- [ ] **Step 3: Resolve declined and unavailable results without allocating a number.**

For `receipt.outcome === "declined"` or `"unavailable"`, update the attempt status, opaque `receipt` reference, and `resolvedAt`; leave the order and counter untouched. Return `ReconcilePaymentAttemptResult` with the matching attempt status, `orderStatus: "payment_pending"`, null order number, persisted amount, and reference.

- [ ] **Step 4: Allocate the server-timezone order number for approval.**

For an approved receipt, derive the date in the server/Docker timezone:

```ts
const serviceDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: process.env.TZ || "UTC",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
```

Use an SQLite insert-or-update on the composite counter key. The missing-row insert uses `nextNumber: 2`, while conflict updates use `sql\`${kioskOrderCounters.nextNumber} + 1\``; `.returning()` gives the post-update value, so allocate `nextNumber - 1`. Build `${kiosk.prefix}-${allocatedNumber}`. Do not use browser-supplied dates, counters, or order numbers.

- [ ] **Step 5: Update attempt and order in the same transaction and return the paid result.**

Update the order to `status: "paid"`, the computed `orderNumber`, and `paidAt: now`; update the attempt to `approved`, store the opaque reference, and set `resolvedAt`. Return the exact approved result. A thrown database error must roll back the attempt/order/counter together; do not catch it and return a successful response.

- [ ] **Step 6: Export the named reconcile server function.**

Export:

```ts
export const reconcilePaymentAttempt = createServerFn({ method: "POST" })
  .validator((input) => validateReconcilePaymentAttemptInput(input))
  .handler(({ data }) => reconcilePaymentAttemptHandler(data));
```

- [ ] **Step 7: Run focused tests green.**

Run:

```bash
bun test src/lib/payment.functions.test.ts
```

Expected: every payment test passes, including approval/counter prefix and date scope, wrong ownership, expiry recording, no double reconciliation, amount and command invalid recording, and declined/unavailable retry behavior.

## Task 5: Refactor and review the contract

**Files:**
- Modify: `src/lib/payment.functions.ts`, `src/lib/payment.functions.test.ts`, and the design/plan docs only if an observed implementation detail changes the approved contract.

- [ ] **Step 1: Refactor only after green.**

Extract only small private helpers that reduce repeated identity, receipt, service-date, or result construction logic. Keep terminal updates and approval inside one transaction, preserve post-commit error handling for recorded invalid/expired outcomes, and retain exact exports, input/response fields, statuses, and error codes. Remove no-op abstractions and do not add provider/security behavior outside the approved POC.

- [ ] **Step 2: Rerun the focused test after refactor.**

Run:

```bash
bun test src/lib/payment.functions.test.ts
```

Expected: PASS with no assertion weakening, no duplicate database fixture, and no warnings/errors caused by the refactor.

- [ ] **Step 3: Notify the active frontend lane with stable signatures.**

Run `hub op: "list"` and identify the current kiosk-ui agent. Send the exact `PaymentReceipt`, `StartPaymentAttemptResult`, `ReconcilePaymentAttemptResult`, and `PaymentAttemptErrorCode` contracts, including that `startPaymentAttempt` consumes the `createOrder` result id, command correlation is exact, the fake terminal defaults to `approved`, and tests can force `declined`/`unavailable` through receipt outcome. Also state that `reference` is opaque and `expiresAt` is a server ISO string.

## Task 6: Final verification and commits

**Files:**
- All changed files from Tasks 1–5.

- [ ] **Step 1: Run the required full checks.**

Run:

```bash
bun run lint && bun run format && bun run typecheck && bun run test
```

Expected: each command exits 0 and the complete Bun suite reports zero failures. If `bun run format` changes files, rerun `bun run typecheck` and `bun run test`, then inspect the final diff before committing.

- [ ] **Step 2: Review final diff for scope and contract.**

Verify the design and plan docs are committed, migration metadata is present, `payment_attempts` replays through `createTestDatabase`, no raw payment REST route was added, no client kiosk/amount/order number is trusted, every resolved attempt is one-time, and only approved reconciliation updates the order/counter. Verify no duplicate test-support helper or real payment/provider integration was added.

- [ ] **Step 3: Commit implementation with a scoped Conventional Commit.**

```bash
git add src/db/schema.ts src/lib/payment.functions.ts src/lib/payment.functions.test.ts drizzle docs/plans/2026-08-08-payment-reconcile-plan.md
git commit -m "feat(payment-reconcile): reconcile fake payments"
```

Expected: commit hooks pass and the branch contains the previously committed design plus this implementation/plan commit.

- [ ] **Step 4: Report completion to Main.**

Send `hub` to `Main` with the implementation commit hash, plan commit/hash, exact frontend notification recipient, red and green focused-test evidence, and the final full-check command result.
