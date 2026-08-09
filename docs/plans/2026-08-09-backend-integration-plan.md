# Backend-platform and kiosk-ui integration Implementation Plan

> **For agentic workers:** Execute this plan task-by-task in this worktree. Each task follows the existing regression workflow and ends with a focused check before the next seam is changed.

**Goal:** Replace every temporary kiosk-ui server-function seam with the merged backend-platform implementation, add the missing database-backed kiosk session lookup, and prove the real order lifecycle end to end.

**Architecture:** The UI keeps its existing TanStack Query/server-function boundary and calls the backend `catalog.functions.ts`, `kiosk.functions.ts`, `order.functions.ts`, `payment.functions.ts`, and `kitchen.functions.ts` modules directly. Kiosk session identity is verified from the signed request cookie and resolved from the `kiosks` table; kitchen updates continue through the existing `/api/kitchen/events` SSE route. Frontend-only cart mapping remains in `checkout.ts`, but it imports the backend order types.

**Tech Stack:** Bun, TypeScript, TanStack Start `createServerFn`, TanStack Query, Drizzle ORM/libSQL, Valibot, Playwright, SQLite migrations/seeding, and the existing SSE route.

## Global Constraints

- Use `GOAL.md`'s direct-read seam comparison and callsite list as authoritative; do not invent alternate contracts.
- Preserve public input/output/error shapes and existing UI assertions; no assertion weakening, fixture substitution, or local fallback implementation is allowed.
- Export the existing nested catalog types (`MenuAddon`, `MenuAddonGroup`, `MenuVariantOption`, `MenuVariantGroup`, `MenuProduct`, `MenuCategory`) with no shape/runtime change so `menu-screen.tsx` can import `MenuProduct` from the real module.
- Use `ClaimKioskInput` from `kiosk.functions.ts`; move the existing three-line client-side `normalizePrefix(value: string): string | null` format helper into `kiosk-claim-screen.tsx` because the backend helper is private. Backend validation remains authoritative.
- Implement `getKioskSession(): Promise<Kiosk | null>` as a named GET server function that verifies `readKioskCookie(serverEnv.KIOSK_COOKIE_SECRET)` and resolves the kiosk row by id.
- Keep `KitchenErrorCode` as a local six-code UI union, import `KitchenOrder` and backend `KitchenOrderEvent` from `kitchen.functions.ts`, and do not change the real SSE route.
- When a UI imports a backend `*.functions.ts` module, keep TanStack import-protection intact: server-only DB/cookie/PostHog dependencies and named handler bodies belong in colocated `*.functions.server.ts` modules; wrappers must not re-export handlers for client convenience.
- Keep `src/lib/checkout.ts` and `src/lib/checkout.test.ts`; import `CreateOrderInput` and `CreateOrderResult` from `order.functions.ts` instead of duplicating them.
- Delete only `menu.ts`, `kiosk-session.ts` and `kiosk-session.test.ts`, `payment.ts` and `payment.test.ts`, and `kitchen.ts` and `kitchen.test.ts` after all imports are migrated.
- Use the approved local-only environment values; `.env` is ignored and must not be committed:

  ```dotenv
  KIOSK_CLAIM_PASSWORD=dev-kiosk-claim-2026
  KIOSK_COOKIE_SECRET=dev-kiosk-cookie-secret-2026-rotate
  STAFF_COOKIE_SECRET=dev-staff-cookie-secret-2026-rotate
  ```

- After each seam swap, run that seam's existing backend colocated test(s) and the complete `e2e/browser/*.spec.ts` suite. Stop on an undocumented contract failure instead of changing assertions.
- Run the final full checks exactly once after all seams and cleanup: `bun run lint && bun run format && bun run typecheck && bun run test && bun run build`.
- The final proof must use `bun run db:migrate`, `bun run db:seed`, the built server, and a live browser against the real database; report observed states, not only command exit codes.

---
### Task 0: Isolate server-only backend handler bodies

**Files:**
- Create: `src/lib/catalog.functions.server.ts`
- Create: `src/lib/kiosk.functions.server.ts`
- Create: `src/lib/order.functions.server.ts`
- Create: `src/lib/payment.functions.server.ts`
- Create: `src/lib/kitchen.functions.server.ts`
- Modify: each corresponding `src/lib/*.functions.ts` wrapper
- Modify: `src/lib/catalog.functions.test.ts`, `kiosk.functions.test.ts`, `order.functions.test.ts`, `payment.functions.test.ts`, and `kitchen.functions.test.ts`

