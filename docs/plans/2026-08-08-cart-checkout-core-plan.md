# Cart and checkout core Implementation Plan

> **For agentic workers:** Execute this plan task-by-task with the repository's TDD workflow. Steps use checkbox syntax for tracking.

**Goal:** Add an authenticated `createOrder` server function that validates a kiosk cart against live catalog rows and stores an immutable `payment_pending` order with modifier snapshots.

**Architecture:** Keep the named TanStack Start server-function boundary in `src/lib/order.functions.ts`, with an extracted handler for direct tests. Read the signed kiosk cookie and validate all catalog relationships inside one Drizzle transaction, then insert the order and snapshot children atomically. Extend the existing Drizzle schema and generate one migration for orders, snapshots, and the spec-4 counter without allocating a number yet.

**Tech Stack:** Bun, TypeScript, TanStack Start `createServerFn`, Valibot, Drizzle ORM with libSQL/SQLite, Bun Test, shared `src/test/db-test-support.ts`.

## Global Constraints

- Every cross-layer checkout call is the named `createOrder` `createServerFn`; do not add `/api/orders` or another ad-hoc REST route.
- Kiosk identity comes only from the signed `kiosk_session` cookie and server-only `KIOSK_COOKIE_SECRET`; never accept a client kiosk id.
- Client input contains product/modifier ids and positive integer quantity only; no client price, subtotal, total, or order number is trusted.
- Validation uses live catalog rows and computes integer cents on the server; inactive categories/products/addons and invalid group ownership/selections fail before writes.
- Order creation stores `payment_pending`, null `order_number`, null `paid_at`, immutable product/option/addon name and price snapshots, and no payment attempt.
- Empty carts and zero/non-positive/non-integer quantities throw typed `CreateOrderError` with `invalid_input`; catalog failures use `catalog_unavailable`; selection failures use `selection_invalid`; missing/invalid kiosk identity uses `kiosk_identity`.
- Use `src/test/db-test-support.ts` (`createTestDatabase`, `mockDatabaseModule`, `withStartContext`) rather than creating another database fixture.
- Write the colocated test first and run it red before adding schema or implementation; skip repo-wide lint/format/typecheck/test until the end.

---

## File map

- Create `src/lib/order.functions.test.ts`: isolated, colocated red-green tests for handler behavior and persisted snapshots.
- Modify `src/db/schema.ts`: add `kioskOrderCounters`, `orders`, `orderItems`, `orderItemVariants`, and `orderItemAddons` with integer-cent columns and foreign keys.
- Create via Drizzle `drizzle/0004_*.sql` and `drizzle/meta/0004_snapshot.json`; do not hand-edit migration metadata.
- Create `src/lib/order.functions.ts`: public input/result/error types, Valibot input schema, cookie-authenticated relational validation, transaction, inserts, and named server function.
- Create `docs/specs/2026-08-08-cart-checkout-core-design.md` (already committed): approved design contract.
- Create `docs/plans/2026-08-08-cart-checkout-core-plan.md` (this file): implementation sequence and verification.

## Interfaces between tasks

The test and frontend consume these stable names and shapes:

```ts
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
  }>;
};

export type CreateOrderErrorCode =
  | "configuration"
  | "kiosk_identity"
  | "invalid_input"
  | "catalog_unavailable"
  | "selection_invalid";

export class CreateOrderError extends Error {
  constructor(public readonly code: CreateOrderErrorCode, message: string) {
    super(message);
    this.name = "CreateOrderError";
  }
}

export const createOrderHandler: (input: CreateOrderInput) => Promise<CreateOrderResult>;
export const createOrder: ReturnType<typeof createServerFn>;
```

## Task 1: Write and prove the failing colocated test

**Files:**
- Create: `src/lib/order.functions.test.ts`
- Read/reuse: `src/test/db-test-support.ts`, `src/lib/kiosk-cookie.server.ts`, `src/db/schema.ts`

- [ ] **Step 1: Set up shared migrated database and cookie/server mocks.**

