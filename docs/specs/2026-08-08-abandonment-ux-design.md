# Abandonment UX Design

## Contents

- [Contents](#contents)
- [Problem and decisions](#problem-and-decisions)
- [User-visible behavior](#user-visible-behavior)
- [Architecture](#architecture)
- [Analytics contract](#analytics-contract)
- [Payment-expiry seam](#payment-expiry-seam)
- [Testing strategy](#testing-strategy)
- [Acceptance criteria](#acceptance-criteria)

## Problem and decisions

A kiosk cart must not remain occupied when a customer walks away. After a
configurable period with no interaction, the UI warns that the cart will be
cleared and gives the customer a short opportunity to continue. If the
warning expires, the client records the abandonment event, clears local cart
state, and returns to the normal empty-cart menu resting state. No order is
created by cart abandonment.

Spec 6 uses the approved production defaults of 45 seconds of inactivity and a
15-second warning countdown. Both values are configurable through
`VITE_CART_IDLE_TIMEOUT_MS` and `VITE_CART_IDLE_COUNTDOWN_SECONDS`; browser
e2e tests set short values through the same Vite environment mechanism used by
`VITE_TERMINAL_DELAY_MS`.

The same idle lifecycle remains active while the order is
`payment_pending`, including order creation, payment-attempt startup, fake
terminal processing, reconciliation, and the retry state after a failed
attempt. It stops once payment is confirmed. On expiry during payment, the UI
calls `expirePaymentAttempt()` before clearing the cart and leaving checkout;
the server-owned payment/order state is therefore authoritative.

## User-visible behavior

The menu remains the resting state. When the cart has at least one line, every
screen-level interaction resets the idle lifecycle and dismisses an open
warning. The warning is an accessible, focus-trapped dialog with the title
“Are you still ordering?”, a live countdown, and a large “Keep ordering”
action. Tapping that action resets the full idle threshold. A tap anywhere on
the kiosk screen has the same reset behavior, including taps on cart details,
customization controls, and checkout controls.

When the countdown reaches zero before checkout, the client captures the cart
snapshot and then dispatches the cart reset. The warning closes and the menu
shows its ordinary empty-cart state. If a customer interacts while the modal is
open, the countdown is cancelled and no abandonment event is emitted.

When the countdown reaches zero in payment, the warning closes only after the
expiry request settles. The checkout flow is cancelled and the cart is reset;
there is no later reconciliation path in the client. A confirmed payment
screen is excluded because the order is paid rather than pending.

## Architecture

The idle logic is split into two small layers:

1. `src/lib/idle-timer.ts` contains a pure state machine and transition
   helpers for `idle`, `warning`, and `expired`, including countdown and reset
   behavior. It accepts injected timing values so colocated Bun tests can use
   deterministic short intervals without React or browser timers.
2. `src/lib/use-abandonment.ts` owns browser timers and the React lifecycle.
   It starts/stops the state machine based on cart presence and checkout phase,
   exposes warning state and reset handling, and invokes injected callbacks for
   cart abandonment analytics or payment expiry. The hook captures immutable
   cart data at the start of a warning so the event cannot accidentally report
   post-warning edits.

`MenuScreen` supplies kiosk identity and cart operations to the hook. The hook
is mounted around both the menu and `CheckoutScreen`, so the timer is not
recreated when transitioning into checkout. `CheckoutScreen` supplies the
current payment phase, order ID, and payment-attempt ID. A shared warning modal
is rendered by the screen owning the hook, using existing Base UI dialog
patterns and project tokens; no second timer is introduced inside checkout.

The payment-expiry adapter in `src/lib/payment.ts` is a named
`createServerFn({ method: "POST" })` with the documented backend signature.
Until backend spec 6 lands, its handler is a local deterministic stub. No raw
API fetch is added. Replacing this adapter with the backend implementation is a
one-line seam swap, matching specs 2–4.

## Analytics contract

At cart timeout, the client calls the existing PostHog client from
`usePostHog()` with event name `cart_abandoned` and these properties:

```ts
{
  kiosk_id: string,
  cart_lines: Array<{
    id: string,
    product_id: string,
    category_id: string,
    product_name: string,
    unit_price_cents: number,
    variants: CartVariantSelection[],
    addons: CartAddonSelection[],
  }>,
  item_count: number,
  subtotal_cents: number,
  currency: "USD",
  idle_duration_ms: number,
  abandoned_at: string,
}
```

`kiosk_id` comes from the server-derived kiosk session, not customer input.
`cart_lines` is a JSON-safe snapshot. The event excludes customer identity,
card data, terminal commands, and terminal receipts. Analytics capture happens
before the local reset; capture failures do not strand the cart, so the reset
still occurs.

## Payment-expiry seam

The local adapter exposes:

```ts
export type ExpirePaymentAttemptInput = {
  attemptId: string;
  orderId: string;
};

export type ExpirePaymentAttemptResult = {
  attemptId: string;
  orderId: string;
  attemptStatus: "expired";
  orderStatus: "expired";
};

export const expirePaymentAttempt: ServerFn<
  ExpirePaymentAttemptInput,
  ExpirePaymentAttemptResult
>;
```

The browser sends the active attempt and order IDs only. The local stub records
an expired result and rejects malformed or unknown IDs in the same typed error
style as the existing payment functions. The hook awaits this call before
resetting the cart and cancelling checkout. A rejected request is surfaced to
an error boundary/logging path while the customer is still released from the
stale payment screen; the backend implementation remains responsible for
ensuring no pending order can reach kitchen.

## Testing strategy

The first test is a real Playwright browser spec using a built app and short
Vite idle values. It covers the warning countdown, a keep-ordering tap that
resets the warning, cart timeout clearing and `cart_abandoned` capture, and
payment-pending timeout calling `expirePaymentAttempt` through the local seam.
The analytics assertion observes the browser's PostHog capture call without
sending data to an external service.

After the browser test is red, implementation is added. A colocated Bun test
then exercises the pure idle-timer state machine: cart-empty inactivity,
idle-to-warning transition, reset during warning, countdown expiry, and
payment-phase eligibility. The final checks run lint, format, typecheck, all
unit tests, and all browser tests.

## Acceptance criteria

- Design and implementation-plan documents are committed under the flat
  `docs/specs` and `docs/plans` paths.
- Production defaults are 45 seconds idle and 15 seconds warning, with Vite
  overrides for tests.
- The warning is accessible, resettable by interaction, and returns the menu
  to empty-cart state after timeout.
- `cart_abandoned` contains the approved kiosk, line snapshot, subtotal,
  count, currency, idle duration, and timestamp properties.
- Payment-pending timeout calls `expirePaymentAttempt` before clearing local
  state and excludes confirmed payment.
- Browser and colocated unit tests pass, followed by the repository's full
  lint, format, typecheck, unit, and e2e checks.
