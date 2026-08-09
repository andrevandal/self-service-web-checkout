# Abandonment UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared idle-warning lifecycle that abandons idle carts with a `cart_abandoned` PostHog event, and expires pending payment attempts through the backend-shaped seam before resetting the kiosk.

**Architecture:** `MenuScreen` owns one `useAbandonment` lifecycle around both the menu and `CheckoutScreen`; a pure `idle-timer.ts` state machine keeps timing transitions independently testable. The hook renders a hand-rolled accessible warning dialog, snapshots cart data at warning start, and invokes either cart analytics/reset or `expirePaymentAttempt`/checkout cancellation depending on whether checkout is active. The payment expiry adapter is local until backend spec 6 replaces its `createServerFn` handler.

**Tech Stack:** React 19, TanStack Start `createServerFn`, TanStack Query mutations, `@posthog/react`, TypeScript, Lucide React, Bun test, Playwright.

## Global Constraints

- Production idle defaults are 45 seconds and a 15-second warning countdown.
- `VITE_CART_IDLE_TIMEOUT_MS` and `VITE_CART_IDLE_COUNTDOWN_SECONDS` override those values at Vite build time; browser tests use short values.
- Cart abandonment emits client PostHog event `cart_abandoned` only before checkout; payment-pending expiry relies on server-side `order_expired` and emits no duplicate client cart event.
- `cart_abandoned` properties are `kiosk_id`, `cart_lines`, `item_count`, `subtotal_cents`, `currency: "USD"`, `idle_duration_ms`, and ISO `abandoned_at`.
- `kiosk_id` comes from the server-derived `KioskSession.id`; do not use customer input or a hard-coded identity.
- `cart_lines` is an immutable JSON-safe snapshot containing line id, product id, category id, product name, unit price cents, variants, and addons; never include customer/card/terminal receipt data.
- The same timer is active in checkout phases `creating_order`, `starting_attempt`, `taking_payment`, `reconciling`, and `failed`; it is inactive for `confirmed`.
- When payment expires and an attempt ID exists, await `expirePaymentAttempt({ data: { attemptId } })` before clearing local cart and cancelling checkout. The backend result includes `orderId`, `attemptStatus: "expired"`, `orderStatus: "expired"`, and `amountCents`; if no attempt exists yet, skip the server call and still release the stale UI.
- Every server interaction uses a named `createServerFn` invoked through TanStack Query; no raw API fetch is added.
- Reuse the spec 3 hand-rolled dialog approach (`role="dialog"`, `aria-modal`, focus trap/restoration, Escape handling); do not add a Base UI dependency.
- Touch controls are at least 48px, copy is sentence case with no emoji, and the Inter-only token system remains unchanged.
- Do not run formatters, linters, or repository-wide checks until the final verification task.

---

### Task 1: Add the failing abandonment browser contract

**Files:**
- Create: `e2e/browser/abandonment-ux.spec.ts`
- Modify: `package.json:21` (`test:e2e` build environment)
- Modify: `src/env.ts:24-28` (client env fields)

**Interfaces:**
- Consumes: `claimFixtureKiosk`, the existing fixture product `Classic cheese toastie` at `$6.50`, the menu/cart accessible labels, and the local payment flow.
- Produces: a red real-browser contract for warning, reset, client analytics, empty-cart return, and payment expiry.

- [ ] **Step 1: Add short test-only Vite values before implementation**

Extend the `test:e2e` script so the built browser app receives short idle values and an enabled local PostHog client:

```json
"test:e2e": "bun run db:migrate && VITE_TERMINAL_DELAY_MS=50 VITE_CART_IDLE_TIMEOUT_MS=15000 VITE_CART_IDLE_COUNTDOWN_SECONDS=3 VITE_POSTHOG_KEY=phc_test VITE_POSTHOG_HOST=http://posthog.test bun run build && playwright test"
```

Add the two idle fields to `clientEnvFields` as optional strings alongside `VITE_TERMINAL_DELAY_MS`. The existing `defineStandardEnv` schema remains the validation boundary; runtime parsing belongs in the idle module so malformed values fall back safely.

- [ ] **Step 2: Write the failing browser test**

Create `e2e/browser/abandonment-ux.spec.ts` with independent tests. Intercept `http://posthog.test/**` and retain request bodies so the event assertion never reaches an external service. Use `page.goto("/")` through `claimFixtureKiosk` and accessible UI behavior only:

