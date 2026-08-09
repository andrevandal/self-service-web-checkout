# Backend-platform and kiosk-ui integration design

## Contents

- [Goal](#goal)
- [Verified seam findings](#verified-seam-findings)
- [Implementation approach](#implementation-approach)
- [Runtime flow and error handling](#runtime-flow-and-error-handling)
- [Validation and browser proof](#validation-and-browser-proof)
- [Self-review](#self-review)

## Goal

Wire the merged kiosk-ui screens to the merged backend-platform server functions without changing the public contracts already exercised by the frontend. Remove the temporary local server-function-shaped seams, add the one missing backend session lookup, and prove the complete customer/staff order lifecycle against a real local database.

## Verified seam findings

The investigation recorded in `GOAL.md` was performed by direct reads of every relevant implementation and callsite. The following findings are the integration contract:

- `src/lib/menu.ts` and `src/lib/catalog.functions.ts` expose field-for-field identical menu types. Direct review found that the backend's nested menu declarations were not exported even though the UI imports `MenuProduct`; the integration must add `export` to the existing `MenuAddon`/`MenuAddonGroup`/`MenuVariantOption`/`MenuVariantGroup`/`MenuProduct`/`MenuCategory` declarations before swapping the import. This is visibility-only drift with no shape or runtime change.
- `src/lib/kiosk-session.ts` and the backend kiosk functions agree on `Kiosk`, `listKiosks`, `claimKiosk`, and all five claim error codes. The backend has no `getKioskSession` export. The new function must read and verify `kiosk_session` through `readKioskCookie(serverEnv.KIOSK_COOKIE_SECRET)`, query `kiosks` by `payload.kioskId`, and return `{ id, name, prefix }` or `null`.
- `src/lib/payment.ts` matches `order.functions.ts` and `payment.functions.ts` for all types, inputs, outputs, and error codes. The expiry contract is already aligned as `expirePaymentAttempt({ data: { attemptId } })`.
- `src/lib/kitchen.ts` matches the backend handler input/output shapes for `claimStaffSession`, `listActiveOrders`, and `advanceOrder`. The backend intentionally splits staff-session and order errors; the UI must retain a local six-code union for its message map. The backend `KitchenOrderEvent` paid variant has additional top-level fields but remains structurally compatible because the UI reads only `event.order`.
- Every import swap is enumerated in `GOAL.md`: checkout screen, abandonment hook, kiosk claim screen, index route, kitchen screen, and menu screen.
- `src/lib/checkout.ts` is frontend-owned cart-to-order mapping logic, not a temporary seam. It remains, but its duplicate `CreateOrderInput`/`CreateOrderResult` declarations will be replaced with imports from `order.functions.ts`.
- Once imports are migrated, `menu.ts`, `kiosk-session.ts` plus its test, `payment.ts` plus its test, and `kitchen.ts` plus its test are dead and will be deleted.

## Implementation approach

1. Implement `getKioskSession` in `src/lib/kiosk.functions.ts` as a named `createServerFn({ method: "GET" })`. Its handler will call `readKioskCookie(serverEnv.KIOSK_COOKIE_SECRET)`, return `null` for a missing or invalid cookie, select the referenced kiosk row by id, and map it to the public `Kiosk` shape. It will not create a second session store or alter cookie semantics.
2. Export the existing nested catalog types, then swap each callsite in the verified list to the real backend module. In `kitchen-screen.tsx`, declare the six-code local `KitchenErrorCode` union and import `KitchenOrderEvent`/`KitchenOrder` from `kitchen.functions.ts`; keep the existing SSE route and duck-typed error handling unchanged.
3. Make `checkout.ts` consume `CreateOrderInput` and `CreateOrderResult` from `order.functions.ts`, preserving its pure mapping behavior and existing tests.
4. Delete only the four now-dead seam modules and their colocated tests. Do not delete `checkout.ts` or its test, backend handlers, or the SSE route.
5. Create an ignored local `.env` containing the approved development-only values:

   ```dotenv
   KIOSK_CLAIM_PASSWORD=dev-kiosk-claim-2026
   KIOSK_COOKIE_SECRET=dev-kiosk-cookie-secret-2026-rotate
   STAFF_COOKIE_SECRET=dev-staff-cookie-secret-2026-rotate
   ```

   `POSTHOG_KEY` and `POSTHOG_HOST` remain optional. The values are intentionally non-production and must never be committed.
6. Run the focused backend tests and browser suite after each seam migration, then run the full lint, format, typecheck, unit test, and build commands. Finally migrate and seed the real database, start the built app, and drive the live customer and staff flow.

## Runtime flow and error handling

Customer session lookup is request-scoped: the signed cookie is verified with the server-only kiosk secret, then the database is authoritative for the kiosk row. Invalid, missing, or stale-row cookies yield `null`, allowing the claim UI to render. Claim, order, payment, and staff errors continue to use the backend's existing typed codes; no UI assertion or error suppression is introduced.

The live checkout proof must use the real `createOrder`, `startPaymentAttempt`, `reconcilePaymentAttempt`, and `expirePaymentAttempt` server functions. The kitchen queue must consume the real `/api/kitchen/events` SSE stream, then use real `advanceOrder` transitions from `paid` to `preparing` to `done`. Separate scenarios must demonstrate idle-cart abandonment and payment-pending expiry, including the actual persisted status changes caused by `expirePaymentAttempt`.

## Validation and browser proof

Focused checks are run after each seam slice using the existing colocated backend tests and the existing frontend browser specs; no assertions are weakened or removed. The final command sequence is:

```bash
bun run lint
bun run format
bun run typecheck
bun run test
bun run build
bun run db:migrate
bun run db:seed
```

The built server is started with `bun run start` and exercised with Playwright/browser control. The proof record must include observed kiosk claim, menu browse, cart addition, payment state machine completion, order visibility in kitchen through live SSE, staff transitions, idle abandonment, and pending-payment expiry. It must identify the database/app URLs and the exact observed statuses rather than only reporting exit codes.

## Self-review

- **Coverage:** The design addresses every required seam, the missing `getKioskSession`, duplicate order types, dead-file cleanup, local environment, focused regression checks, full checks, database setup, and the live browser proof.
- **Contract consistency:** `getKioskSession` returns `Kiosk | null`; `expirePaymentAttempt` retains the already-aligned single-field input; kitchen event compatibility relies only on the UI's existing `.order` access.
- **Scope:** No new endpoint, schema, dependency, fixture, or test assertion is proposed. The existing SSE route and backend implementations remain the source of truth.
- **Security:** Secrets are local dev values in an ignored `.env`; cookie verification remains server-side and no secret is exposed to browser code.
- **Documentation:** The exact callsite list and cleanup list remain linked to `GOAL.md`; any discovered drift will be corrected in the same change per `AGENTS.md`.