**Interfaces:**
- Consumes: the existing backend handler bodies and their current exported input/output/error types.
- Produces: client-safe `*.functions.ts` modules containing public types, Valibot validators, and `createServerFn` wrappers; server-only `*.functions.server.ts` modules containing DB/cookie/PostHog imports and named handlers. Public server-function names and payload contracts do not change.

- [ ] **Step 1: Move catalog and kiosk server implementations.**

Move `loadMenu` and its DB/schema imports to `catalog.functions.server.ts`, import its `Menu` type from `catalog.functions.ts`, and leave `getMenu = createServerFn({ method: \"GET\" }).handler(loadMenu)` in the wrapper. Move kiosk `getKioskSessionHandler`, `listKiosksHandler`, `claimKioskHandler`, their crypto/DB/cookie helpers, and `KioskClaimError` to `kiosk.functions.server.ts`; leave `Kiosk`, `ClaimKioskInput`, the Valibot input schema, and thin wrappers in `kiosk.functions.ts`. Use a direct imported handler for `claimKiosk`:

```ts
import { claimKioskServerHandler } from \"./kiosk.functions.server\";

export const claimKiosk = createServerFn({ method: \"POST\" })
  .validator((input) => v.parse(claimKioskInputSchema, input))
  .handler(claimKioskServerHandler);
```

`claimKioskServerHandler` adapts `{ data: ClaimKioskInput }` to the existing tested `claimKioskHandler(data)` without changing its result or errors.

- [ ] **Step 2: Move order, payment, and kitchen server implementations.**

Move each module's DB/cookie/PostHog imports, error classes, named handler bodies, and internal helpers to its matching `.server.ts` file. Keep public types and validators in the wrapper; import server handlers directly into `.handler(...)`. `payment.functions.server.ts` must import `getKitchenOrderSnapshot` from `kitchen.functions.server.ts` rather than the client-safe wrapper. Tests must import `loadMenu`, `createOrderHandler`, payment handlers, and kitchen handlers/errors from their `.server.ts` files, preserving the existing test bodies.

- [ ] **Step 3: Run every backend suite before wiring UI imports.**

Run:

```bash
bun test src/lib/catalog.functions.test.ts src/lib/kiosk.functions.test.ts src/lib/order.functions.test.ts src/lib/payment.functions.test.ts src/lib/kitchen.functions.test.ts
bun run build
```

Expected: all existing backend tests pass and the production build succeeds without import-protection errors. If a server-only import is still reachable from a client wrapper, move that import or named handler body into the corresponding `.server.ts` file; do not weaken tests or disable import protection.

---

### Task 1: Add the backend session lookup and catalog type visibility

**Files:**
- Modify: `src/lib/kiosk.functions.server.ts`
- Modify: `src/lib/kiosk.functions.ts`
- Modify: `src/lib/catalog.functions.server.ts`
- Modify: `src/lib/catalog.functions.ts`
- Test: existing `src/lib/kiosk.functions.test.ts` and `src/lib/catalog.functions.test.ts` (run only; do not add duplicate contract tests)

**Interfaces:**
- Consumes: `readKioskCookie(secret): KioskCookiePayload | null`, `serverEnv.KIOSK_COOKIE_SECRET`, `db`, `kiosks`, `eq`, and existing `toKiosk`.
- Produces: exported `getKioskSession` with `Kiosk | null` result and exported nested catalog types for the UI import.

- [ ] **Step 1: Add `getKioskSessionHandler` in the server-only kiosk module.**

Add this handler in `kiosk.functions.server.ts` beside the existing server handlers, then register the imported handler in the client-safe wrapper:

```ts
import { readKioskCookie, setKioskCookie } from "./kiosk-cookie.server";

export const getKioskSessionHandler = async (): Promise<Kiosk | null> => {
  const payload = readKioskCookie(serverEnv.KIOSK_COOKIE_SECRET);
  if (!payload) {
    return null;
  }
  const rows = await db
    .select({ id: kiosks.id, name: kiosks.name, prefix: kiosks.prefix })
    .from(kiosks)
    .where(eq(kiosks.id, payload.kioskId))
    .limit(1);
  const kiosk = rows[0];
  return kiosk ? toKiosk(kiosk) : null;
};
```

Register the public function with the same GET pattern as `listKiosks`:

```ts
export const getKioskSession = createServerFn({ method: "GET" }).handler(getKioskSessionHandler);
```

A missing/invalid cookie or a valid cookie for a deleted kiosk returns `null`; do not create a second session map or set a cookie here.

- [ ] **Step 2: Export the existing catalog declaration types.**

