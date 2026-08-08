# Checkout and payment UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the claimed kiosk's end-to-end Pay flow: one validated pending order, simulated terminal attempt and receipt reconciliation, pickup confirmation with fake printing, retryable failures, and automatic return to an empty-cart menu.

**Architecture:** `MenuScreen` keeps menu/cart state and hands a cart snapshot to a focused `CheckoutScreen` overlay/state. `checkout.ts` maps cart selections to the exact `createOrder` input; `payment.ts` exposes named TanStack Start server-function-shaped order/attempt seams; `terminal.ts` and `printer.ts` are injectable/configurable client fakes. Backend spec 3's real `createOrder` can replace the local implementation without changing UI state transitions, and backend spec 4 can replace the attempt seams once its signature is fixed.

**Tech Stack:** React 19, TanStack Start `createServerFn`, TanStack Query mutations, TypeScript, Lucide React, Bun test, Playwright.

## Global Constraints

- Every order/payment read or write uses a named `createServerFn` invoked through TanStack Query; no raw `fetch` is added.
- `createOrder` receives only `{ lines: [{ productId, quantity, variantOptionIds, addonIds }] }`; quantity is `1` for each cart line and client money is never trusted.
- A pending order is created once per checkout; Retry starts a new payment attempt for the same order and never calls `createOrder` again.
- Terminal simulation defaults to approval and accepts a configurable non-negative delay; browser e2e sets `VITE_TERMINAL_DELAY_MS=0` at build time.
- Approved confirmation shows `Payment complete`, the kiosk-prefixed pickup number (for example `A-13`), and `Your receipt is printing`, then returns after exactly 2 seconds.
- Declined, unavailable, invalid, expired, create-order, and adapter errors keep the cart and show Retry/Cancel; only approved completion clears the cart.
- Touch controls are at least 48px, copy is sentence case with no emoji, Inter remains the only typeface, and receipt/card/customer data never appears in UI or logs.
- Do not run formatters, linters, or repository-wide checks until the final verification task.

---

### Task 1: Add the failing checkout browser flow

**Files:**
- Create: `e2e/browser/checkout-payment.spec.ts`
- Modify: `package.json:21` (make the built browser test use zero terminal delay)

**Interfaces:**
- Consumes: existing `claimFixtureKiosk` helper, fixture menu product named `Classic cheese toastie` at `$6.50`.
- Produces: a red Playwright contract for Pay, terminal simulation, confirmation, pickup number, auto-reset, and disabled empty-cart Pay.

- [ ] **Step 1: Write the failing test before checkout implementation**

Create the test with accessible assertions and no implementation selectors:

```ts
import { expect, test } from "@playwright/test";
import { claimFixtureKiosk } from "./kiosk-claim-helpers";

test("pays for an order, confirms pickup, and resets the menu", async ({ page }) => {
  await claimFixtureKiosk(page);

  await page.getByRole("button", { name: /Classic cheese toastie.*\$6\.50/ }).click();
  await expect(page.getByRole("contentinfo").getByText("$6.50")).toBeVisible();

  await page.getByRole("button", { name: "Pay" }).click();
  await expect(page.getByRole("heading", { name: "Taking payment" })).toBeVisible();
  await expect(page.getByText("Follow the instructions on the terminal")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Payment complete" })).toBeVisible();
  await expect(page.getByText(/^[A-Z]-\d+$/)).toBeVisible();
  await expect(page.getByText("Your receipt is printing")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Menu" })).toBeVisible({ timeout: 4_000 });
  await expect(page.getByRole("contentinfo").getByText("0 items · $0.00")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay" })).toBeDisabled();
});
```

`package.json` must make the browser build deterministic without slowing the real default adapter: update `test:e2e` to run `VITE_TERMINAL_DELAY_MS=0 bun run build` between migration and `playwright test`.

- [ ] **Step 2: Run only the new browser test to prove it is red**

Run:

```bash
bun run build && bunx playwright test e2e/browser/checkout-payment.spec.ts
```

Expected: the test reaches the existing menu but fails because Pay remains disabled/non-navigating and the `Taking payment` heading is never rendered. Do not change the test to accommodate this failure.

