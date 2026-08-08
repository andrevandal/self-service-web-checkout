# Kitchen queue Implementation Plan

> **For agentic workers:** Execute this plan task-by-task with the repository's TDD workflow. Steps use checkbox syntax for tracking.

**Goal:** Add staff-authenticated kitchen queue server functions, post-commit order events, and the authenticated `/api/kitchen/events` SSE stream for paid/preparing orders.

**Architecture:** Reuse a shared signed-cookie primitive for the existing kiosk cookie and new `staff_session`, but verify staff with a distinct `STAFF_COOKIE_SECRET` while both claims use the shared `KIOSK_CLAIM_PASSWORD` gate. Keep kitchen order reads/transitions in a focused server-function module over the existing immutable order/item tables. Emit a full paid order and minimal status transitions through a process-local dispatcher only after database commits; the sole raw route subscribes to that dispatcher and formats SSE.

**Tech Stack:** Bun, TypeScript, TanStack Start `createServerFn` and file routes, Valibot, Drizzle ORM with libSQL/SQLite, Web Streams, Bun Test, shared `src/test/db-test-support.ts`.

## Global Constraints

- `/kitchen` is staff-only; `claimStaffSession`, `listActiveOrders`, `advanceOrder`, and `GET /api/kitchen/events` require a valid signed `staff_session`.
- Staff claims use `KIOSK_CLAIM_PASSWORD` but sign/verify with distinct `STAFF_COOKIE_SECRET`; never accept or reuse `kiosk_session` authority and never put kiosk identity in staff claims.
- Staff cookies are HttpOnly, SameSite=Lax, Path=/, with `STAFF_COOKIE_SECURE` matching the existing secure-cookie switch.
- `listActiveOrders()` returns only `paid | preparing`, with complete immutable item, variant, and addon snapshots; order rows are oldest-first and `done` never appears.
- `advanceOrder({ data: { orderId, toStatus } })` permits only `paid → preparing → done`; guarded writes reject skips, backwards transitions, and stale concurrent updates.
- The dispatcher is in-process, non-persistent, non-replaying, and has no external dependency; horizontal app scaling remains out of scope.
- `order.paid` emits after the approval transaction commits and includes the full `KitchenOrder`; `order.preparing` and `order.done` emit after transitions commit and include `{ orderId, orderNumber, status }`.
- SSE uses only `/api/kitchen/events`; no ad-hoc kitchen REST routes are added. The stream unsubscribes on cancellation and sends comment heartbeats.
- Write colocated tests before production implementation, run them red, then green, then refactor. Reuse `src/test/db-test-support.ts`; skip repo-wide checks until the final task.
- Final checks are exactly `bun run lint && bun run format && bun run typecheck && bun run test`.

---

## File map

- Create: `src/lib/signed-cookie.server.ts` — generic HMAC-SHA256 signing/verifying primitive shared by kiosk and staff cookie modules.
- Modify: `src/lib/kiosk-cookie.server.ts` — preserve existing kiosk exports and cookie behavior while delegating crypto to the shared primitive.
- Create: `src/lib/staff-cookie.server.ts` — `staff_session` payload, cookie read/sign/set helpers, and strict payload validation.
- Modify: `src/env.ts` — add `STAFF_COOKIE_SECRET` and `STAFF_COOKIE_SECURE` server fields.
- Modify: `.env.example` — document the distinct staff secret and secure-cookie switch.
- Create: `src/lib/kitchen-events.server.ts` — event types, dispatcher, singleton.
- Create: `src/lib/kitchen.functions.ts` — staff claim, active-order listing, legal status transitions, and post-commit event emission.
- Modify: `src/lib/payment.functions.ts` — load the committed paid order and emit `order.paid` after its existing transaction resolves.
- Create: `src/routes/api/kitchen/events.ts` — authenticated SSE route subscribing to all three kitchen events.
- Create: `src/lib/kitchen.functions.test.ts` — red/green tests for staff auth, queue reads, transitions, dispatcher events, and paid-event wiring.
- Create: `src/routes/api/kitchen/events.test.ts` — focused route-to-dispatcher stream integration test.
- Create: `docs/specs/2026-08-08-kitchen-queue-design.md` (committed) — approved contract and rationale.
- Create: `docs/plans/2026-08-08-kitchen-queue-plan.md` (this file) — implementation sequence and verification.