Change only the six declaration prefixes in `src/lib/catalog.functions.ts`:

```ts
export type MenuAddon = ...;
export type MenuAddonGroup = ...;
export type MenuVariantOption = ...;
export type MenuVariantGroup = ...;
export type MenuProduct = ...;
export type MenuCategory = ...;
```

Keep every field and implementation line unchanged.

- [ ] **Step 3: Run the backend tests for the changed implementation.**

Run:

```bash
bun test src/lib/kiosk.functions.test.ts src/lib/catalog.functions.test.ts
```

Expected: PASS with the existing handler assertions. If a failure indicates a contract not documented in `GOAL.md`, stop and report it rather than changing test assertions.

- [ ] **Step 4: Commit the backend prerequisite slice.**

```bash
git add src/lib/kiosk.functions.ts src/lib/catalog.functions.ts
git commit -m "feat(integration): add backend kiosk session lookup"
```

---

### Task 2: Swap menu, kiosk claim, and home session callsites

**Files:**
- Modify: `src/components/menu-screen.tsx`
- Modify: `src/components/kiosk-claim-screen.tsx`
- Modify: `src/routes/index.tsx`
- Test: existing `src/lib/catalog.functions.test.ts`, `src/lib/kiosk.functions.test.ts`, and all `e2e/browser/*.spec.ts`

**Interfaces:**
- Consumes: `getMenu`/`MenuProduct`, `claimKiosk`/`listKiosks`/`ClaimKioskInput`, and `getKioskSession` from backend modules.
- Produces: no local seam imports; the home loader and query resolve the signed-cookie/database-backed kiosk.

- [ ] **Step 1: Swap the menu import.**

In `menu-screen.tsx`, replace:

```ts
import { getMenu, type MenuProduct } from "#/lib/menu";
```

with:

```ts
import { getMenu, type MenuProduct } from "#/lib/catalog.functions";
```

Do not alter menu rendering, cart state, or the `getMenu()` query.

- [ ] **Step 2: Move the client-only prefix validator and swap kiosk claim imports.**

Replace the import with:

```ts
import {
  claimKiosk,
  listKiosks,
  type ClaimKioskInput,
} from "#/lib/kiosk.functions";
```

Add this helper near the claim error copy, preserving the local form's current validation behavior:

```ts
const normalizePrefix = (value: string): string | null => {
  const prefix = value.trim().toUpperCase();
  return /^[A-Z0-9]{1,5}$/.test(prefix) ? prefix : null;
};
```

Change the mutation annotation from `KioskClaimInput` to `ClaimKioskInput`. Keep the existing `claimKiosk({ data })`, client-side error copy, and form fields unchanged.

- [ ] **Step 3: Swap the home route import.**

In `src/routes/index.tsx`, replace:

```ts
import { getKioskSession } from "#/lib/kiosk-session";
```

with:

```ts
import { getKioskSession } from "#/lib/kiosk.functions";
```

Leave both the loader and query call intact so SSR and client refresh use the same server function.

- [ ] **Step 4: Run backend tests and the complete browser suite immediately after this seam swap.**

Prepare the real local database once for this and subsequent browser runs:

```bash
bun run db:migrate
bun run db:seed
```

Then run:

```bash
bun test src/lib/catalog.functions.test.ts src/lib/kiosk.functions.test.ts
bun run test:e2e
```

`bun run test:e2e` builds the app and runs all configured Playwright specs, including every `e2e/browser/*.spec.ts` file. Expected: PASS with the menu, claim, home, and existing UI flows still asserted. A real contract drift is a stop-and-report condition.

- [ ] **Step 5: Commit the menu/kiosk wiring slice.**

```bash
git add src/components/menu-screen.tsx src/components/kiosk-claim-screen.tsx src/routes/index.tsx
git commit -m "feat(integration): wire menu and kiosk UI to backend"
```

---

### Task 3: Swap payment and checkout type consumers

**Files:**
- Modify: `src/components/checkout-screen.tsx`
- Modify: `src/lib/use-abandonment.ts`
- Modify: `src/lib/checkout.ts`
- Test: existing `src/lib/order.functions.test.ts`, `src/lib/payment.functions.test.ts`, `src/lib/checkout.test.ts`, and all `e2e/browser/*.spec.ts`

**Interfaces:**
- Consumes: backend `createOrder`, `CreateOrderInput`, `CreateOrderResult`, `startPaymentAttempt`, `reconcilePaymentAttempt`, and `expirePaymentAttempt`.
- Produces: real order/payment persistence and expiry behavior through unchanged UI state transitions.