- [ ] **Step 3: Commit the red test**

```bash
git add e2e/browser/checkout-payment.spec.ts package.json
git commit -m "test(checkout): cover payment confirmation flow"
```

### Task 2: Define payment and checkout seams

**Files:**
- Create: `src/lib/payment.ts`
- Create: `src/lib/checkout.ts`

**Interfaces:**
- Consumes: the landed backend `createOrder` input/result contract and existing `CartState` selection IDs.
- Produces: `createOrder`, `startPaymentAttempt`, `reconcilePaymentAttempt`, `cartToCreateOrderInput`, and typed local errors for `CheckoutScreen`.

- [ ] **Step 1: Define exact shared types and pure cart mapping**

In `src/lib/checkout.ts`, define:

```ts
import type { CartState } from "#/lib/cart";

export type CreateOrderInput = {
  lines: Array<{
    productId: string;
    quantity: number;
    variantOptionIds: string[];
    addonIds: string[];
  }>;
};

export type CreateOrderResult = {
  id: string;
  kioskId: string;
  status: "payment_pending";
  orderNumber: null;
  subtotalCents: number;
  totalAmountCents: number;
  items: Array<{
    id: string;
    productId: string;
    productName: string;
    quantity: number;
    unitPriceCents: number;
    variants: Array<{ id: string; optionId: string; optionName: string; priceDeltaCents: number }>;
    addons: Array<{ id: string; addonId: string; addonName: string; priceDeltaCents: number }>;
  }>;
};

export const cartToCreateOrderInput = (cart: CartState): CreateOrderInput => ({
  lines: cart.map((line) => ({
    productId: line.productId,
    quantity: 1,
    variantOptionIds: line.variants.map((variant) => variant.optionId),
    addonIds: line.addons.map((addon) => addon.addonId),
  })),
});
```

Keep the mapper deterministic and free of prices, IDs generated by the client, or UI concerns.

- [ ] **Step 2: Define server-function-shaped payment seams**

In `src/lib/payment.ts`, use `createServerFn` and export these exact types/functions:

```ts
export type StartPaymentAttemptInput = { orderId: string };
export type StartPaymentAttemptResult = {
  attemptId: string;
  terminalCommand: string;
  expectedAmountCents: number;
};
export type PaymentFailureCode = "declined" | "unavailable" | "invalid" | "expired";
export type ReconcilePaymentAttemptResult =
  | { status: "approved"; orderId: string; orderNumber: string; receipt: string }
  | { status: PaymentFailureCode; orderId: string; message: string };

export const createOrder = createServerFn({ method: "POST" })
  .validator((input: CreateOrderInput) => input)
  .handler(({ data }) => localCreateOrder(data));
export const startPaymentAttempt = createServerFn({ method: "POST" })
  .validator((input: StartPaymentAttemptInput) => input)
  .handler(({ data }) => localStartPaymentAttempt(data));
export const reconcilePaymentAttempt = createServerFn({ method: "POST" })
  .validator((input: { attemptId: string; receipt: string }) => input)
  .handler(({ data }) => localReconcilePaymentAttempt(data));
```

The local order handler returns `payment_pending`, calculates its integer total from a server-side fixture map, and stores the pending order/attempt in module-local state. The local attempt handler generates a one-time command and records its order ID/expected total. Reconciliation accepts only the recorded command's opaque receipt, returns approval with a kiosk-prefixed order number (for example `A-13`) by default, and returns typed failure data for configured test outcomes. Keep these handlers behind the exported `createServerFn` declarations so swapping in the backend implementation is a boundary-only change.

- [ ] **Step 3: Run the focused type check for the new modules**

Run:

```bash
bunx tsc --noEmit
```

Expected: no TypeScript errors from `checkout.ts` or `payment.ts`. Do not run the full repository suite yet.

### Task 3: Implement and test the terminal/printer adapters

**Files:**
- Create: `src/lib/terminal.ts`
- Create: `src/lib/terminal.test.ts`
- Create: `src/lib/printer.ts`

**Interfaces:**
- Consumes: `StartPaymentAttemptResult.terminalCommand` and explicit test configuration.
- Produces: `executeTerminalCommand(command, options)` and `printReceipt(receipt)` used by `CheckoutScreen`.