Create the test module with imports from `bun:test`, `drizzle-orm`, the shared support module, and cookie helpers. Use `createTestDatabase(\`file:/tmp/self-service-order-${randomUUID()}.db\`)` with a unique temporary file URL: libSQL's default `file::memory:` database is connection-local when `db.transaction` opens its transaction connection, while the file URL lets the transaction and post-call assertions share state. Before importing the order module, call `mockDatabaseModule(db)`, mock `#/env.server` with `{ KIOSK_COOKIE_SECRET: "cookie-secret" }`, and mock `@tanstack/react-start/server` so `getRequestHeader` returns a mutable cookie header. Sign `{ kioskId: "kiosk-a", issuedAt: 1_754_672_000_000 }` with `signKioskCookie` and set `requestCookie` to `kiosk_session=<token>`. Seed one kiosk, active category/product, one variant group with two options, and one addon group with one active addon using fixed ids and cents. Import `createOrderHandler` after mocks.

- [ ] **Step 2: Write assertions for a valid pending order and forged-price resistance.**

Use this input (then cast an extra field only in the test):

```ts
const validInput = {
  lines: [
    {
      productId: "product-latte",
      quantity: 2,
      variantOptionIds: ["variant-oat"],
      addonIds: ["addon-syrup"],
    },
  ],
};
const result = await withStartContext(() =>
  createOrderHandler({
    ...validInput,
    unitPriceCents: 1,
  } as CreateOrderInput),
);
```

Assert the result has `status === "payment_pending"`, `kioskId === "kiosk-a"`, `orderNumber === null`, `subtotalCents === totalAmountCents === 2 * (500 + 75 + 50)`, and one item whose product name, base unit price, variant/addon names, and live deltas match the seed. Query `orders`, `orderItems`, `orderItemVariants`, and `orderItemAddons` by the returned ids and assert the same values were persisted; query `kioskOrderCounters` and assert no rows exist.

- [ ] **Step 3: Add boundary/error tests.**

Add tests that invoke `createOrderHandler` through `withStartContext` and assert typed `code` values for: missing cookie (`kiosk_identity`), empty lines (`invalid_input`), quantity `0` (`invalid_input`), unavailable product (`catalog_unavailable`), an unknown option (`selection_invalid`), and selecting fewer options than a required variant group's `minSelections` (`selection_invalid`). Add a `beforeEach` that deletes order-item modifier rows, order-item rows, order rows, and counter rows so every case starts with the same seeded catalog and can assert the `orders` table remains empty after rejection.

- [ ] **Step 4: Run only the new test to establish red.**

Run:

```bash
bun test src/lib/order.functions.test.ts
```

Expected: FAIL before schema/function implementation exists (module import or missing table/function failure). Record the red result in the implementation commit notes; do not make the test pass by weakening assertions.

## Task 2: Add order and counter schema/migration

**Files:**
- Modify: `src/db/schema.ts`
- Create via generator: `drizzle/0004_*.sql`, `drizzle/meta/0004_snapshot.json`

- [ ] **Step 1: Add the tables using existing text-id and integer-cent conventions.**

Add `kioskOrderCounters` with `kioskId` and `serviceDate` text columns and `nextNumber` integer default 1, using a composite primary key. Add `orders` with text id, kiosk foreign key, nullable order number, status, integer `subtotalCents` and `totalAmountCents`, and integer millisecond timestamps (`createdAt` uses Drizzle `mode: "timestamp_ms"` with a server default of `unixepoch() * 1000`; `paidAt` is nullable). Add `orderItems` with order/product FKs, immutable `productName`, `quantity`, and `unitPriceCents`. Add `orderItemVariants` and `orderItemAddons` with item/source-option FKs, immutable names, and integer `priceDeltaCents`. Use `onDelete: "cascade"` on order-to-child FKs and preserve source-catalog FKs for traceability.

- [ ] **Step 2: Generate the migration and inspect its SQL.**

Run:

```bash
bun run db:generate
```

Expected: exactly one new migration adding all five tables and indexes/foreign keys without modifying prior migrations. Read the generated SQL and verify `orders.order_number` is nullable, cents columns are integer, the counter primary key is `(kiosk_id, service_date)`, and child deletes cascade.

- [ ] **Step 3: Rerun the colocated test and keep the red assertions.**

Run:

```bash
bun test src/lib/order.functions.test.ts
```

Expected: it remains FAIL because `src/lib/order.functions.ts` is not implemented, while `createTestDatabase()` now applies the generated tables successfully.

## Task 3: Implement `createOrder` minimally and transactionally

**Files:**
- Create: `src/lib/order.functions.ts`

- [ ] **Step 1: Define public types, typed errors, and Valibot validator.**

