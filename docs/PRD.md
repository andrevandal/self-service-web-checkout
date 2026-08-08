# Product requirements & decisions — Self-service web checkout (kiosk)

## Contents

- [Vision & essential user case](#vision--essential-user-case)
- [Product requirements](#product-requirements)
- [User flows](#user-flows)
- [Decisions & trade-offs](#decisions--trade-offs)

## Vision & essential user case

A frictionless, no-label self-service checkout web app for a snack bar
("Warm & Melted"). A customer walks up to a tablet mounted at the counter,
browses the menu, builds an order, pays, and walks away — no cashier, just
them and the screen. See `README.md` for the current onboarding-level
summary.

This document is the living, manually-updated record of *what* the product
does and *why*. Per-feature design detail lives in `docs/specs/*`; this
file holds the requirements, the flows, and the current state of every
non-obvious decision — it always reflects where the product stands today,
not a history of how it got there.

## Product requirements

### Catalog & menu*

- Menu is organized into categories, each holding products with a base
  price, description, and image.
- Products may offer variant groups (e.g. milk choice — exactly one
  selection) and addon groups (e.g. extra shot — zero or more selections),
  each with their own price deltas.

### Kiosk identity

- Every tablet must be claimed as a named kiosk with a unique order-prefix
  before it can take orders.
- Claiming requires a shared setup password; the claim screen lists every
  existing kiosk (claim or reclaim any of them) or lets staff create a new
  one.
- A claimed tablet stays claimed across reloads without re-entering the
  password.

### Cart & checkout

- A customer builds a cart from the menu (base product + variant + addon
  selections), sees a running subtotal, and can remove items before
  paying.
- When customer taps Pay, checkout persists an immutable order snapshot in
  `payment_pending`, then starts simulated payment. Only server-validated
  simulated approval allocates its kiosk-prefixed order number (e.g.
  "A-13") and marks it paid.
- A paid order's line items keep an immutable record of what was actually
  bought (name and price at time of purchase), independent of later menu
  edits.

### Payment & device simulation

- This POC does not integrate TEF, pinpads, printers, or other hardware.
  Client-side terminal and printer adapters simulate their commands,
  results, and configurable test-overridable delay.
- The server creates one immutable `payment_attempt` per simulated terminal
  attempt. It synchronously validates attempt ownership, state, expiry,
  one-time command correlation, and expected amount before marking an
  order paid. This is POC correlation validation, not evidence of a real
  card charge.
- The fake terminal defaults to approval; tests can force
  decline/unavailable. The fake printer records a successful print command.

### Kitchen queue

- `/kitchen` is a staff-only active-order queue, protected by the same
  shared password used for kiosk claiming.
- It lists only `paid` and `preparing` orders. Staff moves an order from
  `paid` to `preparing`, then to `done`; `done` orders leave the queue.
- `/kitchen` holds its active queue in TanStack Query under
  `['kitchen', 'orders']`. Its SSE handler applies new paid orders and
  status transitions directly to that cached query; a visible Refresh
  action invalidates and refetches it on demand.

### Cart abandonment & analytics

- An idle cart on screen (no interaction for a configurable period) warns
  the customer it's about to clear, then captures `cart.abandoned` in
  PostHog with kiosk identity, cart-line snapshot, subtotal, and timestamp
  before clearing itself and returning the menu to its default empty-cart
  state. No order is created.
- The same idle timeout remains active during `payment_pending`. On expiry,
  it expires the current payment attempt, marks the order `expired`, and
  captures `order_expired`; no pending order can later reach kitchen.
- Client-side PostHog captures interaction usage; server-side PostHog
  captures domain outcomes. Both use the server-derived kiosk ID and never
  capture card data, terminal receipts, or customer identity.

### Event catalog

- **Client**: `cart_item_added`, `cart_item_removed`, `checkout_started`,
  and `cart_abandoned`; include kiosk ID, product/category IDs, quantity,
  item count, cart value, and idle duration where applicable.
- **Server**: `payment_attempt_started`, `payment_attempt_result`,
  `order_paid`, `order_expired`, `kitchen_order_started`, and
  `kitchen_order_done`; include kiosk ID, order/attempt ID, amount, outcome,
  failure reason, attempt count, and elapsed duration where applicable.
- Product views and search keystrokes are deliberately not tracked: high
  volume with no useful operational decision behind them.

### Look, feel & content

- Touch-first: large tap targets, high contrast, minimal steps.
- Calm, efficient tone — no upsell, no corporate filler, no emoji; real
  currency values; sentence-case copy throughout.
- Visual language: warm paper background, single forest-green accent
  reserved for the primary action/selected state, Inter for UI text,
  monospace for glanceable numbers (prices, order numbers).

## User flows

### 1. Kiosk setup (staff, one-time per tablet)

1. Tablet opens the app with no valid kiosk session → shows the setup
   screen.
2. Staff enters the shared claim password.
3. Screen lists every existing kiosk plus "create new."
4. Staff picks or creates a kiosk (name + prefix).
5. Tablet stores a signed kiosk session; it now boots straight into kiosk
   mode on every future load.

### 2. Browse & build an order (customer)

1. Menu is shown by default with an empty cart — there is no separate
   idle/attract screen; the menu itself is the resting state.
2. Customer browses categories or searches, taps a product.
3. If the product has variants/addons, a customization drawer collects
   selections before adding to cart; otherwise one tap adds it directly.
4. Cart footer/bar shows item count and running subtotal at all times.
5. Customer can remove items or keep adding until ready to pay.

### 3. Checkout & payment (customer)

1. Customer taps "Pay."
2. `POST /api/orders` validates the cart and creates its immutable
   `payment_pending` order plus first pending payment attempt.
3. Server creates one-time simulated terminal command; client receives
   that command with the attempt ID.
4. Client terminal adapter executes the command and returns an opaque
   simulated receipt/reference.
5. Client sends receipt to `POST /api/payment-attempts/:id/reconcile`.
6. Server verifies kiosk ownership, attempt state/expiry, expected amount,
   and command correlation. Only simulated approval marks attempt approved,
   assigns server-timezone order number, marks order paid, and emits
   `order.paid`.
7. Full-screen confirmation shows pickup number; receipt prints; screen
   returns to empty-cart menu after a short delay.
8. Declined, unavailable, invalid, or expired attempts are recorded; order
   remains `payment_pending` and customer can begin a new attempt. The
   same idle timeout expires an abandoned pending order as `expired`.

### 4. Cart abandonment (customer, background)

1. Cart has items; customer stops interacting with the screen.
2. After the idle threshold, a "still there?" countdown appears.
3. Any tap resets the idle timer and dismisses the countdown.
4. If the countdown reaches zero before Pay, client captures the cart
   snapshot in PostHog as `cart.abandoned`, clears the cart, and returns the
   menu to its empty-cart state — ready for the next customer.

### 5. Payment abandonment (customer, background)

1. Order is `payment_pending`; customer stops interacting during terminal
   simulation or after a failed attempt.
2. The same idle threshold/countdown runs.
3. On timeout, server expires current payment attempt, marks order
   `expired`, captures `order_expired`, and prevents later reconciliation.

### 6. Kitchen queue (staff)

1. Staff opens `/kitchen`, enters the shared staff password once, and
   receives a separate signed staff session.
2. The active queue loads orders in `paid` and `preparing` states.
3. A newly paid order appears through SSE, or after staff selects Refresh.
4. Staff selects `Start preparing` to move an order from `paid` to
   `preparing`.
5. Staff selects `Done` to move it to `done`; it leaves the active queue.

## Decisions & trade-offs

Current state of every non-obvious call. This section is overwritten in
place as decisions change — it is not a change history.

- **Scope**: first delivery is a connected checkout core with a simple
  kitchen queue. Inventory tracking, out-of-stock UI, and cross-kiosk
  stock synchronization are deliberately excluded; each needs its own
  future design. Full offline-first order queuing (conflict resolution,
  deferred sync) is also out of scope.
- **Deployment topology**: one shared, single-process TanStack Start app
  and one shared database serve every kiosk; kiosks are distinguished by
  claimed identity, not by separate deployments per tablet. For this POC,
  only single-app deployment topologies are supported
  (`docker-compose.yml` or `docker-compose.sqld.yml` once implemented).
  Existing scalable compose scaffolding is platform capability, not a
  supported product deployment: kitchen SSE/in-process events require
  shared pub/sub before `app=N` is safe.
- **Kiosk claim**: gated by a `KIOSK_CLAIM_PASSWORD` env var; claiming
  issues a signed, HttpOnly, stateless `{ kioskId, issuedAt }` cookie — no
  server-side session table, no heartbeat, no inactivity gating, no
  reclaim revocation. Two tablets can end up claiming the same kiosk
  prefix; accepted as an operator-trust limitation for a small,
  manually-managed POC fleet.
- **Payment/device simulation**: command-based, not event-driven. This POC
  does not integrate real TEF, pinpads, printers, or provider APIs.
  `POST /api/orders` creates a `payment_pending` order and immutable
  `payment_attempt`; server supplies a one-time simulated terminal command,
  and client terminal adapter returns an opaque simulated receipt/reference.
  `POST /api/payment-attempts/:id/reconcile` synchronously validates
  ownership, state/expiry, command correlation, and expected amount before
  marking attempt/order approved/paid. This models flow control, not card
  payment security. Failed attempts are immutable; retry creates another
  attempt for the same order. The fake printer records a successful command
  from the paid response.
- **Events & scaling**: a lightweight in-process, no-persistence event
  dispatcher (`order.paid`, `order.preparing`, `order.done`) decouples
  checkout and kitchen delivery mechanisms. Kitchen SSE subscribes to all
  three and updates the TanStack Query `['kitchen', 'orders']` cache
  directly; Refresh invalidates/refetches it. Horizontal app scaling is
  deferred: it requires shared pub/sub, which is out of scope for this
  single-process POC.
- **Inventory & availability**: removed from this POC. Products have no
  stock quantity or availability state; checkout never decrements stock,
  produces `stock_failed`, or publishes catalog-availability events.
  This keeps the demo focused on checkout, device commands, receipt
  printing, and kitchen workflow. Product/recipe inventory and
  cross-kiosk stock synchronization require a future dedicated spec.
- **Order data integrity**: order line items snapshot both display name
  and price (not price alone) so a later menu edit or rename can never
  change how a past receipt reads.
- **Order numbering**: allocated from a `kiosk_order_counters(kiosk_id,
  service_date)` counter at checkout confirmation. `service_date` is
  calculated in the Docker/server `TZ` environment timezone — never from
  tablet/browser time — so every kiosk shares one explicit daily boundary.
- **Order status & kitchen workflow**: `payment_pending | paid | preparing
  | done | expired` are live. `/kitchen` is an active queue only: staff
  advances `paid → preparing → done`, and `done` orders leave its view.
  Idle payment abandonment marks the order `expired`, which never reaches
  kitchen. The staff UI uses the same `KIOSK_CLAIM_PASSWORD` but receives a
  separate signed, HttpOnly staff cookie — it never reuses customer kiosk
  authority.
- **Cart abandonment**: idle timeout dispatch the event
  `cart.abandoned` with kiosk identity, cart snapshot, subtotal,
  and timestamp, then clears local cart state. During `payment_pending`,
  that same timeout expires the attempt/order and captures `order_expired`.
- **Analytics**:
  Client-side PostHog tracks interaction usage; server-side PostHog tracks
  domain outcomes; both derive kiosk ID from server-trusted session state
  and exclude card data, terminal receipts, and customer identity.