- [ ] **Step 1: Write terminal tests before implementation**

Create tests that defend timing and outcome behavior:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { executeTerminalCommand } from "#/lib/terminal";

afterEach(() => {
  delete process.env.VITE_TERMINAL_DELAY_MS;
});

describe("executeTerminalCommand", () => {
  test("returns an opaque receipt for approval with zero delay", async () => {
    const result = await executeTerminalCommand("cmd-1", { delayMs: 0, outcome: "approved" });
    expect(result.status).toBe("approved");
    expect(result.receipt).toMatch(/^sim-receipt-/);
    expect(result.receipt).not.toContain("cmd-1");
  });

  test("returns typed decline without a receipt", async () => {
    await expect(
      executeTerminalCommand("cmd-2", { delayMs: 0, outcome: "declined" }),
    ).resolves.toEqual({ status: "declined" });
  });

  test("honors a positive configured delay", async () => {
    const started = performance.now();
    await executeTerminalCommand("cmd-3", { delayMs: 20, outcome: "approved" });
    expect(performance.now() - started).toBeGreaterThanOrEqual(15);
  });
});
```

- [ ] **Step 2: Run terminal tests to prove they are red**

Run:

```bash
bun test src/lib/terminal.test.ts
```

Expected: FAIL because `src/lib/terminal.ts` does not exist yet.

- [ ] **Step 3: Implement the minimal adapter and printer seam**

Implement `src/lib/terminal.ts` with:

```ts
export type TerminalOutcome = "approved" | "declined" | "unavailable" | "invalid";
export type TerminalResult =
  | { status: "approved"; receipt: string }
  | { status: Exclude<TerminalOutcome, "approved"> };
export type TerminalOptions = { delayMs?: number; outcome?: TerminalOutcome };

export const executeTerminalCommand = async (
  _command: string,
  options: TerminalOptions = {},
): Promise<TerminalResult> => {
  const configuredDelay = Number(import.meta.env.VITE_TERMINAL_DELAY_MS ?? 350);
  const delayMs = Math.max(0, Number.isFinite(options.delayMs ?? configuredDelay) ? options.delayMs ?? configuredDelay : 0);
  const outcome = options.outcome ?? "approved";
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  return outcome === "approved"
    ? { status: "approved", receipt: `sim-receipt-${crypto.randomUUID()}` }
    : { status: outcome };
};
```

`src/lib/printer.ts` exports an in-memory `printedReceipts` list plus `printReceipt(receipt): Promise<void>` that appends the opaque receipt exactly once per invocation and resolves without an artificial delay. The screen calls this only after approved reconciliation.

- [ ] **Step 4: Run terminal tests to prove they are green**

Run:

```bash
bun test src/lib/terminal.test.ts
```

Expected: 3 passing tests.

### Task 4: Build the checkout screen state machine

**Files:**
- Create: `src/components/checkout-screen.tsx`

**Interfaces:**
- Consumes: `CartState`, `cartToCreateOrderInput`, `createOrder`, `startPaymentAttempt`, `reconcilePaymentAttempt`, `executeTerminalCommand`, and `printReceipt`.
- Produces: `CheckoutScreen({ cart, onCancel, onComplete })`, with full-screen states for creation, terminal execution, failure/retry, and confirmation.

- [ ] **Step 1: Add the phase-driven component**

Implement a component with this transition sequence:

```ts
type CheckoutPhase =
  | "creating_order"
  | "starting_attempt"
  | "taking_payment"
  | "reconciling"
  | "failed"
  | "confirmed";