```ts
import { expect, test } from "@playwright/test";
import { claimFixtureKiosk } from "./kiosk-claim-helpers";

const addClassicToastie = async (page: Parameters<typeof claimFixtureKiosk>[0]) => {
  await page.getByRole("button", { name: /Classic cheese toastie.*\$6\.50/ }).click();
  await expect(page.getByRole("contentinfo").getByText("$6.50")).toBeVisible();
};

test("warns about an idle cart and keeps it after interaction", async ({ page }) => {
  await claimFixtureKiosk(page);
  await addClassicToastie(page);

  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 2_000 });
  await expect(page.getByRole("heading", { name: "Are you still ordering?" })).toBeVisible();
  await expect(page.getByText(/Cart clears in \d+s/)).toBeVisible();
  await page.getByRole("button", { name: "Keep ordering" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("contentinfo").getByText("$6.50")).toBeVisible();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 2_000 });
});

test("captures cart abandonment and returns to an empty menu", async ({ page }) => {
  const captured: string[] = [];
  await page.route("http://posthog.test/**", async (route) => {
    captured.push(route.request().postData() ?? "");
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await claimFixtureKiosk(page);
  await addClassicToastie(page);

  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 2_000 });
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 4_000 });
  await expect(page.getByRole("contentinfo").getByText("0 items · $0.00")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay" })).toBeDisabled();
  await expect.poll(() => captured.some((body) => body.includes("cart_abandoned"))).toBe(true);
  const eventBody = captured.find((body) => body.includes("cart_abandoned")) ?? "";
  expect(eventBody).toContain("front-counter");
  expect(eventBody).toContain("product-classic-cheese-toastie");
  expect(eventBody).toContain("subtotal_cents");
});

test("expires a payment-pending attempt before returning to the menu", async ({ page }) => {
  await claimFixtureKiosk(page);
  await addClassicToastie(page);
  await page.getByRole("button", { name: "Pay" }).click();
  await expect(page.getByRole("heading", { name: /Preparing payment|Taking payment/ })).toBeVisible();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 2_000 });
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 4_000 });
  await expect(page.getByRole("heading", { name: "Menu" })).toBeVisible();
  await expect(page.getByRole("contentinfo").getByText("0 items · $0.00")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay" })).toBeDisabled();
  await expect(page.getByText(/Payment session expired|Menu/)).toBeVisible();
});
```

The first two tests prove the warning and reset/abandon paths; the third proves the payment-pending timeout reaches the expiry seam through its observable expired/cancelled UI result. If the PostHog transport uses a batch endpoint, parse the captured request JSON and assert the same event/property values from its `batch` entries.

- [ ] **Step 3: Run only the new browser spec to prove it is red**

Run:

```bash
bun run build && bunx playwright test e2e/browser/abandonment-ux.spec.ts
```

Expected: the test reaches the existing menu but fails because no idle warning or empty-cart timeout behavior exists; the payment path also has no `expirePaymentAttempt` seam. Fix test setup errors until the failure is specifically missing behavior, then leave production code unchanged.

- [ ] **Step 4: Commit the red browser contract**

```bash
git add e2e/browser/abandonment-ux.spec.ts package.json src/env.ts
git commit -m "test(abandonment): cover idle cart and payment expiry"
```

### Task 2: Add and unit-test the pure idle state machine

**Files:**
- Create: `src/lib/idle-timer.ts`
- Create: `src/lib/idle-timer.test.ts`

**Interfaces:**
- Consumes: injected `now` timestamps and configured idle/countdown values.
- Produces: deterministic `IdleTimerState`, `IdleTimerEvent`, and `transitionIdleTimer` used by the React hook.

- [ ] **Step 1: Write the failing Bun tests**

Create focused tests before the implementation:

```ts
import { describe, expect, test } from "bun:test";
import {
  initialIdleTimerState,
  transitionIdleTimer,
  type IdleTimerConfig,
} from "#/lib/idle-timer";

const config: IdleTimerConfig = { idleTimeoutMs: 100, countdownSeconds: 3 };

describe("idle timer state machine", () => {
  test("does not start when cart is inactive", () => {
    expect(initialIdleTimerState(false, 0, config)).toEqual({ phase: "inactive" });
  });

  test("moves active cart from idle to warning after threshold", () => {
    const idle = initialIdleTimerState(true, 0, config);
    expect(transitionIdleTimer(idle, { type: "idle_timeout", now: 100 }, config)).toEqual({
      phase: "warning",
      startedAt: 100,
      secondsRemaining: 3,
    });
  });

  test("interaction resets warning to a fresh idle period", () => {
    const warning = { phase: "warning" as const, startedAt: 100, secondsRemaining: 2 };
    expect(transitionIdleTimer(warning, { type: "interaction", now: 150 }, config)).toEqual({
      phase: "idle",
      startedAt: 150,
    });
  });

  test("countdown expires exactly at zero", () => {
    const warning = { phase: "warning" as const, startedAt: 100, secondsRemaining: 1 };
    expect(transitionIdleTimer(warning, { type: "countdown_tick", now: 1_100 }, config)).toEqual({
      phase: "expired",
      startedAt: 100,
      expiredAt: 1_100,
    });
  });

  test("deactivation always returns to inactive", () => {
    const warning = { phase: "warning" as const, startedAt: 100, secondsRemaining: 2 };
    expect(transitionIdleTimer(warning, { type: "deactivate", now: 150 }, config)).toEqual({
      phase: "inactive",
    });
  });
});
```

- [ ] **Step 2: Run the focused test to verify the correct red failure**

Run `bun test src/lib/idle-timer.test.ts`. It must fail because the state-machine module and exports do not exist yet.

- [ ] **Step 3: Implement the minimal pure transitions**

Implement these exact public types and transitions:

```ts
export type IdleTimerConfig = { idleTimeoutMs: number; countdownSeconds: number };
export type IdleTimerState =
  | { phase: "inactive" }
  | { phase: "idle"; startedAt: number }
  | { phase: "warning"; startedAt: number; secondsRemaining: number }
  | { phase: "expired"; startedAt: number; expiredAt: number };
export type IdleTimerEvent =
  | { type: "idle_timeout"; now: number }
  | { type: "countdown_tick"; now: number }
  | { type: "interaction"; now: number }
  | { type: "deactivate"; now: number };

export const initialIdleTimerState = (
  active: boolean,
  now: number,
  config: IdleTimerConfig,
): IdleTimerState =>
  active && config.idleTimeoutMs >= 0 && config.countdownSeconds > 0
    ? { phase: "idle", startedAt: now }
    : { phase: "inactive" };
```

`transitionIdleTimer` must return a new state for each event without timers, mutate no input, preserve the warning's original `startedAt`, and transition a warning with one remaining second to `expired` on its next tick. `interaction` starts a fresh idle period for active states; `deactivate` always returns `inactive`.

- [ ] **Step 4: Run the focused test to verify green**

Run `bun test src/lib/idle-timer.test.ts`; all five state-machine behaviors must pass before moving to the React integration.

- [ ] **Step 5: Commit the state machine**

```bash
git add src/lib/idle-timer.ts src/lib/idle-timer.test.ts
git commit -m "feat(abandonment): add idle timer state machine"
```

### Task 3: Add the payment expiry server-function seam

**Files:**
- Modify: `src/lib/payment.ts` after `reconcilePaymentAttempt`

**Interfaces:**
- Consumes: active `attemptId` (the order ID remains local checkout state and is not sent).
- Produces: `expirePaymentAttempt` named `createServerFn`, `ExpirePaymentAttemptInput`, `ExpirePaymentAttemptResult`, and `PaymentAttemptError` behavior for malformed/unknown/resolved IDs.

- [ ] **Step 1: Add a focused failing unit assertion**

Extend `src/lib/payment.test.ts` with a direct handler test that calls the local handler with an unknown attempt ID and expects `PaymentAttemptError`, and a valid attempt created by `startPaymentAttemptHandler` that returns `{ attemptStatus: "expired", orderStatus: "expired", amountCents }`. The test must fail before the handler exists.

- [ ] **Step 2: Implement the documented local stub**

Add:

