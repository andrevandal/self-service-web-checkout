# Cart and checkout core design

## Contents

- [Goal and scope](#goal-and-scope)
- [Design decisions](#design-decisions)
- [Order persistence](#order-persistence)
- [Server-function contract](#server-function-contract)
- [Validation and immutable snapshots](#validation-and-immutable-snapshots)
- [Errors and transaction behavior](#errors-and-transaction-behavior)
- [Testing and verification](#testing-and-verification)
- [Non-goals](#non-goals)

## Goal and scope

Implement the checkout boundary reached when a customer taps Pay. The server
accepts the kiosk cart, authenticates kiosk identity from the signed
`kiosk_session` cookie, validates every line against the live catalog, computes
the authoritative amount in integer cents, and persists an immutable
`payment_pending` order with product and modifier snapshots.

The PRD's first two checkout steps are in scope: order creation and its
payment-pending state. This vertical does not simulate a terminal, reconcile a
payment, assign a pickup number, or emit kitchen events. A named TanStack Start
server function is the only application boundary; no ad-hoc HTTP order route is
added.

## Design decisions

### Validate relationally inside one transaction

The handler uses dedicated relational queries against product, variant-group,
variant-option, addon-group, and addon rows rather than trusting client totals
or reusing the presentation-shaped `loadMenu()` result. Catalog rows are
selected and validated within the same transaction that inserts the order and
snapshots. This keeps the checkout path authoritative and avoids a validation /
insert time-of-check-to-time-of-use gap.

The catalog is live at checkout: inactive categories, unavailable products, and
inactive addons cannot be purchased. Variant and addon option ids must belong to
the selected product's groups. Every group's selection count must satisfy its
live minimum and maximum, with no duplicate option ids in a group. Variant
options and addons can contribute their live price deltas, but the client never
supplies a trusted price.

### Integer cents and no order number at creation

Orders and snapshots store integer cents (`base_price_cents`, `price_delta_cents`,
`unit_price_cents`, and `subtotal_cents`) to avoid decimal arithmetic. The
created order has status `payment_pending`, a null `order_number`, and no
`paid_at` timestamp. `kiosk_order_counters(kiosk_id, service_date)` is created
as part of this persistence layer for spec 4, but this handler never allocates
from it. Spec 4 will calculate `service_date` from the server/Docker `TZ`, not
from browser time, when payment is approved.

### Explicit cart input

The public input is deliberately small and contains ids plus quantity only:

```ts
type CreateOrderInput = {
  lines: Array<{
    productId: string;
    quantity: number;
    variantOptionIds: string[];
    addonIds: string[];
  }>;
};
```

The kiosk id is not part of this type. The handler reads and verifies the
`kiosk_session` cookie with the server-only cookie secret, then confirms that
the referenced kiosk still exists. A caller cannot select a different kiosk by
posting an id. A cast-on extra field such as `unitPriceCents` is ignored rather
than being accepted as an API field; tests prove that persisted prices remain
catalog-derived.

## Order persistence

The migration adds these tables to the existing catalog and kiosk schema:

- `orders`: text UUID id, kiosk foreign key, nullable `order_number`, status,
  `subtotal_cents`, `total_amount_cents`, server-created `created_at`, and
  nullable `paid_at`.
- `order_items`: order and product foreign keys, immutable product id/name,
  quantity, and immutable unit base price in cents.
- `order_item_variants`: item and option foreign keys, immutable option name and
  price delta in cents.
- `order_item_addons`: item and addon foreign keys, immutable addon name and
  price delta in cents.
- `kiosk_order_counters`: composite `(kiosk_id, service_date)` primary key and
  `next_number` defaulting to 1; it is intentionally unused until payment
  reconciliation allocates an order number.

Child snapshots reference their order/item with cascading deletes, while the
source catalog foreign keys remain available for traceability. Snapshot names
and prices are required, so later catalog edits cannot change a past receipt.
There is no payment-attempt row in this spec; spec 4 owns that transition.

## Server-function contract

The application boundary is an extracted handler plus one named POST server
function:

```ts
type OrderItemSnapshot = {
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

type CreateOrderResult = {
  id: string;
  kioskId: string;
  status: "payment_pending";
  orderNumber: null;
  subtotalCents: number;
  totalAmountCents: number;
  items: OrderItemSnapshot[];
};

export const createOrder = createServerFn({ method: "POST" })
  .validator((input) => v.parse(createOrderInputSchema, input))
  .handler(({ data }) => createOrderHandler(data));
```

Clients call `createOrder({ data: input })`. The result is sufficient for the
payment-attempt flow to associate a later attempt with the pending order and
for the UI to show the server-calculated amount. No client-submitted subtotal,
total, kiosk id, or price is returned to or persisted by this function.

## Validation and immutable snapshots

The handler first verifies the signed cookie and live kiosk. It rejects an
empty cart, zero or negative quantity, non-integer quantity, malformed ids, and
non-array modifier fields before any writes. For each line it loads the active
product and all of that product's groups/options. It then checks:

1. the product exists in an active category and is available;
2. every selected variant option exists, is attached to the product's variant
   group, and has no duplicate id;
3. every variant group's selection count is between its live minimum and
   maximum;
4. every selected addon exists, is active, is attached to the product's addon
   group, and has no duplicate id;
5. every addon group's selection count is between its live minimum and maximum.

The server computes each line as `(base price + selected variant deltas +
selected addon deltas) * quantity`, sums lines into the order subtotal, and
uses the same value as `total_amount_cents` because taxes, discounts, and fees
are outside this POC. It inserts one order, one item per cart line, and child
snapshot rows for each selected modifier. The response maps the inserted rows
back to the same immutable names and cents values.

## Errors and transaction behavior

Domain failures use a typed `CreateOrderError` with a stable code, following the
kiosk-claim precedent:

- `configuration`: the cookie secret is absent;
- `kiosk_identity`: the cookie is missing, invalid, or points to a missing kiosk;
- `invalid_input`: empty cart, malformed fields, or non-positive/non-integer
  quantity;
- `catalog_unavailable`: a product/category is missing, inactive, unavailable,
  or an addon is inactive;
- `selection_invalid`: an option is unknown, belongs to another product/group,
  duplicated, or violates a group's selection bounds.

The error message is useful for logs/UI diagnostics, while callers should branch
on `code`. All validation happens before inserts and all inserts run in one
transaction. Any database failure rolls back the order and every snapshot; no
partially-created pending order is observable. Payment failures and expiry are
immutable attempt/order transitions owned by spec 4.

## Testing and verification

The colocated `src/lib/order.functions.test.ts` uses the shared
`createTestDatabase`, `mockDatabaseModule`, and `withStartContext` helpers. It
passes a unique temporary file-backed SQLite URL to `createTestDatabase` so the
transaction connection and the assertion connection observe the same database;
the default `file::memory:` URL is connection-local with libSQL transactions.
The first draft runs against the not-yet-implemented handler to establish a
real red phase. Tests then cover a valid pending order, live price calculation,
product/modifier name and price snapshots, null order number, no counter
allocation, signed-cookie kiosk ownership, empty/zero carts, unavailable
catalog rows, selection-bound failures, and rollback/no partial rows.

One security regression test casts an extra `unitPriceCents` field onto an
otherwise valid input. It asserts that the persisted and returned unit/total
prices still equal the live catalog prices, demonstrating that client prices are
not trusted even when an attacker adds the field at runtime.

After implementation, run the repository checks once:

```bash
bun run lint && bun run format && bun run typecheck && bun run test
```

## Non-goals

This spec does not create payment attempts, terminal commands, receipts,
reconciliation, approval/decline/expiry transitions, order-number allocation,
server-timezone service-date calculation, printer commands, kitchen events,
stock decrementing, taxes, discounts, fees, or an HTTP `/api/orders` route.
Spec 4 owns payment reconciliation and order-number allocation through the
counter created here.