## Interfaces between tasks

These exact types are shared with the frontend lane:

```ts
export type KitchenOrderItem = {
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

export type KitchenOrder = {
  id: string;
  orderNumber: string;
  status: "paid" | "preparing";
  subtotalCents: number;
  totalAmountCents: number;
  createdAt: string;
  paidAt: string;
  items: KitchenOrderItem[];
};

export type ClaimStaffSessionInput = { password: string };
export type StaffSession = { issuedAt: number };

export type AdvanceOrderInput = {
  orderId: string;
  toStatus: "preparing" | "done";
};

export type OrderStatusEvent = {
  type: "order.preparing" | "order.done";
  orderId: string;
  orderNumber: string;
  status: "preparing" | "done";
};

export type KitchenOrderEvent =
  | {
      type: "order.paid";
      orderId: string;
      orderNumber: string;
      status: "paid";
      order: KitchenOrder;
    }
  | OrderStatusEvent;

export const claimStaffSession: ReturnType<typeof createServerFn>;
export const listActiveOrders: ReturnType<typeof createServerFn>;
export const advanceOrder: ReturnType<typeof createServerFn>;
```

The frontend calls:

```ts
await claimStaffSession({ data: { password } });
const orders = await listActiveOrders();
const transition = await advanceOrder({
  data: { orderId, toStatus: "preparing" },
});
const events = new EventSource("/api/kitchen/events");
```

## Task 1: Write the failing colocated tests

**Files:**
- Create: `src/lib/kitchen.functions.test.ts`
- Create: `src/routes/api/kitchen/events.test.ts` (route assertions may be added after the route exists; the domain test is the required initial red test)
- Read/reuse: `src/test/db-test-support.ts`, `src/db/schema.ts`, `src/lib/kiosk-cookie.server.ts`, `src/lib/payment.functions.test.ts`

- [ ] **Step 1: Set up an isolated migrated database and server mocks.**

Create `kitchen.functions.test.ts` with `beforeEach`, `expect`, `mock`, and `test` from `bun:test`; `randomUUID` from `node:crypto`; Drizzle `eq`/`sql`; and shared test helpers. Initialize a unique file-backed migrated DB, insert kiosk A and B, and mock `#/db/client.server`, `#/env.server`, and `@tanstack/react-start/server` before importing not-yet-created handlers. The env mock must include both secrets and both secure switches:

```ts
mock.module("#/env.server", () => ({
  serverEnv: {
    KIOSK_CLAIM_PASSWORD: "shared-password",
    KIOSK_COOKIE_SECRET: "kiosk-secret",
    KIOSK_COOKIE_SECURE: false,
    STAFF_COOKIE_SECRET: "staff-secret",
    STAFF_COOKIE_SECURE: false,
  },
}));

let requestCookie = "";
mock.module("@tanstack/react-start/server", () => ({
  getRequestHeader: (name: string) => (name === "cookie" ? requestCookie : undefined),
  setResponseHeader: (name: string, value: string) => {
    if (name === "Set-Cookie") requestCookie = value;
  },
}));
```

Use helpers to set a signed staff cookie, set a signed kiosk cookie, insert orders/items/modifier snapshots, and clean child rows before orders in `beforeEach`. The test imports `signStaffCookie` and handlers after mocks so the module graph captures the in-memory dependencies.

- [ ] **Step 2: Write claim, dispatcher, list, and transition assertions before production code.**

Add tests with these observable assertions:

1. `claimStaffSessionHandler({ password: "wrong" })` rejects with `StaffSessionError.code === "invalid_password"`; the correct password returns `{ issuedAt: expect.any(Number) }`, sets `staff_session=...`, and a kiosk-signed token cannot be verified with the staff secret.
2. `listActiveOrdersHandler()` rejects without a valid staff cookie, returns only paid/preparing rows in `createdAt,id` order, and returns item variant/addon snapshots. Insert payment-pending and done rows and assert they are absent.
3. `advanceOrderHandler({ orderId, toStatus: "preparing" })` returns `{ type: "order.preparing", orderId, orderNumber, status: "preparing" }`, persists preparing, and a second call to done returns the matching done event; listing then returns an empty queue.
4. Direct dispatcher subscription receives paid/preparing/done events, paid preserves its full order, and the unsubscribe callback prevents later delivery.
5. Invalid skip (`paid → done`), backwards transition, unknown order, missing staff cookie, and malformed input reject with stable typed codes and do not mutate state.
6. Approved payment reconciliation is covered by extending the existing payment test setup or a dedicated kitchen test: subscribe before reconciliation, approve a pending attempt, assert one full `order.paid` event after result returns, and assert declined reconciliation emits nothing.

Use direct handler calls inside `withStartContext`. Keep each test focused and reset event subscribers in `afterEach` or unsubscribe every listener in the test body so the singleton cannot leak observations.

- [ ] **Step 3: Run the new domain test to establish red.**

Run:

```bash
bun test src/lib/kitchen.functions.test.ts
```

Expected: FAIL because staff/kitchen modules and their exports do not exist yet. Keep the test assertions unchanged; a missing module/export failure is the intended red state.

## Task 2: Add distinct staff cookie configuration and shared signing helpers

**Files:**
- Create: `src/lib/signed-cookie.server.ts`
- Modify: `src/lib/kiosk-cookie.server.ts`
- Create: `src/lib/staff-cookie.server.ts`
- Modify: `src/env.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: Existing kiosk cookie payload and `getRequestHeader`/`setResponseHeader` pattern.
- Produces: `signStaffCookie`, `verifyStaffCookie`, `readStaffCookie`, `setStaffCookie`, `STAFF_COOKIE_NAME`, `StaffCookiePayload`, and parsed `STAFF_COOKIE_SECRET`/`STAFF_COOKIE_SECURE`.

- [ ] **Step 1: Extract only the generic crypto operations.**

Move the existing base64url/HMAC/timing-safe comparison behavior into private or exported helpers in `signed-cookie.server.ts`:

```ts
export const signSignedCookie = (payload: object, secret: string): string => {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
};

export const verifySignedCookie = <T>(
  token: string,
  secret: string,
  isPayload: (value: unknown) => value is T,
): T | null => {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = createHmac("sha256", secret).update(encoded).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return isPayload(value) ? value : null;
  } catch {
    return null;
  }
};
```

Keep the existing kiosk payload validator strict and make its public functions delegate to these helpers. Do not change the `kiosk_session` token format or cookie attributes.

- [ ] **Step 2: Add strict staff cookie helpers.**

Implement `StaffCookiePayload = { issuedAt: number }` with exact object validation (reject extra/missing fields, non-integer/non-positive timestamps), `STAFF_COOKIE_NAME = "staff_session"`, and helpers matching kiosk behavior but accepting staff secret. `readStaffCookie(secret)` must parse only `staff_session`; it must never inspect `kiosk_session`. `setStaffCookie` must write `HttpOnly; SameSite=Lax; Path=/` and optional `; Secure`.

- [ ] **Step 3: Extend env validation and example.**

Add:

```ts
STAFF_COOKIE_SECRET: v.optional(v.string(), ""),
STAFF_COOKIE_SECURE: v.pipe(
  v.optional(v.union([v.boolean(), v.string()]), false),
  v.transform((value) => (typeof value === "string" ? value === "true" : value)),
),
```

Add `STAFF_COOKIE_SECRET=` and `STAFF_COOKIE_SECURE=false` to `.env.example` beside kiosk settings. The empty secret is allowed by parsing for consistent configuration errors; claim/list/advance/SSE handlers reject it before signing or verifying.

- [ ] **Step 4: Run focused existing cookie tests and the red kitchen test.**

Run:

```bash
bun test src/lib/kiosk.functions.test.ts src/lib/kitchen.functions.test.ts
```

Expected: existing kiosk tests pass; kitchen remains red for missing staff/kitchen modules. This confirms the helper extraction did not change kiosk behavior before domain implementation.

## Task 3: Implement staff claim, dispatcher, listing, and guarded transitions

**Files:**
- Create: `src/lib/kitchen-events.server.ts`
- Create: `src/lib/kitchen.functions.ts`
- Modify: `src/lib/kitchen.functions.test.ts`

**Interfaces:**
- Consumes: staff cookie helpers, `serverEnv`, existing `orders`/`orderItems`/modifier tables, dispatcher singleton.
- Produces: `claimStaffSessionHandler`, `claimStaffSession`, `listActiveOrdersHandler`, `listActiveOrders`, `advanceOrderHandler`, `advanceOrder`, `KitchenOrder`, `KitchenOrderEvent`, and typed `StaffSessionError`/`KitchenOrderError`.

- [ ] **Step 1: Implement the dispatcher as the smallest testable module.**

Define the discriminated `KitchenOrderEvent` union from the interfaces section. Implement:

```ts
type KitchenEventListener = (event: KitchenOrderEvent) => void;

