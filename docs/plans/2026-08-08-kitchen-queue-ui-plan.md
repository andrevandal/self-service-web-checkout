# Kitchen queue UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a staff-password-gated `/kitchen` route that displays the active paid/preparing order queue, advances legal order states, and patches the TanStack Query cache from live SSE events.

**Architecture:** `src/lib/kitchen.ts` exposes the exact named server-function-shaped staff/session, queue, and transition seams plus deterministic local fixtures. `KitchenScreen` owns the staff gate, queue query, action mutations, EventSource lifecycle, connection label, and cache event reducer; the route only mounts the screen. A browser-only injection hook lets the e2e test exercise the same cache event reducer without a real backend SSE endpoint, and is replaced by the real `/api/kitchen/events` stream at the seam boundary.

**Tech Stack:** React 19, TanStack Start `createServerFn`, TanStack Query, TanStack Router, TypeScript, Lucide React, Bun test, Playwright.

## Global Constraints

- `claimStaffSession({ data: { password } })`, `listActiveOrders()`, and `advanceOrder({ data: { orderId, toStatus } })` are named `createServerFn` functions invoked by TanStack Query; no raw `fetch` is added.
- `EventSource('/api/kitchen/events')` is the sole transport exception. Its `order.paid`, `order.preparing`, and `order.done` handlers patch `['kitchen', 'orders']` with `queryClient.setQueryData`.
- The staff authority is a distinct HttpOnly, SameSite=Lax, Path=/ `staff_session` cookie. The implementation never reads or reuses `kiosk_session`.
- The active cache contains only `paid` and `preparing` orders. Legal transitions are `paid → preparing → done`; `done` removes an order from the cache.
- Use paper/Inter/forest-green tokens with a dense one-or-two-column staff layout, a simple header, prominent order number, status, snapshots, and one legal action per card.
- The browser test is written and committed before the route/seam/component implementation, and must fail before implementation.
- Error copy is sentence case, direct, and never exposes passwords, cookies, card data, or transport details.
- Do not run formatters, linters, or repository-wide checks until the final verification task.

---

### Task 1: Add the failing kitchen browser flow

**Files:**
- Create: `e2e/browser/kitchen-queue.spec.ts`
- Create: `e2e/browser/kitchen-queue-helpers.ts`

**Interfaces:**
- Consumes: the future `/kitchen` screen, fixture password `warm-melted`, fixture order number `A-101`, and the browser-only `window.__kitchenInjectEvent` test hook.
- Produces: a red Playwright contract for staff gate, queue snapshots, legal transitions, removal after Done, and cache patching from a synthetic paid SSE event.

- [ ] **Step 1: Write the browser test before implementation**

Create `e2e/browser/kitchen-queue.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { enterStaffPassword } from "./kitchen-queue-helpers";

test("staff can work the active queue and receive a paid SSE order", async ({ page }) => {
  await page.goto("/kitchen");

  await expect(page.getByRole("heading", { name: "Kitchen queue" })).toBeVisible();
  await enterStaffPassword(page);
  const fixtureCard = page.getByTestId("kitchen-order-A-101");
  await expect(fixtureCard).toBeVisible();
  await expect(fixtureCard.getByText("A-101")).toBeVisible();
  await expect(fixtureCard.getByText("Melted mushroom toastie")).toBeVisible();
  await expect(fixtureCard.getByText("Sourdough")).toBeVisible();
  await expect(fixtureCard.getByText("Extra cheese")).toBeVisible();
  await expect(fixtureCard.getByText("Paid")).toBeVisible();

  await fixtureCard.getByRole("button", { name: "Start preparing" }).click();
  await expect(fixtureCard.getByText("Preparing")).toBeVisible();
  await expect(fixtureCard.getByRole("button", { name: "Done" })).toBeVisible();

  await fixtureCard.getByRole("button", { name: "Done" }).click();
  await expect(fixtureCard).toBeHidden();

  await page.evaluate(() => {
    window.__kitchenInjectEvent?.({
      type: "order.paid",
      order: {
        id: "order-sse-202",
        orderNumber: "A-202",
        status: "paid",
        subtotalCents: 650,
        totalAmountCents: 650,
        createdAt: "2026-08-08T12:02:00.000Z",
        paidAt: "2026-08-08T12:02:01.000Z",
        items: [
          {
            id: "item-sse-202",
            productId: "product-classic-cheese-toastie",
            productName: "Classic cheese toastie",
            quantity: 1,
            unitPriceCents: 650,
            variants: [],
            addons: [],
          },
        ],
      },
    });
  });

  const liveCard = page.getByTestId("kitchen-order-A-202");
  await expect(liveCard).toBeVisible();
  await expect(liveCard.getByText("Classic cheese toastie")).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
});
```

