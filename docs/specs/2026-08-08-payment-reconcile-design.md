# Fake device and payment reconcile design

## Contents

- [Goal and scope](#goal-and-scope)
- [Design decisions](#design-decisions)
- [Payment attempt persistence](#payment-attempt-persistence)
- [Server-function contracts](#server-function-contracts)
- [Attempt lifecycle and validation](#attempt-lifecycle-and-validation)
- [Order-number allocation](#order-number-allocation)
- [Errors and transaction behavior](#errors-and-transaction-behavior)
- [Testing and verification](#testing-and-verification)
- [Non-goals](#non-goals)

## Goal and scope

Implement the backend half of the PRD's simulated checkout steps 3–8. A pending
order can start an immutable simulated terminal attempt. The server returns a
one-time command and its expected integer-cent amount; the client terminal
adapter executes that command and returns a structured simulated receipt. The
server then validates kiosk ownership, attempt lifecycle, internal expiry,
command correlation, and amount before approving the attempt and order.

Approval is the only path that assigns the kiosk-prefixed pickup number and
transitions the order from `payment_pending` to `paid`. A declined or unavailable
terminal result is recorded on its attempt and leaves the order pending so a
new attempt can be started. Invalid and expired attempts are also recorded and
cannot be reconciled again. The only application boundary is a named TanStack
Start POST server function; no payment REST route is added.

The attempt's two-minute `expires_at` is a server safety valve for a command that
is never completed. It is separate from the PRD's idle-payment timeout: spec 6
will expose `expirePaymentAttempt()` and have the client trigger it when the
shared inactivity countdown expires.

## Design decisions

### Structured POC receipt

The terminal adapter returns a structured receipt rather than an encoded token:

```ts
type PaymentReceipt = {
  terminalCommand: string;
  reference: string;
  amountCents: number;
  outcome: "approved" | "declined" | "unavailable";
};
```

`reference` is an opaque simulated receipt/reference and is stored without
interpreting it. The command, amount, and outcome are explicit because this POC
models flow control rather than real payment security. The server compares the
returned command with the stored one-time command and the returned amount with
the order's expected amount. Tests can force `declined` or `unavailable` by
constructing a receipt with that outcome; the fake terminal defaults to
`approved` in the kiosk-ui adapter. A real TEF, pinpad, provider signature, or
cryptographic receipt verification is deliberately absent.

### One row per attempt and retry semantics

`payment_attempts` has one row for every simulated terminal command. A pending
row is resolved at most once to `approved`, `declined`, `unavailable`, `invalid`,
or `expired`; it is never deleted or reused. A failed row remains an audit
record, and retrying the same pending order calls `startPaymentAttempt` again
to create a new row and command. Ownership is derived from the order's kiosk and
verified against the signed `kiosk_session` cookie; the client never submits a
trusted kiosk id.

### Approval is one transaction

Reconciliation loads and validates the attempt, order, and kiosk in one
transaction. On approval, the transaction increments or creates the
`kiosk_order_counters(kiosk_id, service_date)` row, sets the order number and
paid timestamp, and marks the attempt approved. Any failure rolls back all
three changes, so an approved attempt cannot exist without a paid order and
allocated number. The service date comes from the server process's `TZ`
environment via `Intl.DateTimeFormat`, never from browser time. When `TZ` is
unset, the process's explicit UTC fallback is used.

## Payment attempt persistence

The migration adds this table:

```text
payment_attempts
  id                    text primary key (UUID)
  order_id              text not null, foreign key orders(id) on delete cascade
  status                text not null
                        pending | approved | declined | unavailable |
                        invalid | expired
  terminal_command      text not null
  receipt               text nullable (opaque reference)
  expected_amount_cents integer not null
  created_at            integer not null, server timestamp in milliseconds
  expires_at            integer not null, server timestamp in milliseconds
  resolved_at           integer nullable, server timestamp in milliseconds
```

The attempt does not duplicate kiosk id or a client-supplied amount. The order
relationship is the ownership source and the expected amount is copied from the
immutable pending order snapshot at start time. `receipt` is populated only when
a terminal result is received; pending attempts have no receipt. Foreign-key
cascade matches the existing order child tables, while application code never
reuses or deletes an attempt during normal checkout. A pending order may have
multiple attempts, but only one approved attempt can transition the order to
paid because reconciliation requires the order to remain `payment_pending`.

## Server-function contracts

The handlers are exported for colocated direct tests, and the named functions
are the only frontend boundary:

```ts
type StartPaymentAttemptInput = {
  orderId: string;
};

type StartPaymentAttemptResult = {
  id: string;
  orderId: string;
  status: "pending";
  terminalCommand: string;
  expectedAmountCents: number;
  expiresAt: string; // ISO-8601 server timestamp
};

export const startPaymentAttempt = createServerFn({ method: "POST" })
  .validator((input) => validateStartPaymentAttemptInput(input))
  .handler(({ data }) => startPaymentAttemptHandler(data));

type ReconcilePaymentAttemptInput = {
  attemptId: string;
  receipt: PaymentReceipt;
};

type ReconcilePaymentAttemptResult = {
  attemptId: string;
  orderId: string;
  attemptStatus: "approved" | "declined" | "unavailable";
  orderStatus: "paid" | "payment_pending";
  orderNumber: string | null;
  amountCents: number;
  reference: string;
};

export const reconcilePaymentAttempt = createServerFn({ method: "POST" })
  .validator((input) => validateReconcilePaymentAttemptInput(input))
  .handler(({ data }) => reconcilePaymentAttemptHandler(data));
```

Clients call `startPaymentAttempt({ data: { orderId } })`, pass the returned
`terminalCommand` to their fake terminal adapter, then call
`reconcilePaymentAttempt({ data: { attemptId, receipt } })`. A successful result
contains the pickup number. Declined and unavailable results contain a null
number and leave the order retryable.

## Attempt lifecycle and validation

`startPaymentAttempt` performs these checks before inserting anything:

1. Validate a non-empty `orderId`.
2. Verify the signed kiosk cookie and that its kiosk still exists.
3. Load the order and require that its `kiosk_id` matches the cookie and its
   status is `payment_pending`.
4. Generate a random command string, copy `total_amount_cents` into
   `expected_amount_cents`, and set `created_at` and `expires_at` using the
   server clock.

`reconcilePaymentAttempt` performs all checks inside a transaction:

1. Validate a non-empty attempt id and all receipt fields, including a non-empty
   opaque `reference`, integer non-negative amount, and allowed outcome.
2. Verify the signed kiosk cookie and load the attempt joined to its order and
   kiosk. A different kiosk receives an ownership error and the row is not
   changed.
3. Require `pending`. An already-resolved attempt receives a state error and is
   not changed; this prevents double reconciliation.
4. If the server clock is after `expires_at`, set status `expired` and
   `resolved_at`, then reject with an expiry error. It cannot later be retried.
5. Compare `receipt.terminalCommand` with the stored one-time command and
   `receipt.amountCents` with `expected_amount_cents`. A mismatch records status
   `invalid`, receipt reference, and `resolved_at`, then rejects with an invalid
   receipt error.
6. Store the opaque reference and resolve the attempt to the requested outcome.
   For `declined` and `unavailable`, the order remains `payment_pending` and the
   function returns a retryable result.
7. For `approved`, allocate the number and update the order and attempt in the
   same transaction, then return the paid result.

A client cannot turn a declined/unavailable result into approval by retrying the
same row: every receipt resolves the pending row exactly once, and the next
attempt gets a new command. The server does not trust an amount supplied at
`startPaymentAttempt`; it reads the persisted order total.

## Order-number allocation

At approval, calculate `service_date` with the server's configured timezone:

```ts
const serviceDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: process.env.TZ || "UTC",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
```

The counter row uses `(kiosk_id, service_date)` as its primary key. An SQLite
insert-or-update increments `next_number` atomically: inserting a missing day
starts it at `2` and allocates `1`; updating an existing row increments it and
allocates the previous value. The returned order number is
`<kiosk.prefix>-<allocated number>` (for example `A-13`). Thus numbers are
kiosk-prefixed and reset per server-timezone service day, while browser-provided
clock values cannot affect numbering.

## Errors and transaction behavior

Failures use a typed `PaymentAttemptError` with stable codes:

- `configuration`: cookie secret is absent;
- `kiosk_identity`: cookie is missing, invalid, or its kiosk no longer exists;
- `invalid_input`: malformed ids or receipt fields;
- `order_not_pending`: the order is missing, belongs to another kiosk, or is no
  longer `payment_pending` when starting an attempt;
- `attempt_not_found`: the attempt does not exist;
- `attempt_ownership`: the attempt belongs to another kiosk;
- `attempt_resolved`: the row is already approved, declined, unavailable,
  invalid, or expired;
- `attempt_expired`: the pending command passed its two-minute safety expiry;
- `receipt_invalid`: command correlation or expected amount failed.

Ownership and already-resolved failures leave the database unchanged. Expiry and
receipt mismatches are terminal outcomes and update the attempt once before the
handler throws, preserving the immutable failure record. Declined/unavailable
are valid terminal results and return normally. Approval updates the attempt,
order, and counter atomically; transaction rollback prevents partial payment or
number allocation.

## Testing and verification

The colocated `src/lib/payment.functions.test.ts` uses the shared
`createTestDatabase`, `mockDatabaseModule`, and `withStartContext` helpers and a
unique temporary file-backed SQLite URL. It inserts a kiosk and pending order,
sets the signed kiosk cookie, and calls the extracted handlers directly.

The red-before-green test sequence covers:

- successful approval stores the receipt, marks the attempt approved and order
  paid, assigns a kiosk-prefixed number, and increments the counter;
- a second service-date allocation starts at one for that kiosk/day and a
  different date starts at one again;
- a receipt from a different kiosk is rejected without mutating the attempt;
- a command past its expiry is rejected and recorded as `expired`;
- reconciling an already-resolved attempt is rejected without a second number;
- a wrong amount is rejected and recorded as `invalid`;
- command mismatch is recorded as `invalid`;
- declined and unavailable receipts are recorded while the order stays pending,
  and a new start call creates a distinct attempt.

The narrow test is run during red/green/refactor. Final repository verification
is:

```bash
bun run lint && bun run format && bun run typecheck && bun run test
```

## Non-goals

This spec does not integrate real TEF, pinpads, card networks, payment
providers, cryptographic receipt validation, printer hardware, PostHog events,
or idle-cart expiry. It does not add `/api/orders` or
`/api/payment-attempts/:id/reconcile` routes; named server functions are the
boundary. Spec 6 owns client-inactivity expiry and its domain event. The kiosk-ui
lane owns the fake terminal/printer adapters and invokes the two server
functions using the contracts above.
