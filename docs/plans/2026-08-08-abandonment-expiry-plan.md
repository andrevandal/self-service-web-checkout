# Abandonment and expiry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit payment-attempt expiry that expires its pending order and capture all six server-side PostHog domain events without allowing analytics failures to affect checkout or kitchen behavior.

**Architecture:** Keep expiry in `src/lib/payment.functions.ts` as a named POST server function and direct-testable handler. Reuse a transaction-local expiry transition helper for the existing attempt-only safety valve and the new attempt-plus-order transition; emit analytics only after committed transactions. Add a small `posthog-node` adapter with optional server-only configuration and invoke it from payment and kitchen handlers after their existing guards/transactions.

**Tech Stack:** TanStack Start `createServerFn`, Drizzle ORM + SQLite, Valibot, Bun test, `posthog-node`, existing `db-test-support` and `withStartContext` helpers.

## Global Constraints

- Preserve the existing internal two-minute safety-valve behavior: it expires only the attempt, leaves the order `payment_pending`, and remains retryable.
- `expirePaymentAttempt({ data: { attemptId } })` is the only new checkout API; do not add a REST endpoint.
- `orders.status` remains the existing unconstrained SQLite text column; add the live `expired` value without a migration.
- Event names MUST be exactly `payment_attempt_started`, `payment_attempt_result`, `order_paid`, `order_expired`, `kitchen_order_started`, and `kitchen_order_done`.
- Event properties MUST use snake_case, derive `kiosk_id` from the signed kiosk/staff session-backed row, and never contain card data, terminal receipts, commands, or customer identity.
- `POSTHOG_KEY` and optional `POSTHOG_HOST` are server-only fields; an empty key is a no-op and every SDK failure is caught.
- Every implementation test is colocated, uses the shared in-memory/temporary database support, and is written and run red before its implementation.
- Skip formatters, linters, and project-wide suites until all implementation tasks are complete; run final checks once.

---

### Task 1: Draft the expiry contract test first

**Files:**
- Modify: `src/lib/payment.functions.test.ts`

**Interfaces:**
- Consumes: existing `insertPendingOrder`, `setKioskCookie`, `startPaymentAttemptHandler`, `reconcilePaymentAttemptHandler`, and `PaymentAttemptError` test helpers.
- Produces: a failing test that later imports and calls `expirePaymentAttemptHandler({ attemptId })` and proves the durable order/attempt transition.

- [ ] **Step 1: Write the failing test**

Extend the existing dynamic import to include `expirePaymentAttemptHandler`. Add a test that creates a pending order, starts an attempt, calls the new handler under `withStartContext`, then reads both rows:

```ts
test("explicit expiry resolves the attempt and order and blocks reconciliation", async () => {
  const orderId = await insertPendingOrder({ id: "order-expire" });
  const attempt = await withStartContext(() => startPaymentAttemptHandler({ orderId }));

  const result = await withStartContext(() =>
    expirePaymentAttemptHandler({ attemptId: attempt.id }),
  );

  expect(result).toEqual({
    attemptId: attempt.id,
    orderId,
    attemptStatus: "expired",
    orderStatus: "expired",
    amountCents: 1_250,
  });
  expect(await db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)))
    .toEqual([{ status: "expired" }]);
  expect(
    await db
      .select({ status: paymentAttempts.status })
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, attempt.id)),
  ).toEqual([{ status: "expired" }]);

  await expect(
    withStartContext(() =>
      reconcilePaymentAttemptHandler({
        attemptId: attempt.id,
        receipt: approvedReceipt(attempt),
      }),
    ),
  ).rejects.toMatchObject({ code: "attempt_resolved" });
});
```

- [ ] **Step 2: Run the focused test and verify red**

Run `bun test src/lib/payment.functions.test.ts -t "explicit expiry resolves"`.
Expected: FAIL because `expirePaymentAttemptHandler` is not exported yet.

- [ ] **Step 3: Commit the red test**

```bash
git add src/lib/payment.functions.test.ts
git commit -m "test(payment): specify explicit expiry transition"
```

