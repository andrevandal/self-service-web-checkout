# Abandonment and expiry design

## Contents

- [Goal and scope](#goal-and-scope)
- [Design decisions](#design-decisions)
- [Explicit payment expiry](#explicit-payment-expiry)
- [Server-side domain events](#server-side-domain-events)
- [Flow and failure isolation](#flow-and-failure-isolation)
- [Testing and verification](#testing-and-verification)
- [Non-goals](#non-goals)

## Goal and scope

Implement the backend half of the PRD's abandonment flow. The kiosk UI can
explicitly expire the payment attempt that is active when its idle timer fires.
That operation resolves the attempt as `expired`, changes its order from
`payment_pending` to `expired`, and makes later reconciliation impossible. The
existing two-minute payment-command safety valve remains separate: it resolves
only the attempt and leaves the order retryable, as required by the existing
payment contract.

Add server-side PostHog domain capture for the six server events in the PRD:
`payment_attempt_started`, `payment_attempt_result`, `order_paid`,
`order_expired`, `kitchen_order_started`, and `kitchen_order_done`. Capture is
best-effort and never changes the success or failure of checkout or kitchen
operations. No card data, terminal receipts, or customer identity is sent.

The existing named TanStack Start server functions remain the application
boundary. No new REST endpoint is added. The existing authenticated kitchen
SSE route is unchanged.

## Design decisions

### Order status

`orders.status` is already an unconstrained SQLite `text` column; neither the
Drizzle schema nor any migration has a database enum or check constraint. The
live status set therefore gains `expired` without a migration. The backend's
status comparisons and returned types will explicitly include the PRD states:
`payment_pending | paid | preparing | done | expired`. Kitchen listing and
transitions continue to expose only `paid` and `preparing` and cannot move an
expired order into the kitchen.

### Explicit expiry versus the safety valve

`reconcilePaymentAttempt` currently detects an expired terminal command inside
its transaction, sets only `payment_attempts.status = 'expired'`, and throws
`attempt_expired`. That path intentionally leaves the order
`payment_pending`, allowing a new attempt. It must not be changed to expire the
order.

The new `expirePaymentAttempt` path uses the same pending-attempt guard and the
same transaction boundary, but atomically updates both rows with guarded
predicates. A small shared transition helper owns the attempt-only and
attempt-plus-order variants so the two paths cannot drift. The explicit path
runs all authorization and state checks before either update, and emits
PostHog events only after the transaction commits.

## Explicit payment expiry

The exported call shape is:

```ts
export type ExpirePaymentAttemptInput = {
  attemptId: string;
};

export type ExpirePaymentAttemptResult = {
  attemptId: string;
  orderId: string;
  attemptStatus: "expired";
  orderStatus: "expired";
  amountCents: number;
};

expirePaymentAttempt({
  data: { attemptId },
}): Promise<ExpirePaymentAttemptResult>;
```

The handler is a POST `createServerFn` with a direct-testable
`expirePaymentAttemptHandler`. It validates a non-empty attempt ID and requires
the signed kiosk session. It loads the attempt joined to its order and kiosk,
rejecting a missing attempt as `attempt_not_found`, another kiosk as
`attempt_ownership`, an already resolved attempt as `attempt_resolved`, and an
order that is not `payment_pending` as `order_not_pending`. Configuration and
missing identity use the existing payment error codes.

Within one database transaction, the handler updates the order with
`WHERE id = ? AND status = 'payment_pending'` to `expired`, then updates the
attempt with `WHERE id = ? AND status = 'pending'` to `expired`, setting
`resolvedAt` to one captured server timestamp. A failed guarded update rolls
back the transaction and returns the corresponding typed error. This prevents a
racing approval or a stale client from leaving a paid order marked expired.

An explicit expiry records two domain events after commit:

- `payment_attempt_result`, with outcome `expired` and failure reason
  `client_idle_timeout`;
- `order_expired`, with outcome `expired` and the same order, attempt, amount,
  attempt count, and elapsed duration properties.

A later reconcile call cannot pass the attempt-pending or order-pending guards,
so no expired order can reach payment approval or the kitchen queue.

## Server-side domain events

`src/lib/posthog.server.ts` owns a singleton `posthog-node` client and a typed
`captureDomainEvent` helper. `POSTHOG_KEY` and optional `POSTHOG_HOST` are
server-only environment fields; when the key is empty, the helper is a no-op.
The default host is `https://us.i.posthog.com`, matching the client provider.
Each capture is fire-and-forget and catches both synchronous and asynchronous
SDK failures. No caller awaits it or can fail because analytics is unavailable.
The distinct ID passed to PostHog is the server-derived kiosk ID.

Event names are canonical snake_case. Properties use snake_case and integer
amounts in cents:

| Event | Capture point | Required properties |
| --- | --- | --- |
| `payment_attempt_started` | committed `startPaymentAttempt` | `kiosk_id`, `order_id`, `attempt_id`, `amount_cents`, `attempt_count`, `elapsed_ms` |
| `payment_attempt_result` | every committed terminal reconcile/explicit-expire result | `kiosk_id`, `order_id`, `attempt_id`, `amount_cents`, `outcome`, `attempt_count`, `elapsed_ms`; failed outcomes also have `failure_reason` |
| `order_paid` | committed approved reconcile | `kiosk_id`, `order_id`, `attempt_id`, `amount_cents`, `outcome: 'approved'`, `attempt_count`, `elapsed_ms` |
| `order_expired` | committed explicit client expiry | `kiosk_id`, `order_id`, `attempt_id`, `amount_cents`, `outcome: 'expired'`, `failure_reason: 'client_idle_timeout'`, `attempt_count`, `elapsed_ms` |
| `kitchen_order_started` | committed `paid → preparing` transition | `kiosk_id`, `order_id`, `amount_cents`, `outcome: 'preparing'`, `elapsed_ms` |
| `kitchen_order_done` | committed `preparing → done` transition | `kiosk_id`, `order_id`, `amount_cents`, `outcome: 'done'`, `elapsed_ms` |

`attempt_count` is the number of payment attempts created for the order at the
capture point. `elapsed_ms` is the server-measured duration from the relevant
order/attempt start to the outcome. For rejected receipts, `failure_reason`
is a stable non-sensitive code (`receipt_invalid`, `declined`, `unavailable`,
or `expired`); receipt references and terminal commands are never properties.
The internal two-minute safety-valve expiry records only
`payment_attempt_result` (not `order_expired`) because its order remains
retryable.

The payment handler gathers all event data from server-trusted rows and invokes
capture only after its transaction has committed. Approval retains the existing
post-commit `order.paid` kitchen dispatch. Kitchen transition capture likewise
runs after its guarded transaction and alongside the existing dispatcher emit.

## Flow and failure isolation

```text
startPaymentAttempt
  └─ transaction: insert pending attempt + count attempts
     └─ commit
        └─ capture payment_attempt_started (best effort)

reconcilePaymentAttempt
  └─ transaction: validate + resolve attempt
     ├─ safety-valve expiry: attempt expired, order stays pending
     └─ approval: attempt approved + order paid
     └─ commit
        ├─ capture payment_attempt_result
        ├─ capture order_paid when approved
        └─ emit order.paid when approved

expirePaymentAttempt
  └─ transaction: pending attempt + pending order → both expired
     └─ commit
        ├─ capture payment_attempt_result (client_idle_timeout)
        └─ capture order_expired

advanceOrder
  └─ transaction: paid→preparing or preparing→done
     └─ commit
        ├─ capture kitchen_order_started/order_done
        └─ emit existing kitchen event
```

A PostHog constructor error, capture error, missing API key, or network outage
is swallowed by the analytics helper. Database errors, authorization errors,
validation errors, and existing dispatcher failures retain their existing
semantics; analytics is not used to hide domain failures.

## Testing and verification

The colocated payment tests use `createTestDatabase`, `mockDatabaseModule`,
and `withStartContext` with a unique temporary SQLite database. The first
implementation test is a failing test for `expirePaymentAttemptHandler` that
asserts both the terminal attempt and the order status, plus the rejected later
reconcile. Additional focused tests mock `captureDomainEvent` and assert each
of the six event names at its natural handler point, including explicit expiry
and kitchen transitions. They also replace server analytics configuration with
an empty key and verify captures are no-ops and never throw.

The red/green/refactor loop is followed before the final repository checks:

```bash
bun run lint && bun run format && bun run typecheck && bun run test
```

## Non-goals

This spec does not add cart-local analytics (the kiosk UI owns
`cart.abandoned`), a durable event log or retry queue, PostHog person
identification, card/receipt data capture, a new API route, payment retries
beyond the existing attempt lifecycle, order cancellation, or a database
migration for status. It does not alter the internal safety-valve behavior or
kitchen authorization and transition rules.