Define the exact types in the interface block above. Validate the outer object, non-empty `lines`, each product id, positive integer quantity, and array-shaped modifier ids with Valibot. Keep unknown fields strip/ignore behavior so a runtime-cast `unitPriceCents` field cannot reach trusted calculations. Define `CreateOrderError` and its five codes.

- [ ] **Step 2: Read and verify kiosk identity before writes.**

Read `serverEnv.KIOSK_COOKIE_SECRET`; throw `configuration` if absent. Call `readKioskCookie(secret)`; throw `kiosk_identity` if null. Query `kiosks` by the signed payload id; throw `kiosk_identity` if no row. Never read a kiosk id from input.

- [ ] **Step 3: Validate each line from relational rows inside `db.transaction`.**

Inside one transaction, load the product joined to an active category and `isAvailable = true`. Missing rows throw `catalog_unavailable`. Load all variant/addon groups for the product and all options/addons for those groups. Partition selected ids by group, reject unknown/foreign/duplicate ids with `selection_invalid`, and enforce each group's min/max. Inactive addons count as unavailable; unknown variant options are selection-invalid. Compute each line's `unitPriceCents` as the live base price for the item while adding live modifier deltas to the line total.

- [ ] **Step 4: Insert order and immutable snapshots atomically.**

Generate text ids with `randomUUID()`. Insert one `orders` row with kiosk id, `payment_pending`, null order number/paid timestamp, and computed subtotal/total. Insert one `orderItems` row per cart line with product name and base price. Insert child variant/addon rows with source ids and current names/deltas. Return the typed result from the inserted values. Do not insert/update `kioskOrderCounters` and do not create payment attempts.

- [ ] **Step 5: Export the named POST server function.**

Export:

```ts
export const createOrder = createServerFn({ method: "POST" })
  .validator((input) => v.parse(createOrderInputSchema, input))
  .handler(({ data }) => createOrderHandler(data));
```

Keep handler export available for direct colocated tests, matching the kiosk function pattern.

- [ ] **Step 6: Run the focused tests green.**

Run:

```bash
bun test src/lib/order.functions.test.ts
```

Expected: all checkout tests PASS, including live price calculation despite the cast-on forged price, cookie ownership, bounds, errors, and no counter allocation.

## Task 4: Refactor and review the contract

**Files:**
- Modify: `src/lib/order.functions.ts`, `src/lib/order.functions.test.ts`, and design/plan docs only if an observed implementation detail changes the approved contract.

- [ ] **Step 1: Refactor only after green.**

Remove duplicated test setup and keep validation helpers private and small (identity, per-line catalog loading, selection checks, snapshot inserts). Do not alter the server function name, input shape, error codes, or response shape. Keep all writes within the same transaction.

- [ ] **Step 2: Rerun focused tests after refactor.**

Run:

```bash
bun test src/lib/order.functions.test.ts
```

Expected: PASS with no test weakening and no new database fixture.

- [ ] **Step 3: Notify the active frontend lane with the stable signature.**

Check `hub op: "list"` for the current kiosk UI agent name, then send the exact `CreateOrderInput`, `CreateOrderResult`, and `CreateOrderErrorCode` contract directly to that agent. Include that kiosk identity is cookie-derived, prices are server-derived, and errors are typed by `code`.

## Task 5: Final repository verification and commits

**Files:**
- All changed files from Tasks 1–4.

- [ ] **Step 1: Run the required full checks.**

Run:

```bash
bun run lint && bun run format && bun run typecheck && bun run test
```

Expected: each command exits 0; the complete Bun test suite reports zero failures. If formatting changes files, rerun the focused checkout test and inspect the diff before committing.

- [ ] **Step 2: Review final diff for scope and contract.**

Verify the design and plan docs are committed, migration metadata is present, no raw `/api/orders` route was added, no order number/counter row is allocated, no client price is trusted, and no duplicate test-support helper exists. Verify migration replay through the shared test helper succeeds.

- [ ] **Step 3: Commit implementation with scoped Conventional Commit.**

```bash
git add src/db/schema.ts src/lib/order.functions.ts src/lib/order.functions.test.ts drizzle docs/plans/2026-08-08-cart-checkout-core-plan.md
git commit -m "feat(checkout): create pending orders"
```

Expected: commit hooks pass and the branch contains the previously committed design plus this implementation/plan commit.

- [ ] **Step 4: Report completion to Main.**

Send `hub` message to `Main` with implementation commit hash, plan commit/hash, exact frontend signature notification recipient, and the full-check command result.