Create `e2e/browser/kitchen-queue-helpers.ts` with the shared password entry helper used by the test:
```ts
import type { Page } from "@playwright/test";

export const enterStaffPassword = async (page: Page) => {
  await page.getByLabel("Shared staff password").fill("warm-melted");
  await page.getByRole("button", { name: "Continue" }).click();
};
```

If the generated route tree has not yet picked up `/kitchen`, the first failure should be a missing route or heading, not a weakened assertion.

- [ ] **Step 2: Run only the new browser test to prove it is red**

Run:

```bash
bun run build && bunx playwright test e2e/browser/kitchen-queue.spec.ts
```

Expected: FAIL because `/kitchen` and its screen/test hook do not exist. Do not add implementation or change assertions to make the test pass.

- [ ] **Step 3: Commit the red browser contract**

```bash
git add e2e/browser/kitchen-queue.spec.ts e2e/browser/kitchen-queue-helpers.ts
git commit -m "test(kitchen): cover staff queue flow"
```

### Task 2: Implement the local kitchen server-function seam

**Files:**
- Create: `src/lib/kitchen.ts`
- Create: `src/lib/kitchen.test.ts`

**Interfaces:**
- Consumes: `createServerFn`, `getRequestHeader`, and `setResponseHeader`, following `src/lib/kiosk-session.ts`.
- Produces: `KitchenOrder`, `KitchenOrderItem`, `KitchenOrderStatus`, `OrderStatusEvent`, `KitchenEvent`, `KitchenError`, `claimStaffSession`, `listActiveOrders`, and `advanceOrder`.

- [ ] **Step 1: Define the exact backend-shaped types and error**

Put these types and error codes at the top of `src/lib/kitchen.ts`:

```ts
export type KitchenOrderStatus = "paid" | "preparing";
export type KitchenOrderItem = {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  variants: Array<{ id: string; optionId: string; optionName: string; priceDeltaCents: number }>;
  addons: Array<{ id: string; addonId: string; addonName: string; priceDeltaCents: number }>;
};
export type KitchenOrder = {
  id: string;
  orderNumber: string;
  status: KitchenOrderStatus;
  subtotalCents: number;
  totalAmountCents: number;
  createdAt: string;
  paidAt: string;
  items: KitchenOrderItem[];
};
export type OrderStatusEvent = {
  type: "order.preparing" | "order.done";
  orderId: string;
  orderNumber: string;
  status: "preparing" | "done";
};
export type KitchenOrderPaidEvent = { type: "order.paid"; order: KitchenOrder };
export type KitchenEvent = KitchenOrderPaidEvent | OrderStatusEvent;
export type KitchenErrorCode =
  | "configuration"
  | "invalid_password"
  | "invalid_input"
  | "staff_identity"
  | "order_not_found"
  | "invalid_transition";

export class KitchenError extends Error {
  readonly code: KitchenErrorCode;

  constructor(code: KitchenErrorCode) {
    super(code);
    this.name = "KitchenError";
    this.code = code;
  }
}
```

- [ ] **Step 2: Add independent local staff authority and fixtures**

