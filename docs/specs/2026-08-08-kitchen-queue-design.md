# Kitchen queue design

## Contents

- [Goal and scope](#goal-and-scope)
- [Design decisions](#design-decisions)
- [Staff session](#staff-session)
- [Kitchen server-function contracts](#kitchen-server-function-contracts)
- [In-process events](#in-process-events)
- [Kitchen SSE route](#kitchen-sse-route)
- [Payment and transition event flow](#payment-and-transition-event-flow)
- [Errors and concurrency](#errors-and-concurrency)
- [Testing and verification](#testing-and-verification)
- [Non-goals](#non-goals)

## Goal and scope

Implement the backend half of the PRD's kitchen flow. Staff opens `/kitchen`,
submits the shared `KIOSK_CLAIM_PASSWORD`, and receives a separate signed
`staff_session` cookie. The queue reads only orders in `paid` or `preparing`
status, and staff can advance each order exactly through `paid → preparing →
done`. A done order is no longer returned by the active queue.

The named TanStack Start server functions are the frontend boundary:
`claimStaffSession`, `listActiveOrders`, and `advanceOrder`. The one approved
raw-route exception is `GET /api/kitchen/events`, an authenticated Server-Sent
Events stream used for in-process delivery. No kitchen REST CRUD route or
server-side session table is added.

## Design decisions

### Separate staff authority and secret

The existing kiosk cookie-signing pattern is reused through a shared signed
cookie primitive, but staff has its own cookie name and secret. The staff cookie
is `staff_session` and contains only `{ issuedAt }`. It is signed with a new
required `STAFF_COOKIE_SECRET`, never `KIOSK_COOKIE_SECRET`; the shared
`KIOSK_CLAIM_PASSWORD` is only the claim gate. This makes a kiosk cookie fail
staff verification even if a caller copies its value between cookie names, and
keeps the staff authority independent of kiosk identity.

`STAFF_COOKIE_SECURE` follows the existing `KIOSK_COOKIE_SECURE` switch. Both
cookies are HttpOnly, SameSite=Lax, and Path=/. There is no kiosk id in staff
claims, no staff identity in kiosk claims, and no server-side session state.

### Single-process dispatcher

The dispatcher is an in-process module with a small subscribe/emit interface.
It has no persistence, external broker, replay buffer, or cross-process
coordination. This matches the PRD's single-process POC ceiling; horizontal
scaling remains unsupported until shared pub/sub exists.

Events use this stable envelope:

```ts
type KitchenOrderEvent = {
  type: "order.paid" | "order.preparing" | "order.done";
  orderId: string;
  orderNumber: string;
  status: "paid" | "preparing" | "done";
  order?: KitchenOrder; // present on order.paid
};
```

A paid event includes the complete `KitchenOrder`, including immutable item and
modifier snapshots, so a connected queue can append a new row without a
refetch. Preparing and done events carry the minimal transition envelope; the
queue already has that order and only patches its status (done is then removed).

## Staff session

The staff claim handler validates `{ password: string }`, compares the supplied
password to `KIOSK_CLAIM_PASSWORD` with the same constant-time digest pattern
as kiosk claiming, and sets a newly issued signed cookie after a successful
check. It fails with a typed error when configuration, password, or input is
invalid.

```ts
export type ClaimStaffSessionInput = {
  password: string;
};

export type StaffSession = {
  issuedAt: number;
};

export const claimStaffSession: ServerFn<
  "POST",
  ClaimStaffSessionInput,
  StaffSession
>;

// Call shape:
claimStaffSession({ data: { password } }): Promise<StaffSession>;
```

The implementation exports `claimStaffSessionHandler` for direct tests and
wraps it in a POST `createServerFn`. The handler does not read or create a
kiosk, and the returned `issuedAt` is server-generated rather than client
supplied.

## Kitchen server-function contracts

Every read/write handler first requires a valid `staff_session` signed with
`STAFF_COOKIE_SECRET`. Missing, malformed, or incorrectly signed staff cookies
are rejected as `staff_identity`; no kiosk cookie is accepted as a fallback.

The queue's serializable order shape is:

```ts
type KitchenOrderItem = {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  variants: Array<{
    id: string;
    optionId: string;
    optionName: string;
    priceDeltaCents: number;
  }>;
  addons: Array<{
    id: string;
    addonId: string;
    addonName: string;
    priceDeltaCents: number;
  }>;
};

type KitchenOrder = {
  id: string;
  orderNumber: string;
  status: "paid" | "preparing";
  subtotalCents: number;
  totalAmountCents: number;
  createdAt: string; // ISO-8601 server timestamp
  paidAt: string; // ISO-8601 server timestamp
  items: KitchenOrderItem[];
};
```

`listActiveOrders` has no input and returns active rows ordered oldest first
(`createdAt`, then id), with all item/modifier snapshots. Its call shape is:

```ts
listActiveOrders(): Promise<KitchenOrder[]>;
```

`advanceOrder` accepts a requested next status and returns the event envelope
without the optional full order:

```ts
type AdvanceOrderInput = {
  orderId: string;
  toStatus: "preparing" | "done";
};

type OrderStatusEvent = {
  type: "order.preparing" | "order.done";
  orderId: string;
  orderNumber: string;
  status: "preparing" | "done";
};

advanceOrder({
  data: { orderId, toStatus },
}): Promise<OrderStatusEvent>;
```

The handler permits only `paid → preparing` and `preparing → done`. It does not
accept `paid → done`, `preparing → paid`, updates to `expired`/`payment_pending`,
or any other status.

## In-process events

`src/lib/kitchen-events.server.ts` owns the dispatcher and its event types. A
subscription returns an unsubscribe function. Emission is synchronous and
non-replaying: listeners that are connected at emit time receive the event;
late subscribers rely on `listActiveOrders`/Refresh for current state.

The payment approval path in `reconcilePaymentAttemptHandler` emits
`order.paid` only after its transaction resolves successfully, so a listener
never receives a paid event for a rolled-back order. The event is built from
the committed order and item snapshots. `advanceOrderHandler` likewise emits
`order.preparing` or `order.done` only after its status update transaction
commits.

## Kitchen SSE route

`GET /api/kitchen/events` is the sole raw API route. It requires the staff
cookie before opening a stream and returns `401` when staff configuration or
identity is absent/invalid. Successful responses use:

- `Content-Type: text/event-stream; charset=utf-8`;
- `Cache-Control: no-cache, no-transform`;
- `Connection: keep-alive`.

Each event is encoded as standard SSE:

```text
event: order.paid
data: {"type":"order.paid",...}

```

The route subscribes one listener to all three dispatcher events and removes
it when the stream is cancelled. A comment heartbeat keeps idle connections
open; it is not a domain event and is ignored by EventSource. Because the
stream is in-process and non-replaying, initial load and visible Refresh call
`listActiveOrders`; SSE only applies changes observed after subscription.

The kiosk UI owns the TanStack Query cache. It stores the initial result under
`['kitchen', 'orders']`, appends the full `order.paid` payload, patches status
for preparing, removes done rows, and exposes Refresh as an invalidation and
refetch. The backend does not import or manipulate the frontend cache.

## Payment and transition event flow

```text
reconcilePaymentAttempt approval
  └─ transaction: number allocation + order paid + attempt approved
     └─ commit
        └─ emit order.paid { orderId, orderNumber, status, order }

advanceOrder paid→preparing
  └─ transaction: guarded status update
     └─ commit
        └─ emit order.preparing { orderId, orderNumber, status }

advanceOrder preparing→done
  └─ transaction: guarded status update
     └─ commit
        └─ emit order.done { orderId, orderNumber, status }
```

The payment handler continues returning its existing checkout result; event
emission is an additional post-commit delivery side effect and does not alter
payment ownership, receipt validation, or number allocation.

## Errors and concurrency

The typed staff errors use stable codes:

- `configuration`: claim password or staff cookie configuration is absent;
- `invalid_password`: the shared password does not match;
- `invalid_input`: malformed claim or transition input;
- `staff_identity`: staff cookie is missing, invalid, or cannot be verified;
- `order_not_found`: the requested order does not exist;
- `invalid_transition`: the requested transition is not the next legal state.

`advanceOrder` reads the current row and updates with both order id and expected
current status in the same transaction. Concurrent workers therefore cannot
both successfully perform the same transition or skip a state. A stale worker
receives `invalid_transition` and no event is emitted. Listing is read-only and
never exposes payment-pending, done, or expired orders.

## Testing and verification

The colocated `src/lib/kitchen.functions.test.ts` uses the shared
`createTestDatabase`, `mockDatabaseModule`, and `withStartContext` helpers with a
unique temporary SQLite database. Tests are drafted and run red before the
implementation, then turned green and refactored. They cover:

- correct and incorrect staff claims, cookie issuance, and rejection of a
  kiosk cookie under the distinct staff secret;
- list authorization, active-status filtering, deterministic ordering, and
  complete item/modifier snapshots;
- legal paid→preparing→done transitions and removal from active listing;
- invalid skips, backward transitions, missing orders, and concurrent/stale
  transition protection;
- dispatcher subscribe/emit/unsubscribe behavior and all three event shapes;
- approved payment reconciliation emitting `order.paid` only after the paid
  transaction commits.

A focused route-level integration check opens the SSE handler with a mocked
request context, reads the initial stream, emits a dispatcher event, and
asserts the encoded event name/data before cancelling the stream. This verifies
the actual route-to-dispatcher wiring without building a full reconnect,
network, or browser EventSource harness for this single-process POC.

Final repository checks are:

```bash
bun run lint && bun run format && bun run typecheck && bun run test
```

## Non-goals

This spec does not add inventory, kitchen assignment, cancellation, editing,
archival/history views, done-order persistence changes, durable event replay,
external pub/sub, multi-process SSE fan-out, or frontend components. It does
not change kiosk authority or the payment validation contract, and it does not
capture PostHog domain events (spec 6 owns those outcomes).