- [ ] **Step 1: Replace checkout-screen imports without changing the state machine.**

Change the existing payment seam import to backend imports equivalent to:

```ts
import {
  reconcilePaymentAttempt,
  startPaymentAttempt,
} from "#/lib/payment.functions";
import { createOrder } from "#/lib/order.functions";
```

Preserve all `createOrder({ data })`, `startPaymentAttempt({ data })`, and `reconcilePaymentAttempt({ data })` payloads and state transitions exactly.

- [ ] **Step 2: Replace the abandonment expiry import.**

In `src/lib/use-abandonment.ts`, replace the `expirePaymentAttempt` import from `#/lib/payment` with:

```ts
import { expirePaymentAttempt } from "#/lib/payment.functions";
```

Keep the existing call shape `{ data: { attemptId } }` exactly; this is the already-aligned backend input contract.

- [ ] **Step 3: Reuse backend order result/input types in checkout mapping.**

In `src/lib/checkout.ts`, remove the local `CreateOrderInput` and `CreateOrderResult` declarations and add:

```ts
import type { CreateOrderInput, CreateOrderResult } from "./order.functions";
```

Continue exporting/importing those names from `checkout.ts` only if current consumers require it; prefer direct type imports for new consumers and preserve runtime behavior of `toCreateOrderInput`.

- [ ] **Step 4: Run the backend, checkout, and browser regressions.**

Run:

```bash
bun test src/lib/order.functions.test.ts src/lib/payment.functions.test.ts src/lib/checkout.test.ts
bun run test:e2e
```

Expected: PASS for real order/payment handlers and all browser specs. Do not shorten timers or replace backend calls with fixtures to make this pass; any undocumented drift must be reported.

- [ ] **Step 5: Commit the payment wiring slice.**

```bash
git add src/components/checkout-screen.tsx src/lib/use-abandonment.ts src/lib/checkout.ts
git commit -m "feat(integration): wire checkout to backend payments"
```

---

### Task 4: Swap the kitchen queue to backend handlers and SSE types

**Files:**
- Modify: `src/components/kitchen-screen.tsx`
- Test: existing `src/lib/kitchen.functions.test.ts`, `src/components/kitchen-screen.test.ts`, and all `e2e/browser/*.spec.ts`

**Interfaces:**
- Consumes: backend `claimStaffSession`, `listActiveOrders`, `advanceOrder`, `KitchenOrder`, and `KitchenOrderEvent`.
- Produces: staff claim and order transitions through the real signed staff cookie and `/api/kitchen/events` stream.

- [ ] **Step 1: Replace kitchen imports and retain the UI's six-code copy map.**

Replace local action/type imports with:

```ts
import {
  advanceOrder,
  claimStaffSession,
  listActiveOrders,
  type KitchenOrder,
  type KitchenOrderEvent,
} from "#/lib/kitchen.functions";
```

Declare this local union before the error-copy `Record`:

```ts
type KitchenErrorCode =
  | "configuration"
  | "invalid_password"
  | "invalid_input"
  | "staff_identity"
  | "order_not_found"
  | "invalid_transition";
```

Use `KitchenOrderEvent` for the SSE event handler type. Keep the existing `EventSource("/api/kitchen/events")`, event names, `.order` reads, and duck-typed `"code" in error` checks unchanged. The backend's extra paid-event fields are intentionally ignored.

- [ ] **Step 2: Run backend and component tests plus the browser suite.**

Run:

```bash
bun test src/lib/kitchen.functions.test.ts src/components/kitchen-screen.test.ts
bun run test:e2e
```

Expected: PASS with staff claim, list, SSE refresh, and paid→preparing→done UI behavior intact. Stop on any unanticipated type or runtime contract mismatch.

- [ ] **Step 3: Commit the kitchen wiring slice.**

```bash
git add src/components/kitchen-screen.tsx
git commit -m "feat(integration): wire kitchen UI to backend"
```

---

### Task 5: Remove dead local seams and create the local runtime environment

**Files:**
- Delete: `src/lib/menu.ts`
- Delete: `src/lib/kiosk-session.ts`
- Delete: `src/lib/kiosk-session.test.ts`
- Delete: `src/lib/payment.ts`
- Delete: `src/lib/payment.test.ts`
- Delete: `src/lib/kitchen.ts`
- Delete: `src/lib/kitchen.test.ts`
- Create ignored: `.env`

**Interfaces:**
- Consumes: all real backend imports from Tasks 1–4.
- Produces: no remaining imports or source files for temporary local server-function seams; real dev secrets available to server functions.