```ts
export type ExpirePaymentAttemptInput = { attemptId: string };
export type ExpirePaymentAttemptResult = {
  attemptId: string;
  orderId: string;
  attemptStatus: "expired";
  orderStatus: "expired";
  amountCents: number;
};

export const expirePaymentAttemptHandler = ({
  attemptId,
}: ExpirePaymentAttemptInput): ExpirePaymentAttemptResult => {
  if (!attemptId) {
    throw new PaymentAttemptError("invalid_input", "Payment attempt identity is required");
  }
  const attempt = paymentAttempts.get(attemptId);
  if (!attempt) {
    throw new PaymentAttemptError("attempt_not_found", "Payment attempt was not found");
  }
  if (attempt.status !== "pending") {
    throw new PaymentAttemptError("attempt_resolved", "Payment attempt is already resolved");
  }
  attempt.status = "expired";
  return {
    attemptId,
    orderId: attempt.orderId,
    attemptStatus: "expired",
    orderStatus: "expired",
    amountCents: attempt.expectedAmountCents,
  };
};

export const expirePaymentAttempt = createServerFn({ method: "POST" })
  .validator((input: ExpirePaymentAttemptInput) => input)
  .handler(({ data }) => expirePaymentAttemptHandler(data));
```

Keep the existing `PaymentAttemptErrorCode` union and local attempt map. The future backend implementation replaces only this server-function handler; UI call sites keep the same input/result contract.

- [ ] **Step 3: Run focused payment tests and commit**

Run `bun test src/lib/payment.test.ts` (or the updated focused test file). Expected: the unknown/mismatch/valid expiry assertions pass. Commit with:

```bash
git add src/lib/payment.ts src/lib/payment.test.ts src/lib/checkout.test.ts
git commit -m "feat(abandonment): add payment expiry seam"
```

### Task 4: Implement the hook, warning dialog, and menu/checkout integration

**Files:**
- Create: `src/lib/use-abandonment.ts`
- Create: `src/components/abandonment-dialog.tsx`
- Modify: `src/components/menu-screen.tsx`
- Modify: `src/components/checkout-screen.tsx`

**Interfaces:**
- Consumes: `CartState`, `KioskSession.id`, `subtotalCents`, `expirePaymentAttempt`, pure idle transitions, and checkout phase/order/attempt callbacks.
- Produces: `useAbandonment` return `{ warningOpen, secondsRemaining, reset }`, `AbandonmentDialog`, and an integrated menu/payment lifecycle.

- [ ] **Step 1: Implement configuration parsing and the hook around injected callbacks**

In `use-abandonment.ts`, define:

```ts
export type PaymentPendingContext = {
  phase:
    | "creating_order"
    | "starting_attempt"
    | "taking_payment"
    | "reconciling"
    | "failed"
    | "confirmed";
  orderId: string | null;
  attemptId: string | null;
};
export type UseAbandonmentInput = {
  cart: CartState;
  kioskId: string;
  payment: PaymentPendingContext | null;
  onClearCart: () => void;
  onCancelPayment: () => void;
};
```

Read `import.meta.env.VITE_CART_IDLE_TIMEOUT_MS` with fallback `45_000`, and `VITE_CART_IDLE_COUNTDOWN_SECONDS` with fallback `15`; accept only finite non-negative integers (countdown must be at least 1). The hook owns one idle timeout and one one-second countdown interval, clears both on every reset/deactivation/unmount, and uses the pure transition helper with `Date.now()`.

When cart is empty or payment is confirmed, transition to `inactive`. When a warning starts, snapshot `cart.map` into a new JSON-safe array and store its warning start timestamp. On normal cart expiry, call `usePostHog().capture("cart_abandoned", properties)` in a try/finally-safe callback, then call `onClearCart`; do not emit this event when `payment` is non-null. For payment expiry, await `expirePaymentAttempt({ data: { attemptId } })` when an attempt ID exists, then call `onCancelPayment` and `onClearCart` even when the adapter rejects, so a stale UI cannot trap the kiosk. Keep order ID in local checkout context for UI bookkeeping but never send it to the expiry server function. Guard async completion with a mounted ref.

Expose `reset` for root interaction and the current warning phase/count. Depend on stable callbacks or refs so each cart/phase update does not create duplicate timers.

- [ ] **Step 2: Build the warning dialog from the existing drawer pattern**

Create `AbandonmentDialog` with props `{ open, secondsRemaining, onKeepOrdering }`. Match the customization drawer's `closeRef`, focus restoration, `role="dialog"`, `aria-modal="true"`, heading ID, and `onKeyDown` Tab loop/Escape behavior. Use a fixed backdrop and centered card with project tokens. Render:

```tsx
<h2 id="abandonment-title">Are you still ordering?</h2>
<p aria-live="polite">Cart clears in {secondsRemaining}s.</p>
<button type="button" onClick={onKeepOrdering}>Keep ordering</button>
```