// Pay entry: createOrder({ data: cartToCreateOrderInput(cart) }) once.
// Success: set pending order, then startPaymentAttempt({ data: { orderId } }).
// Attempt success: executeTerminalCommand(command, { delayMs: terminalDelayMs }).
// Receipt: reconcilePaymentAttempt({ data: { attemptId, receipt } }).
// Approved: await printReceipt(receipt), set confirmed, schedule onComplete after 2_000ms.
// Failure: set failed with “Payment didn’t go through. Try again.”; retain cart/order.
// Retry: startPaymentAttempt({ data: { orderId } }) only.
// Cancel: call onCancel without clearing cart.
```

Use TanStack Query `useMutation` for each server-function call. Disable all action controls during `creating_order`, `starting_attempt`, `taking_payment`, and `reconciling`. Render plain full-screen opaque surfaces with headings `Taking payment` and `Payment complete`; render a spinner with an accessible status; expose pickup number as a heading; provide Retry and Cancel buttons in `failed`. Error details stay out of customer copy and receipts stay out of the DOM. Clear the completion timer on unmount.

- [ ] **Step 2: Run a focused component type check**

Run:

```bash
bunx tsc --noEmit
```

Expected: no errors in `checkout-screen.tsx` or its imported seams.

### Task 5: Wire Pay, reset, and the approved browser flow

**Files:**
- Modify: `src/components/menu-screen.tsx:30-124`
- Modify: `src/lib/cart.ts:33-59` (add the reset action without changing add/remove semantics)

**Interfaces:**
- Consumes: `CheckoutScreen` and existing cart reducer/subtotal state.
- Produces: enabled Pay action for non-empty carts, cart snapshot handoff, and one reset point that returns to empty menu.

- [ ] **Step 1: Add checkout ownership to MenuScreen**

Add `checkoutCart` state initialized to `null`. The footer Pay button uses `disabled={cart.length === 0}` and `onClick={() => setCheckoutCart(cart)}`. Before returning the `KioskShell`, branch on `checkoutCart`:

```tsx
if (checkoutCart) {
  return (
    <CheckoutScreen
      cart={checkoutCart}
      onCancel={() => setCheckoutCart(null)}
      onComplete={() => {
        dispatchCart({ type: "reset" });
        setCartOpen(false);
    />
  );
}
```

Extend the cart reducer with a `reset` action that returns `[]`; do not recreate the reducer or change existing add/remove behavior. The checkout snapshot ensures menu edits cannot change an in-flight order.

- [ ] **Step 2: Run the new browser test against the built app**

Run:

```bash
bun run test:e2e -- e2e/browser/checkout-payment.spec.ts
```

Expected: the checkout test passes, showing terminal copy, an `A-<number>` pickup number, receipt-printing copy, and an empty `$0.00` menu after the two-second confirmation. Existing browser tests must continue to pass in this command's project run.

- [ ] **Step 3: Commit the implementation**

```bash
git add src/lib/checkout.ts src/lib/payment.ts src/lib/terminal.ts src/lib/terminal.test.ts src/lib/printer.ts src/components/checkout-screen.tsx src/components/menu-screen.tsx e2e/browser/checkout-payment.spec.ts package.json
git commit -m "feat(checkout): add simulated payment flow"
```

### Task 6: Final verification and plan/spec consistency

**Files:**
- Modify: `docs/specs/2026-08-08-checkout-payment-design.md` only if the implementation intentionally changes an approved observable behavior.
- Modify: `docs/plans/2026-08-08-checkout-payment-plan.md` only to mark completed checkboxes and record observed command results.

**Interfaces:**
- Consumes: all committed checkout implementation and tests.
- Produces: verified full repository checks and a clean handoff to Main.

- [ ] **Step 1: Run the complete required checks**

Run in order:

```bash
bun run lint
bun run format
bun run typecheck
bun run test
bun run test:e2e
```

Expected: each command exits zero; unit tests include terminal coverage; `test:e2e` builds with `VITE_TERMINAL_DELAY_MS=0` and all browser specs pass.

- [ ] **Step 2: Confirm the final diff is scoped**

Run:

```bash
git status --short
git diff --stat HEAD~1..HEAD
```

Expected: only the checkout design/plan docs, checkout UI/adapters, cart reset wiring, package e2e delay setting, and checkout browser/unit tests are present; no raw API route or unrelated feature is added.

- [ ] **Step 3: Commit any final docs update and report**

If Task 6 changes only checkbox/doc evidence, commit it with:

```bash
git add docs/specs/2026-08-08-checkout-payment-design.md docs/plans/2026-08-08-checkout-payment-plan.md
git commit -m "docs(checkout): record verification results"
```

Send Main the design commit, plan commit, implementation commit, passing command list, and any backend adapter swap note.