- [ ] **Step 1: Prove no callsite remains before deleting.**

Run:

```bash
bunx tsc --noEmit --pretty false
```

Then search only source/test files for the seam paths:

```bash
grep -R 'lib/menu\|lib/kiosk-session\|lib/payment\|lib/kitchen' src e2e
```

Expected: no import matches. If a match remains, migrate that caller before deletion; do not leave aliases or compatibility re-exports.

- [ ] **Step 2: Delete exactly the seven dead seam artifacts.**

Remove the files listed above. Keep `src/lib/checkout.ts`, `src/lib/checkout.test.ts`, all `*.functions.ts` backend modules, `kiosk-cookie.server.ts`, `staff-cookie.server.ts`, and the kitchen SSE route.

- [ ] **Step 3: Write the ignored local `.env`.**

Create `.env` with exactly:

```dotenv
KIOSK_CLAIM_PASSWORD=dev-kiosk-claim-2026
KIOSK_COOKIE_SECRET=dev-kiosk-cookie-secret-2026-rotate
STAFF_COOKIE_SECRET=dev-staff-cookie-secret-2026-rotate
```

Do not add production credentials or commit this file. `POSTHOG_KEY`/`POSTHOG_HOST` remain unset.

- [ ] **Step 4: Run the final focused regression after cleanup.**

Run:

```bash
bun test src/lib/catalog.functions.test.ts src/lib/kiosk.functions.test.ts src/lib/order.functions.test.ts src/lib/payment.functions.test.ts src/lib/kitchen.functions.test.ts src/lib/checkout.test.ts
bun run test:e2e
```

Expected: PASS with no local seam module available to accidentally resolve.

- [ ] **Step 5: Commit the cleanup/environment slice.**

```bash
git add -u src/lib
# `.env` is ignored and must remain unstaged
git commit -m "refactor(integration): remove local server seams"
```

---

### Task 6: Run final repository checks and record evidence

**Files:**
- Modify: `GOAL.md` Plan/Log sections (excluded from git; keep current during execution)

**Interfaces:**
- Consumes: the complete backend-wired application and test/build scripts.
- Produces: exact command output, test counts, and implementation commit hashes for handoff to Main.

- [ ] **Step 1: Run the required full checks once after implementation and cleanup.**

Run exactly:

```bash
bun run lint && bun run format && bun run typecheck && bun run test && bun run build
```

Record each command's observed result and any test count in `GOAL.md`. Do not claim green if a command fails.

- [ ] **Step 2: Migrate and seed the real local database.**

Run:

```bash
bun run db:migrate
bun run db:seed
```

Record the seeded kiosk/menu/order baseline and database path used by the app. Re-run only if a clean reset is required to make the live proof deterministic.

- [ ] **Step 3: Start the built application.**

In a persistent process, run:

```bash
bun run start
```

Wait until the built server is listening (normally `http://localhost:3000`), then use browser control against that actual server. Do not substitute Vite fixtures, mocked requests, or unit-test handlers.

- [ ] **Step 4: Drive and record the complete live customer/staff flow.**

Using browser control and the approved password, observe and record:

1. Open `/`, enter `dev-kiosk-claim-2026`, choose or create a kiosk, and confirm the signed session persists on reload.
2. Browse the seeded menu, add a product to the cart, open checkout, start payment, and complete the real checkout state machine. Confirm the order reaches `paid` in the database/UI and is not produced by a local fixture.
3. Open `/kitchen` in a staff context, claim with the same kiosk password, and observe the newly paid order arrive through the live `/api/kitchen/events` SSE queue without a page refresh.
4. Advance that order from `paid` to `preparing` and then `done`; record each observed status and kitchen update.
5. Separately start a cart, wait for the configured idle warning/timeout, and confirm the cart is cleared and the abandonment UI returns to menu without manually resetting state.
6. Separately create a payment-pending order, allow the configured pending expiry path to call real `expirePaymentAttempt`, and confirm the payment attempt becomes `expired` and the UI leaves the pending state. Capture the attempt/order ids and observed terminal statuses.

- [ ] **Step 5: Update `GOAL.md` and report to Main.**

Add Plan entries for the approved design/plan and implementation commit hashes, then Log entries containing focused test counts, full-check output, migration/seed result, server URL, and the exact live browser observations. Send Main a concise handoff listing commits, deleted files, `getKioskSession` behavior, and every observed lifecycle state. Do not mark the goal complete until all acceptance criteria are directly evidenced.