---

### Task 2: Implement explicit expiry and shared terminal transition

**Files:**
- Modify: `src/lib/payment.functions.ts`
- Modify: `src/db/schema.ts` only if a status union/type is introduced for returned domain shapes (no migration)
- Test: `src/lib/payment.functions.test.ts`

**Interfaces:**
- Consumes: the Task 1 failing test and existing kiosk cookie/payment error conventions.
- Produces:

```ts
export type ExpirePaymentAttemptInput = { attemptId: string };
export type ExpirePaymentAttemptResult = {
  attemptId: string;
  orderId: string;
  attemptStatus: "expired";
  orderStatus: "expired";
  amountCents: number;
};
export const expirePaymentAttemptHandler: (
  input: ExpirePaymentAttemptInput,
) => Promise<ExpirePaymentAttemptResult>;
export const expirePaymentAttempt: ServerFn<
  "POST",
  ExpirePaymentAttemptInput,
  ExpirePaymentAttemptResult
>;
```

- [ ] **Step 1: Add input/result types and Valibot validator**

Add `ExpirePaymentAttemptInput`/`ExpirePaymentAttemptResult` beside the existing payment types, define `v.object({ attemptId: v.pipe(v.string(), v.minLength(1)) })`, and validate malformed input by throwing `PaymentAttemptError("invalid_input", ...)`, matching the existing `start` and `reconcile` validators.

- [ ] **Step 2: Extract the two expiry update variants**

Inside the existing transaction flow, use one transaction-local helper with an explicit `expireOrder` boolean. It must update `paymentAttempts` to `expired` with `resolvedAt: now`; when `expireOrder` is true, update `orders` with `WHERE id = ? AND status = 'payment_pending'` to `expired` in the same transaction. Keep the current safety-valve caller on `expireOrder: false`, and return its existing terminal `attempt_expired` error. The explicit handler uses `expireOrder: true` and rolls back if either guarded update returns no row.

- [ ] **Step 3: Implement `expirePaymentAttemptHandler`**

Mirror existing configuration and kiosk-cookie checks. In a transaction verify kiosk existence, join the attempt to its order/kiosk, enforce ownership, pending attempt, and `payment_pending` order. Capture one `now`, call the shared helper with `expireOrder: true`, and return the exact result shape. After commit, call the analytics helper twice with `payment_attempt_result` (outcome `expired`, failure reason `client_idle_timeout`) and `order_expired`; analytics calls must not be awaited by or thrown through the handler.

- [ ] **Step 4: Export the named POST server function**

Append:

```ts
export const expirePaymentAttempt = createServerFn({ method: "POST" })
  .validator((input) => validateExpirePaymentAttemptInput(input))
  .handler(({ data }) => expirePaymentAttemptHandler(data));
```

- [ ] **Step 5: Run the focused test and verify green**

Run `bun test src/lib/payment.functions.test.ts -t "explicit expiry resolves"`.
Expected: PASS, with the attempt and order both `expired`, and reconciliation rejected as `attempt_resolved`.

- [ ] **Step 6: Add boundary regression tests**

Add focused tests for a different kiosk (`attempt_ownership`), a resolved attempt (`attempt_resolved`), and a non-pending order (`order_not_pending`). Re-run `bun test src/lib/payment.functions.test.ts` and verify the prior internal safety-valve test still sees an expired attempt with a `payment_pending` order.

- [ ] **Step 7: Commit the expiry implementation**

```bash
git add src/lib/payment.functions.ts src/lib/payment.functions.test.ts src/db/schema.ts
git commit -m "feat(payment): expire abandoned pending orders"
```

---

### Task 3: Add optional PostHog server adapter and payment event capture

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `src/env.ts`
- Modify: `.env.example`
- Create: `src/lib/posthog.server.ts`
- Modify: `src/lib/payment.functions.ts`
- Test: `src/lib/payment.functions.test.ts`

**Interfaces:**
- Consumes: `expirePaymentAttemptHandler`, existing payment handlers, and server-derived kiosk/order/attempt rows.
- Produces:

```ts
export type DomainEventName =
  | "payment_attempt_started"
  | "payment_attempt_result"
  | "order_paid"
  | "order_expired"
  | "kitchen_order_started"
  | "kitchen_order_done";
export const captureDomainEvent: (
  event: DomainEventName,
  distinctId: string,
  properties: Record<string, unknown>,
) => void;
```

- [ ] **Step 1: Add the dependency and server env fields**

Run `bun add posthog-node@latest` (retain the lockfile's resolved version). Add `POSTHOG_KEY: v.optional(v.string(), "")` and `POSTHOG_HOST: v.optional(v.string(), "")` to `serverEnvFields`, and add commented `POSTHOG_KEY`/`POSTHOG_HOST` lines to `.env.example`. Do not expose these through the client env object.

- [ ] **Step 2: Write the adapter and its failure isolation**

Create `src/lib/posthog.server.ts` with a singleton `PostHog` only when `serverEnv.POSTHOG_KEY` is non-empty, default host `https://us.i.posthog.com`, and a `captureDomainEvent` function that wraps `client.capture({ distinctId, event, properties })` in `try` plus `Promise.resolve(...).catch(...)`. With an empty key it must return before constructing or calling an SDK client.

- [ ] **Step 3: Add mocked capture assertions before wiring each payment point**

Mock `./posthog.server` before dynamically importing `payment.functions`, collect calls in an array, and add tests that invoke start, declined reconcile, approved reconcile, explicit expiry, and internal safety-valve expiry. Assert event names and snake_case properties; assert approved flows include both `payment_attempt_result` and `order_paid`, explicit expiry includes both `payment_attempt_result` and `order_expired`, and internal expiry includes `payment_attempt_result` but not `order_expired`. Add an empty-key adapter test using `serverEnv.POSTHOG_KEY = ""` (or a fresh module import) and assert `captureDomainEvent` returns without throwing or recording an SDK call.

- [ ] **Step 4: Run the payment analytics tests and verify red**

Run `bun test src/lib/payment.functions.test.ts -t "payment_attempt|order_paid|order_expired|PostHog"`.
Expected: FAIL because payment handlers do not yet call the mocked capture helper.

- [ ] **Step 5: Wire `payment_attempt_started` after committed start**

Have the start transaction return server-derived kiosk ID, order/attempt IDs, amount, created timestamps, and attempt count. After the transaction commits, call:

```ts
captureDomainEvent("payment_attempt_started", kioskId, {
  kiosk_id: kioskId,
  order_id: orderId,
  attempt_id: attemptId,
  amount_cents: amountCents,
  attempt_count: attemptCount,
  elapsed_ms: Math.max(0, createdAt.getTime() - orderCreatedAt.getTime()),
});
```

- [ ] **Step 6: Wire result and paid/expired events after committed outcomes**

Carry a post-commit event payload through the reconcile transaction's terminal-error/result union so every resolved attempt captures `payment_attempt_result` before the existing error is thrown. Use stable outcomes (`approved`, `declined`, `unavailable`, `invalid`, `expired`) and failure reasons (`receipt_invalid`, matching outcome for declined/unavailable/expired). On approved, capture `order_paid` before/alongside the existing `order.paid` dispatcher emission. On explicit expiry, capture `order_expired` after `payment_attempt_result`. Capture properties from server rows only, including attempt count and elapsed milliseconds.

- [ ] **Step 7: Run payment tests and verify green**

Run `bun test src/lib/payment.functions.test.ts`.
Expected: all existing payment behavior plus the expiry and mocked PostHog assertions pass, including the internal safety-valve order remaining `payment_pending`.

- [ ] **Step 8: Commit payment analytics**

```bash
git add package.json bun.lock src/env.ts .env.example src/lib/posthog.server.ts src/lib/payment.functions.ts src/lib/payment.functions.test.ts
git commit -m "feat(payment): capture server domain outcomes"
```

---

### Task 4: Capture kitchen transition events

**Files:**
- Modify: `src/lib/kitchen.functions.ts`
- Modify: `src/lib/kitchen.functions.test.ts`

**Interfaces:**
- Consumes: `captureDomainEvent`, existing staff-session authorization, and committed `advanceOrderHandler` transition data.
- Produces: `kitchen_order_started` after paid→preparing and `kitchen_order_done` after preparing→done, with `kiosk_id`, `order_id`, `amount_cents`, `outcome`, and server elapsed duration.

- [ ] **Step 1: Add mocked event assertions before wiring**

Mock `./posthog.server` in the kitchen test setup, create/claim a staff session using existing helpers, insert a paid order, advance it to preparing then done, and assert exactly one `kitchen_order_started` and one `kitchen_order_done` capture with snake_case properties. Add a failed transition assertion that records no event.

- [ ] **Step 2: Run the focused kitchen analytics test and verify red**

Run `bun test src/lib/kitchen.functions.test.ts -t "kitchen_order_started|kitchen_order_done"`.
Expected: FAIL because `advanceOrderHandler` currently emits only the in-process kitchen dispatcher event.

- [ ] **Step 3: Return server data needed by capture from the guarded transaction**

Extend the selected order fields in `advanceOrderHandler` to include `kioskId`, `totalAmountCents`, and `createdAt`. Return those values in a private transition payload while preserving the public `OrderStatusEvent` result shape.

- [ ] **Step 4: Capture after commit and preserve dispatcher behavior**

After `db.transaction` resolves, map `preparing` to `kitchen_order_started` and `done` to `kitchen_order_done`, call `captureDomainEvent` with the server-derived kiosk ID and elapsed duration from `createdAt`, then emit the existing dispatcher event and return the unchanged public envelope. No analytics call occurs for rejected transitions.

- [ ] **Step 5: Run kitchen tests and verify green**

Run `bun test src/lib/kitchen.functions.test.ts`.
Expected: all existing staff/auth/list/transition/SSE-related tests and new capture tests pass.

- [ ] **Step 6: Commit kitchen analytics**

```bash
git add src/lib/kitchen.functions.ts src/lib/kitchen.functions.test.ts
git commit -m "feat(kitchen): capture order transition events"
```

---

### Task 5: Notify frontend and run final verification

**Files:**
- Modify: `GOAL.md` with the spec-6 completion log after implementation and checks pass.

**Interfaces:**
- Consumes: the committed `expirePaymentAttempt` server function.
- Produces: frontend handoff and green repository checks.

- [ ] **Step 1: Send the exact frontend contract**

Send the current abandonment UI agent this exact message via hub:

```text
Backend spec 6 contract is stable: expirePaymentAttempt({ data: { attemptId } }): Promise<{ attemptId: string; orderId: string; attemptStatus: "expired"; orderStatus: "expired"; amountCents: number }>. It requires the signed kiosk_session, atomically marks the pending attempt and its payment_pending order expired, emits payment_attempt_result + order_expired best-effort, and later reconciliation is rejected. Typed errors reuse PaymentAttemptError: configuration, kiosk_identity, invalid_input, attempt_not_found, attempt_ownership, attempt_resolved, order_not_pending.
```

- [ ] **Step 2: Run all required final checks**

Run exactly:

```bash
bun run lint && bun run format && bun run typecheck && bun run test
```

Expected: every command exits 0 and the test summary has 0 failures. If formatting changes files, stage those changes and rerun the same sequence.

- [ ] **Step 3: Update the goal log and commit documentation**

Append a dated spec-6 entry to `GOAL.md` naming the design/plan/implementation commits, the expiry contract, PostHog event set, focused test result, and final check result. Commit:

```bash
git add GOAL.md docs/plans/2026-08-08-abandonment-expiry-plan.md
git commit -m "docs(abandonment): record spec completion"
```

- [ ] **Step 4: Report completion to Main**

Use hub send to report the commit IDs, final check output, and frontend notification delivery. Do not claim completion until all four final commands have passed.