export class KitchenEventDispatcher {
  private readonly listeners = new Set<KitchenEventListener>();

  subscribe(listener: KitchenEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: KitchenOrderEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}

export const kitchenEventDispatcher = new KitchenEventDispatcher();
```

Use a copied listener array so unsubscribe during a dispatch is deterministic. Do not add replay, persistence, or a global event bus dependency.

- [ ] **Step 2: Implement shared staff authorization and claim.**

In `kitchen.functions.ts`, validate input with Valibot, compare password digests using `createHash("sha256")` plus `timingSafeEqual`, require both claim password and staff secret, and set `{ issuedAt: Date.now() }` via `setStaffCookie`. Return the same `StaffSession` object and expose the POST named server function:

```ts
export const claimStaffSession = createServerFn({ method: "POST" })
  .validator((input) => validateClaimStaffSessionInput(input))
  .handler(({ data }) => claimStaffSessionHandler(data));
```

Define `StaffSessionErrorCode = "configuration" | "invalid_password" | "invalid_input"` and use the same code for malformed password input rather than leaking parser details.

- [ ] **Step 3: Implement active-order loading and serializable snapshot mapping.**

Add a private authorization check requiring a non-empty `STAFF_COOKIE_SECRET` and `readStaffCookie(secret)`. Query active orders with `inArray(orders.status, ["paid", "preparing"])`, `asc(orders.createdAt)`, and `asc(orders.id)`. Query all matching order items and their variant/addon child rows, group them by `orderId`/`orderItemId`, and map dates to ISO strings. Require non-null `orderNumber` and `paidAt` for active paid/preparing rows; if a corrupt row violates that invariant, throw a typed `KitchenOrderError` rather than returning a non-serializable/partial order.

Export the GET server function with no input:

```ts
export const listActiveOrders = createServerFn({ method: "GET" }).handler(
  listActiveOrdersHandler,
);
```

- [ ] **Step 4: Implement guarded paid→preparing→done transitions.**

Validate `{ orderId: non-empty string, toStatus: "preparing" | "done" }`. Require staff authorization. In one transaction, select id/orderNumber/status, map the expected current status (`preparing` requires `paid`; `done` requires `preparing`), and update with `where(and(eq(id, orderId), eq(status, expected)))`. If no row exists return `order_not_found`; if status is not expected return `invalid_transition`. Return the matching `OrderStatusEvent` and, only after the transaction promise resolves, emit it as a `KitchenOrderEvent` through `kitchenEventDispatcher`.

Export:

```ts
export const advanceOrder = createServerFn({ method: "POST" })
  .validator((input) => validateAdvanceOrderInput(input))
  .handler(({ data }) => advanceOrderHandler(data));
```

- [ ] **Step 5: Run the focused domain test for green.**

Run:

```bash
bun test src/lib/kitchen.functions.test.ts
```

Expected: PASS for staff claim, strict staff-cookie authorization, list filtering/snapshots, legal transitions, invalid transitions, and dispatcher behavior. If failures expose mapper/query bugs, fix production code or assertions only when they contradict the design contract; do not broaden scope.

## Task 4: Wire `order.paid` after payment commit

**Files:**
- Modify: `src/lib/payment.functions.ts`
- Modify: `src/lib/kitchen.functions.ts` or `src/lib/kitchen-events.server.ts` only if a shared snapshot loader is needed
- Modify: `src/lib/kitchen.functions.test.ts` or `src/lib/payment.functions.test.ts`

**Interfaces:**
- Consumes: Existing approval result and committed `orders`/`orderItems`/modifier snapshots.
- Produces: exactly one full `order.paid` event for a successful approval; no event for declined/unavailable/invalid/expired paths.

- [ ] **Step 1: Add the approval event assertion while preserving payment semantics.**

Subscribe to `kitchenEventDispatcher` before an approved reconciliation, call the existing handler with a valid kiosk cookie and receipt, then assert after the promise resolves that the event is:

```ts
{
  type: "order.paid",
  orderId,
  orderNumber: result.orderNumber!,
  status: "paid",
  order: {
    id: orderId,
    orderNumber: result.orderNumber!,
    status: "paid",
    subtotalCents: expect.any(Number),
    totalAmountCents: expect.any(Number),
    createdAt: expect.any(String),
    paidAt: expect.any(String),
    items: expect.any(Array),
  },
}
```

Also assert a declined reconciliation leaves the event array empty. Unsubscribe listeners in a `finally` block.

- [ ] **Step 2: Emit only after the existing transaction resolves.**

Keep all current validation, counter allocation, order update, attempt update, and result shape unchanged. After the existing `transactionResult` terminal-error branch and before returning the result, check `transactionResult.value.orderStatus === "paid"`; load the now-committed full `KitchenOrder` through the kitchen snapshot helper and emit:

```ts
kitchenEventDispatcher.emit({
  type: "order.paid",
  orderId: paidOrder.id,
  orderNumber: paidOrder.orderNumber,
  status: "paid",
  order: paidOrderSnapshot,
});
```

The snapshot loader must query committed data after the transaction; it must not use an uncommitted transaction object. Do not emit on terminal errors or failed/rolled-back updates.

- [ ] **Step 3: Run payment and kitchen focused tests.**

Run:

```bash
bun test src/lib/payment.functions.test.ts src/lib/kitchen.functions.test.ts
```

Expected: all existing payment tests remain green and the new approval/decline event assertions pass. This is the red-green proof that spec 4's approval path is wired without changing its checkout contract.

## Task 5: Implement and integration-test authenticated kitchen SSE

**Files:**
- Create: `src/routes/api/kitchen/events.ts`
- Create: `src/routes/api/kitchen/events.test.ts`

**Interfaces:**
- Consumes: `readStaffCookie`, `serverEnv`, `kitchenEventDispatcher`, `KitchenOrderEvent`.
- Produces: `GET /api/kitchen/events` with status 401 for missing/invalid staff, status 200 stream for valid staff, and standard SSE event frames.

- [ ] **Step 1: Add the route and authentication guard.**

Create the nested directory/file route with `createFileRoute("/api/kitchen/events")`. In `GET`, require non-empty `STAFF_COOKIE_SECRET` and `readStaffCookie`; return `new Response("Staff session required", { status: 401 })` before creating a stream when unauthorized.

For authorized requests, create a `ReadableStream<Uint8Array>` and `TextEncoder`. Enqueue `: connected\n\n`, subscribe to the dispatcher, and encode each event as:

```ts
const frame = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
controller.enqueue(encoder.encode(frame));
```

Return headers:

```ts
{
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "Content-Type": "text/event-stream; charset=utf-8",
}
```

- [ ] **Step 2: Add heartbeat and cancellation cleanup.**

Use a 15-second `setInterval` to enqueue `: heartbeat\n\n`. In `cancel`, clear the interval and invoke the unsubscribe callback. Guard enqueue operations so a cancelled/closed controller cannot cause an unhandled stream error; do not retain listeners after cancellation. Do not replay existing events or query the database in this route.

- [ ] **Step 3: Test the actual route-to-dispatcher wiring.**

Mock `#/env.server`, `@tanstack/react-start/server` cookie access, and import the route after mocks. Extract `Route.options.server?.handlers.GET` as the existing health route test does. Call it with a valid staff cookie, read the first chunk and assert `: connected`; emit a paid event with a full order, read the next chunk and assert `event: order.paid` and JSON data; call `reader.cancel()` and emit another event, asserting no additional chunk is delivered. Add an unauthorized call asserting status 401. Use a short helper that reads with a `Promise.race` timeout so a missing cleanup/extra event fails deterministically without a permanent hanging test.

- [ ] **Step 4: Run route and domain focused checks.**

Run:

```bash
bun test src/routes/api/kitchen/events.test.ts src/lib/kitchen.functions.test.ts src/lib/payment.functions.test.ts
```

Expected: authenticated stream emits connected and dispatcher frames, cancellation unsubscribes, unauthorized requests are rejected, and all domain/payment tests pass.

## Task 6: Commit docs/code, notify frontend, and run final checks

**Files:**
- Modify: `GOAL.md` — append the spec 5 shipped log entry with commit hashes, exact contracts, focused-test evidence, and final check result.
- Modify: `docs/specs/2026-08-08-kitchen-queue-design.md` and this plan only if implementation reveals an approved contract correction.

- [ ] **Step 1: Review the complete diff and generated route artifacts.**

Confirm the change contains no persistence migration (the existing orders/item schema is sufficient), no kiosk-authority fallback, no extra kitchen REST route, no SSE listener leak, and no placeholder/TODO text. If TanStack route generation updates `src/routeTree.gen.ts`, include the generated change; do not hand-edit it.

- [ ] **Step 2: Run the required final checks.**

Run exactly:

```bash
bun run lint && bun run format && bun run typecheck && bun run test
```

Expected: every command exits zero and the test command reports all colocated tests passing. If `format` changes files, rerun the complete command and include the resulting formatting commit content.

- [ ] **Step 3: Commit the implementation with scoped Conventional Commit.**

Use:

```bash
git add .env.example src/env.ts src/lib src/routes/api/kitchen docs/specs/2026-08-08-kitchen-queue-design.md docs/plans/2026-08-08-kitchen-queue-plan.md GOAL.md

git commit -m "feat(kitchen): add staff order queue"
```

Do not bypass hooks. Record the implementation commit hash and final command output for Main.

- [ ] **Step 4: Notify the current kiosk-ui agent and Main.**

Run `hub op:"list"` immediately before notification to identify the current kiosk UI peer. Send that peer this exact contract:

```text
Backend kitchen contract is stable:
- claimStaffSession({ data: { password } }): Promise<{ issuedAt: number }>; sets HttpOnly SameSite=Lax Path=/ `staff_session`, gated by KIOSK_CLAIM_PASSWORD and signed with STAFF_COOKIE_SECRET (never kiosk_session).
- listActiveOrders(): Promise<KitchenOrder[]> under query key ['kitchen','orders']; KitchenOrder = { id, orderNumber, status: 'paid'|'preparing', subtotalCents, totalAmountCents, createdAt: ISO string, paidAt: ISO string, items: KitchenOrderItem[] }; item snapshots include id/productId/productName/quantity/unitPriceCents plus variants [{id,optionId,optionName,priceDeltaCents}] and addons [{id,addonId,addonName,priceDeltaCents}].
- advanceOrder({ data: { orderId, toStatus: 'preparing'|'done' } }): Promise<{ type: 'order.preparing'|'order.done', orderId, orderNumber, status: 'preparing'|'done' }>; only paid->preparing->done.
- SSE: GET /api/kitchen/events; event frames `order.paid`, `order.preparing`, `order.done`. Paid data has { type:'order.paid', orderId, orderNumber, status:'paid', order: KitchenOrder }; preparing/done data has { type, orderId, orderNumber, status }.
```

Then send Main the implementation commit hash, design/plan commit hashes, focused red/green evidence, final full-check result, and confirmation that the current kiosk-ui peer received the contract.
