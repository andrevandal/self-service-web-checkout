# Checkout and payment UI

## Contents

- [Goal](#goal)
- [Customer flow](#customer-flow)
- [Architecture and boundaries](#architecture-and-boundaries)
- [Payment state machine](#payment-state-machine)
- [Terminal and printer adapters](#terminal-and-printer-adapters)
- [Failure handling and accessibility](#failure-handling-and-accessibility)
- [Verification](#verification)

## Goal

Complete the customer checkout path after the menu and cart workflow. A claimed kiosk customer can tap Pay, create one server-validated `payment_pending` order, complete a simulated terminal attempt, see a pickup-number confirmation when payment is approved, and return to the menu ready for the next customer. The cart remains available for retries after any declined, unavailable, invalid, or expired attempt.

The design keeps the existing menu as the kiosk's resting route. It does not add a route or raw REST call: order creation, payment-attempt start, and reconciliation remain named TanStack Start server-function boundaries consumed through TanStack Query. The terminal and printer are client-side fakes because this POC has no hardware integration.

## Customer flow

The claimed home route renders the existing menu and pinned footer. The Pay action is disabled with an empty cart and enabled as soon as one line exists. When Pay is tapped:

1. `CheckoutScreen` receives the current cart snapshot and calls `createOrder({ data: { lines } })` once. Every cart line maps to one backend line with `quantity: 1`, its product ID, selected variant option IDs, and selected addon IDs. Client prices and subtotals are never submitted as trusted values.
2. After the order is created, the screen starts a payment attempt. Each attempt receives a one-time simulated terminal command and attempt ID from the payment adapter boundary.
3. The terminal state is full-screen and deliberately customer-facing: heading `Taking payment`, a spinner, and `Follow the instructions on the terminal`. The implementation uses a fake asynchronous terminal adapter with configurable delay; test configuration can set the delay to zero or near-zero without changing the screen flow.
4. The terminal returns an opaque simulated receipt. The screen sends that receipt and attempt ID to reconciliation. It does not display or log the receipt.
5. An approved reconciliation renders a full-screen confirmation with `Payment complete`, the kiosk-prefixed pickup number such as `A-13`, and `Your receipt is printing`. A fake printer records a successful print command. After 2 seconds, the screen clears the cart and returns to the menu state.
6. A declined, unavailable, invalid, or expired outcome leaves the order pending and the cart intact. The screen explains that payment did not go through and offers Retry, which starts a new payment attempt for the existing order, and Cancel, which returns to the cart/menu without discarding the cart.

The order is created before the terminal attempt and is not recreated for retries. A failed create-order call does not start terminal work and remains retryable from the cart.

## Architecture and boundaries

`MenuScreen` remains responsible for menu query state, cart reducer state, cart details, and the pinned footer. It adds only checkout ownership: a Pay action stores a cart snapshot and renders `CheckoutScreen`; the completion callback clears the reducer and returns to the normal menu view. Menu search, customization, and removal behavior are unchanged.

`CheckoutScreen` owns checkout phase, pending order identity, terminal attempt state, failure copy, and confirmation timing. Its public contract is a cart snapshot plus `onCancel` and `onComplete` callbacks, so it can be tested without knowing how the menu renders. It does not compute trusted money or construct server persistence records beyond mapping cart selections to IDs.

`src/lib/checkout.ts` contains pure mapping and state helpers. It converts a `CartState` into the exact `CreateOrderInput` shape and exposes stable local types for an order and retryable payment result. `src/lib/payment.ts` is the client-facing server-function seam:

- `createOrder` has the landed backend signature and returns `{ id, kioskId, status: "payment_pending", orderNumber: null, subtotalCents, totalAmountCents, items }`.
- `startPaymentAttempt` returns an attempt ID, one-time terminal command, and expected amount. Until backend spec 4 exposes the finalized named function, the local adapter keeps this same input/output shape and is replaced at the boundary when the backend module lands.
- `reconcilePaymentAttempt` accepts an attempt ID and opaque receipt and returns either an approved order number/print result or a typed failure (`declined`, `unavailable`, `invalid`, or `expired`). Its local adapter follows the same server-function-shaped seam.

All server calls are invoked from TanStack Query mutations. No component uses `fetch` for orders or payment. The one allowed kitchen SSE exception is unrelated and remains untouched.

## Payment state machine

The checkout state has these observable phases:

- `creating_order`: Pay has been tapped and the immutable pending order is being created.
- `starting_attempt`: a new attempt is being requested for the pending order.
- `taking_payment`: the terminal adapter is executing the one-time command.
- `reconciling`: the receipt has returned and is being checked by the server boundary.
- `failed`: the attempt ended in a retryable failure; order and cart remain intact.
- `confirmed`: reconciliation approved the payment; print is issued once and the pickup number is visible.

Pay is ignored while a phase is in progress, so duplicate taps cannot create multiple orders. Retry is available only in `failed` and starts `starting_attempt` without calling `createOrder` again. Cancel is available before confirmation and never clears the cart. On `confirmed`, the component schedules exactly one 2-second completion timer; unmount cleanup cancels it.

A create-order error is shown as a retryable checkout error while retaining the cart. The known `CreateOrderError` codes are not exposed as implementation details to the customer; configuration, identity, catalog, and selection failures use direct next-step copy such as `We couldn't start payment. Check your order and try again.`

## Terminal and printer adapters

`src/lib/terminal.ts` defines a small async adapter rather than simulating hardware inside the component. `executeTerminalCommand(command, options)` accepts a one-time command and optional `delayMs` and `outcome`. It waits the configured delay, then returns an opaque receipt for approval or a typed terminal failure for decline/unavailable/invalid. The default outcome is approval, matching the PRD. The delay is clamped to a non-negative finite value; tests pass `0` (or a test environment default) and use fake timers where they exercise delay behavior. The adapter never returns card data and the UI never renders the receipt.

`src/lib/printer.ts` defines `printReceipt(receipt)` as a client-side fake. It records only that the approved receipt was printed and resolves asynchronously without introducing visible delay. The confirmation screen is entered only after reconciliation approval, and print is invoked once per approved response. The adapter seam allows a real device integration later without changing checkout state transitions.

## Failure handling and accessibility

Loading phases replace the menu with opaque full-screen surfaces so a customer cannot edit the cart while an order or attempt is in flight. The terminal surface uses a visible heading, spinner with a text alternative, and polite status text. Buttons remain at least 48px tall and have visible focus rings. Retry and Cancel are explicit buttons on the failure surface; Retry has the primary forest-green treatment, while Cancel is secondary.

The confirmation pickup number is the most prominent text and is exposed in the page heading/accessible name. `Payment complete` and printing copy are announced through the full-screen content. Error messages use `aria-live="assertive"` only for the newly reported failure, with no receipt, card, or customer data. Existing Inter typography, paper background, opaque white surfaces, forest-green primary action, sentence-case copy, and Lucide 2px icons remain in use.

The screen never clears a cart on failure, cancellation, or a transient adapter error. Only the approved confirmation timer calls `onComplete`; this is the single reset point for returning to an empty-cart menu.

## Verification

The first implementation test is a failing Playwright test in `e2e/browser/checkout-payment.spec.ts`. It claims the fixture kiosk, adds the direct-add cheese toastie, taps Pay, observes the full-screen terminal copy, waits for the approved confirmation and kiosk-prefixed pickup number, then waits for the short auto-return and verifies the menu is visible with `0 items`, `$0.00`, and a disabled Pay button. The test configures a zero/near-zero fake delay so it is deterministic and fast while still driving the real built screen.

A colocated `src/lib/terminal.test.ts` covers the non-trivial terminal adapter contract: configurable delay is honored, zero delay resolves without waiting, approval yields an opaque receipt, and decline/unavailable outcomes are typed. Pure checkout mapping is covered alongside it if the mapping introduces additional branching. After the red browser test, implementation proceeds to green, then the repository lint, format, typecheck, unit, build, and full browser-e2e checks.