The countdown text is live, the keep button is at least 48px high, and closing via Escape/backdrop invokes `onKeepOrdering` rather than abandoning. Return `null` when closed.

- [ ] **Step 3: Mount one lifecycle in `MenuScreen`**

Extend `MenuScreenProps` to receive the full server-derived kiosk session (or at minimum its `id` and existing display name), preserving the existing claimed-session gate. Keep the existing cart reducer in the parent. Track `paymentContext` in parent state and derive the timer's active snapshot as `checkoutCart ?? cart`.

Call `useAbandonment` before the `if (checkoutCart)` return. Wrap the returned menu content in a root `onPointerDown`/`onTouchStart` handler that calls `abandonment.reset` for any interaction outside the dialog; pass `abandonment.warningOpen` state to `AbandonmentDialog`. Pass `onPaymentStateChange` and `onAbandon` callbacks into `CheckoutScreen`. On normal expiry dispatch `{ type: "reset" }`, close cart details, clear checkout, and retain the existing menu query/category state so the normal menu resting state appears.

When checkout is active, render `CheckoutScreen` plus the same `AbandonmentDialog`; do not mount a second hook. Ensure clicking `Keep ordering` calls `reset` and does not dispatch a cart reset.

- [ ] **Step 4: Report checkout phase/order/attempt identity upward**

Extend `CheckoutScreenProps` with:

```ts
onPaymentStateChange: (state: {
  phase: CheckoutPhase;
  orderId: string | null;
  attemptId: string | null;
}) => void;
```

Track `attemptId` when `startPaymentAttempt` resolves and clear it after confirmed/cancelled. Add an effect keyed by `phase`, `order?.id`, and `attemptId` that calls `onPaymentStateChange` with the current pending phase and IDs. The effect must not alter payment behavior. On parent expiry, `onCancelPayment` unmounts checkout; the mounted ref prevents late terminal/reconcile completions from changing parent state.

- [ ] **Step 5: Run focused browser and unit checks, then commit implementation**

Run:

```bash
bun test src/lib/idle-timer.test.ts src/lib/payment.test.ts
VITE_CART_IDLE_TIMEOUT_MS=15000 VITE_CART_IDLE_COUNTDOWN_SECONDS=3 VITE_POSTHOG_KEY=phc_test VITE_POSTHOG_HOST=http://posthog.test bun run build
bunx playwright test e2e/browser/abandonment-ux.spec.ts
```

Expected: all pure tests pass, the new browser spec passes through cart warning/reset, `cart_abandoned`, empty-menu return, and payment expiry. Commit:

```bash
git add src/lib/use-abandonment.ts src/components/abandonment-dialog.tsx src/components/menu-screen.tsx src/components/checkout-screen.tsx
git commit -m "feat(abandonment): add idle warning and expiry UX"
```

### Task 5: Final project checks and documentation consistency

**Files:**
- Modify: `GOAL.md` (log spec 6 commits and checks)
- Modify: `docs/specs/2026-08-08-abandonment-ux-design.md` only if implementation details changed the approved contract
- Modify: `docs/plans/2026-08-08-abandonment-ux-plan.md` only if an exact command/path changed during implementation

**Interfaces:**
- Consumes: all implementation commits and the approved design/plan.
- Produces: verified branch with no stale spec claims and complete checks.

- [ ] **Step 1: Run the required full checks**

Run in order:

```bash
bun run lint
bun run format
bun run typecheck
bun run test
bun run test:e2e
```

`bun run test:e2e` performs the database migration, builds with the short test idle/terminal values, and runs all browser specs. Expected output is success for every command with no lint, format, type, unit, or browser failures.

- [ ] **Step 2: Update the GOAL log and self-review docs**

Add a dated log entry to `GOAL.md` naming the design/plan, red browser test, implementation, idle timer unit test, `expirePaymentAttempt` local seam, and full-check result. Confirm the design's Contents list still links every `##` heading and scan both docs for `TBD`, `TODO`, stale Base UI references, and contradictory event names.

- [ ] **Step 3: Commit the final documentation/check record**

```bash
git add GOAL.md docs/specs/2026-08-08-abandonment-ux-design.md docs/plans/2026-08-08-abandonment-ux-plan.md
git commit -m "docs(abandonment): record shipped UX" 
```