Use `STAFF_COOKIE = "staff_session"`, a module-local `staffSessions` set/map, and the fixture password `warm-melted`; never import or call the kiosk-session functions. Seed at least one order `order-paid-101` / `A-101` in `paid` with the melted mushroom toastie, Sourdough variant, and Extra cheese addon, plus any second preparing fixture needed to prove both card actions. Keep order arrays oldest-first by `createdAt` and return copies so a caller cannot mutate the fixture directly.

`claimStaffSession` must be declared as:

```ts
export const claimStaffSession = createServerFn({ method: "POST" })
  .validator((input: { password: string }) => input)
  .handler(({ data }): { issuedAt: number } => {
    if (!data.password.trim()) throw new KitchenError("invalid_input");
    if (data.password !== STAFF_PASSWORD) throw new KitchenError("invalid_password");
    const token = crypto.randomUUID();
    staffSessions.set(token, true);
    setResponseHeader("Set-Cookie", `${STAFF_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`);
    return { issuedAt: Date.now() };
  });
```

Implement `listActiveOrders` as a GET server function that checks the staff cookie and returns only `paid`/`preparing` orders. Implement `advanceOrder` as a POST server function with validator `{ orderId: string; toStatus: "preparing" | "done" }`, checks staff identity, enforces exactly `paid → preparing` and `preparing → done`, mutates the local fixture, and returns the exact `OrderStatusEvent` envelope. `order_not_found` and `invalid_transition` must be thrown instead of silently succeeding.

- [ ] **Step 3: Add focused seam tests before UI implementation**

In `src/lib/kitchen.test.ts`, test the observable domain contract using direct server-function calls:

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import {
  advanceOrder,
  claimStaffSession,
  KitchenError,
  listActiveOrders,
  resetKitchenFixture,
} from "#/lib/kitchen";

describe("kitchen seam", () => {
  beforeEach(() => {
    // Use the module's exported test reset hook; this keeps tests isolated without touching production route code.
    resetKitchenFixture();
  });

  test("rejects an incorrect staff password", async () => {
    await expect(claimStaffSession({ data: { password: "wrong" } })).rejects.toMatchObject({
      code: "invalid_password",
    });
  });

  test("requires staff identity and advances only legal states", async () => {
    await expect(listActiveOrders()).rejects.toBeInstanceOf(KitchenError);
    await claimStaffSession({ data: { password: "warm-melted" } });
    await expect(advanceOrder({ data: { orderId: "order-paid-101", toStatus: "done" } })).rejects.toMatchObject({
      code: "invalid_transition",
    });
    await expect(
      advanceOrder({ data: { orderId: "order-paid-101", toStatus: "preparing" } }),
    ).resolves.toMatchObject({ status: "preparing", orderNumber: "A-101" });
  });
});
```

Export `resetKitchenFixture` only for colocated tests; it resets the fixture map and staff-session map. Test setup must provide the request cookie context used by the existing server-function tests, or use the same direct-call convention already present in `src/lib/kiosk-session.test.ts`.

- [ ] **Step 4: Run focused seam tests and commit the seam**

Run:

```bash
bun test src/lib/kitchen.test.ts
```

Expected: PASS with invalid password, identity, and transition behavior covered. Commit:

```bash
git add src/lib/kitchen.ts src/lib/kitchen.test.ts
git commit -m "feat(kitchen): add staff queue seam"
```

### Task 3: Implement the kitchen route and cache event reducer

**Files:**
- Create: `src/components/kitchen-screen.tsx`
- Create: `src/components/kitchen-screen.test.ts`
- Create: `src/routes/kitchen.tsx`
- Modify: `src/routeTree.gen.ts` (generated by `bun run generate-routes`)

**Interfaces:**
- Consumes: `KitchenOrder`, `KitchenEvent`, `KitchenError`, `claimStaffSession`, `listActiveOrders`, and `advanceOrder` from Task 2.
- Produces: accessible `/kitchen` staff gate, queue cards, action mutations, Refresh invalidation, EventSource lifecycle, and `window.__kitchenInjectEvent` for the browser test.

- [ ] **Step 1: Add pure cache event application**

In `src/components/kitchen-screen.tsx`, define and export:

```ts
export const applyKitchenEvent = (
  orders: KitchenOrder[] | undefined,
  event: KitchenEvent,
): KitchenOrder[] => {
  const current = orders ?? [];
  if (event.type === "order.paid") {
    const next = current.filter((order) => order.id !== event.order.id);
    return [...next, event.order].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  if (event.status === "done") {
    return current.filter((order) => order.id !== event.orderId);
  }
  return current.map((order) =>
    order.id === event.orderId ? { ...order, status: "preparing" } : order,
  );
};
```

The function must never mutate the previous array or an order object. Add unit cases for paid upsert/order sorting, preparing status patch, done removal, and unknown order status events leaving the list stable if the implementation uses guards.

- [ ] **Step 2: Implement the gate and queue query**

`KitchenScreen` starts with `staffReady = false`, `password = ""`, and an inline error. `useQuery` uses:

```ts
const ordersQuery = useQuery({
  queryKey: ["kitchen", "orders"],
  queryFn: () => listActiveOrders(),
  enabled: staffReady,
});
```

The Continue form rejects an empty trimmed password locally, calls `claimStaffSession({ data: { password } })`, and sets `staffReady` only after success. Map `KitchenError.code` to the approved copy from the design spec. If a query or mutation error has `staff_identity`, clear `staffReady` and keep the error visible on the gate.

Render the gate with heading `Kitchen queue`, label `Shared staff password`, a password input, Continue, and `aria-live` error output. Render the authenticated header with `Kitchen queue`, Refresh, and a compact `Live updates on`/`Live updates off` text status. Refresh invokes `queryClient.invalidateQueries({ queryKey: ["kitchen", "orders"] })`.

- [ ] **Step 3: Implement dense order cards and transition mutations**

Render loading, error, and empty states, then cards with `data-testid={\`kitchen-order-${order.orderNumber}\`}`. Each card must contain the order number, `Paid` or `Preparing`, created time, total/subtotal, each item quantity/name/unit price, variant names, addon names, and only one action: paid → `Start preparing`, preparing → `Done`. Use `useMutation` with `advanceOrder({ data: { orderId, toStatus } })`; on success patch the cache with the returned status event, and on error render a retryable inline message without removing the card. Keep button disabled while its own mutation is pending.

Use the existing tokens and Lucide icons with a simple header and responsive `grid-cols-1`/`lg:grid-cols-2` layout; do not reuse the full `KioskShell` footer.

- [ ] **Step 4: Wire EventSource and test injection to the same reducer**

When `staffReady` becomes true, run an effect:

```ts
useEffect(() => {
  if (!staffReady) return;
  const source = new EventSource("/api/kitchen/events");
  const apply = (event: KitchenEvent) => {
    queryClient.setQueryData<KitchenOrder[]>(["kitchen", "orders"], (orders) =>
      applyKitchenEvent(orders, event),
    );
  };
  const onOpen = () => setLive(true);
  const onError = () => setLive(false);
  const eventTypes: KitchenEvent["type"][] = ["order.paid", "order.preparing", "order.done"];
  const handlers = eventTypes.map((eventType) => {
    const handler = (message: MessageEvent<string>) => {
      apply(JSON.parse(message.data) as KitchenEvent);
    };
    source.addEventListener(eventType, handler);
    return { eventType, handler };
  });
  source.onopen = onOpen;
  source.onerror = onError;
  window.__kitchenInjectEvent = apply;
  return () => {
    source.onopen = null;
    source.onerror = null;
    for (const { eventType, handler } of handlers) {
      source.removeEventListener(eventType, handler);
    }
    source.close();
    delete window.__kitchenInjectEvent;
  };
}, [queryClient, staffReady]);
```

Add a global TypeScript declaration for `__kitchenInjectEvent` accepting `KitchenEvent`. Do not make the production stream depend on the test hook; both paths call `applyKitchenEvent` through the same callback.

- [ ] **Step 5: Add the route and regenerate the route tree**

Create `src/routes/kitchen.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { KitchenScreen } from "#/components/kitchen-screen";

const Kitchen = () => <KitchenScreen />;

export const Route = createFileRoute("/kitchen")({ component: Kitchen });
```

Run `bun run generate-routes` so `src/routeTree.gen.ts` includes `/kitchen`; do not hand-edit generated route metadata.

- [ ] **Step 6: Run focused unit and type checks, then commit UI**

Run:

```bash
bun test src/lib/kitchen.test.ts src/components/kitchen-screen.test.ts
bun run generate-routes
bun run typecheck
```

Expected: PASS with cache reducer and seam tests green and route types generated. Commit:

```bash
git add src/components/kitchen-screen.tsx src/components/kitchen-screen.test.ts src/routes/kitchen.tsx src/routeTree.gen.ts
git commit -m "feat(kitchen): add staff queue screen"
```

### Task 4: Run the green browser flow and inspect the full interaction

**Files:**
- Modify only implementation/test files if a verified browser failure requires a fix.

**Interfaces:**
- Consumes: the route, seam, reducer, and browser contract from Tasks 1–3.
- Produces: passing staff gate, queue display, legal transitions, removal, and SSE cache-patching browser evidence.

- [ ] **Step 1: Build and run the focused browser test**

Run:

```bash
bun run build && bunx playwright test e2e/browser/kitchen-queue.spec.ts
```

Expected: PASS. The test must observe `A-101`, its customization snapshots, Paid → Preparing → Done, hidden removal, then `A-202` rendered after `window.__kitchenInjectEvent` without clicking Refresh.

- [ ] **Step 2: Exercise the password validation path in the browser**

Open a fresh `/kitchen` page, submit the empty password, and assert the inline `Enter the shared staff password to continue.` message. Reload the page, submit `wrong`, and assert `That staff password is not correct.`. These assertions cover the gate's local and typed server errors without changing production data or adding another fixture.

- [ ] **Step 3: Commit verified browser fixes**

```bash
git add src/components/kitchen-screen.tsx src/components/kitchen-screen.test.ts src/routes/kitchen.tsx src/routeTree.gen.ts e2e/browser/kitchen-queue.spec.ts e2e/browser/kitchen-queue-helpers.ts

git commit -m "test(kitchen): verify live queue behavior"
```

### Task 5: Run final repository checks and report the backend swap boundary

**Files:**
- No source files; this task records verification only.

**Interfaces:**
- Consumes: all committed kitchen design, plan, seam, route, component, unit, and browser artifacts.
- Produces: verified full checks and a concise handoff to Main naming commits and the one-line backend seam swap.

- [ ] **Step 1: Run all required checks in order**

Run:

```bash
bun run lint && bun run format && bun run typecheck && bun run test && bun run test:e2e
```

Expected: every command exits 0; `test:e2e` includes the kitchen browser flow and all previously shipped flows.

- [ ] **Step 2: Confirm the final diff is scoped**

Run:

```bash
git status --short
git diff --stat HEAD~5..HEAD
```

Confirm no customer menu/checkout/idle files were changed and the only raw URL transport is `new EventSource("/api/kitchen/events")`.

- [ ] **Step 3: Report completion to Main**

Send Main the design commit `81dbd3d`, plan commit, red-test commit, implementation commit(s), exact passing command list, and the adapter note: replace `src/lib/kitchen.ts`'s local handler bodies with backend-platform's `claimStaffSession`, `listActiveOrders`, and `advanceOrder` exports; keep `KitchenScreen`'s Query keys, cache reducer, and EventSource contract unchanged.
