# Goal: Backend/platform workflow

- Hub: ../GOAL-HUB.md
- Slug/branch: backend-platform
- Status: doing
- Opened: 2026-08-08
- Origin: "we'll dispatch different workflows: one to build the frontend and the second one for the backend"

## Context

Owns `src/db/**`, TanStack Start server functions, domain logic, seed
script, and the one raw route this lane needs (`/api/kitchen/events`
SSE — `EventSource` requires a URL, can't be a server function).
Boundary contract with the sibling `kiosk-ui` goal: every read/write
operation is a named `createServerFn`, called by the frontend through
TanStack Query — no ad hoc REST `/api/*` routes except that one SSE
exception.

Reference docs (read in this order before designing spec 1):
`main/docs/PRD.md` (product requirements — authoritative), `../GOAL-HUB.md`
(this lane's ordered backlog, reproduced below), `../references.md`
"Backend workflow reference" section (DBML schema shape + "Warm & Melted"
seed payload — implementation detail not in PRD, non-binding).

### Ordered spec backlog (dependency order)

1. **Catalog schema, seed & `getMenu()`** — categories/products/variant
   groups/addon groups schema + "Warm & Melted" seed data + a `getMenu()`
   server function. No dependencies — start here.
2. **Kiosk identity & claim** — `listKiosks()`/`claimKiosk()` server
   functions, `KIOSK_CLAIM_PASSWORD` gate, signed stateless
   `{kioskId, issuedAt}` HttpOnly cookie. No server-side session table,
   no heartbeat, no reclaim locking (accepted POC limitation).
3. **Cart & checkout core** — `createOrder(cart)`: validates against
   catalog, persists immutable `payment_pending` order + order_items/
   modifier snapshots (name *and* price), `kiosk_order_counters`
   allocation. Depends on 1 + 2.
4. **Fake device/payment reconcile** — `reconcilePaymentAttempt(id,
   receipt)`: ownership/state/expiry/command-correlation/amount checks,
   marks order paid, records printer command. Depends on 3.
5. **Kitchen queue** — `listActiveOrders()`/`advanceOrder()` server
   functions + `/api/kitchen/events` SSE route backing
   `order.paid/preparing/done` (in-process event dispatcher, no
   persistence). Depends on 3 + 4.
6. **Abandonment & expiry** — `expirePaymentAttempt()` server function +
   server-side PostHog domain-event capture
   (`payment_attempt_started/result`, `order_paid`, `order_expired`,
   `kitchen_order_started/done`). Depends on 3-5.

TDD placement (per AGENTS.md + GOAL-HUB): each spec's plan opens with a
failing colocated `bun test` against the server function/domain logic —
same in-memory-DB pattern as `src/routes/api/-health.test.ts` (mock
`#/db/client.server`, call the function directly, assert on its return
value / thrown error), not a raw HTTP fetch. Red, then implement, then
refactor.

### Coordination

The `kiosk-ui` sibling worktree consumes these server functions by name
and signature. When a spec here lands its server function's exact
signature (params, return shape, thrown error types), send it via `hub`
to `KioskUi` (or whatever its agent is named) so its matching spec can
start — don't wait for the full spec/plan cycle to finish, the signature
is enough. `Main` (the orchestrator) is standing in for the human user on
brainstorming design approvals and clarifying questions per its own
context (PRD, GOAL-HUB, references.md) — send those to `Main` via `hub`
rather than blocking on human input.

## Plan

Spec 2 (kiosk identity & claim) shipped and logged below. Spec 3
(cart & checkout core) is next.

## Log

- 2026-08-08: promoted from TODO, worktree created at
  `../backend-platform`, branch `backend-platform`.
- 2026-08-08: spec 1 (catalog schema, seed & `getMenu()`) shipped and
  green. Commits `a46dd1a` (design), `861baec` (plan), `bcf8feb`
  (implementation). `getMenu(): Promise<Menu>` (`createServerFn`, GET,
  no params) returns nested active categories → available products →
  variant/addon groups with `basePriceCents`/`priceDeltaCents` integer
  money; sent to `KioskUi` for its menu-browse spec. Full checks green.
- 2026-08-08: synced PRD.md's font decision (Inter only, no mono face)
  from the `kiosk-ui` amendment. Commit `1a5074e`, docs-only, no code
  impact on this lane.
- 2026-08-08: spec 2 (kiosk identity & claim) shipped. Commits
  `871f292` (design), `692d01c` (secure-cookie toggle amendment),
  `7d29386` (plan), `6bbf1ee` (schema/env/migration), `a6cc2f1`
  (HMAC cookie helper and `listKiosks`/`claimKiosk`), `fa328a8`
  (shared migrated test support), and `967d2ed` (coverage cleanup).
  `listKiosks(): Promise<Kiosk[]>` lists deterministic `{ id, name, prefix }`
  rows; `claimKiosk({ data: { password, kioskId?, name?, prefix? } })`
  validates the shared password, reclaims or creates a kiosk with a unique
  prefix, returns `Kiosk`, and sets the signed stateless `kiosk_session`
  HttpOnly cookie. The cookie is HMAC-SHA256 signed over `{ kioskId,
  issuedAt }`, with `KIOSK_COOKIE_SECURE` controlling the optional `Secure`
  flag (default false). Focused kiosk tests were red before implementation and
  then passed; final `bun run lint && bun run format && bun run typecheck &&
  bun run test` passed (31 tests, 0 failures).
