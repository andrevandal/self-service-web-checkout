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
- `src/lib/kiosk-session.ts` and the backend kiosk functions agree on `Kiosk`, `listKiosks`, `claimKiosk`, and all five claim error codes. Direct review also found two visibility/name gaps: the UI's `KioskClaimInput` is named `ClaimKioskInput` in the backend, and the UI's `normalizePrefix` helper is intentionally private there. The swap will use `ClaimKioskInput` and move the existing three-line format validator into `kiosk-claim-screen.tsx`; backend validation remains authoritative. The backend has no `getKioskSession` export. The new function must read and verify `kiosk_session` through `readKioskCookie(serverEnv.KIOSK_COOKIE_SECRET)`, query `kiosks` by `payload.kioskId`, and return `{ id, name, prefix }` or `null`.
- `src/lib/payment.ts` matches `order.functions.ts` and `payment.functions.ts` for all types, inputs, outputs, and error codes. The expiry contract is already aligned as `expirePaymentAttempt({ data: { attemptId } })`.
- TanStack Start's import-protection boundary was verified during the first browser build: the backend modules' exported named handlers caused server-only imports to enter the client graph once the UI imported those modules. The integration therefore keeps `*.functions.ts` files client-safe (public types, validators, and thin `createServerFn` wrappers) and moves handler bodies plus DB/cookie/PostHog dependencies into colocated `*.functions.server.ts` files. Existing colocated backend tests import handlers from the new server files directly.
- Every import swap is enumerated in `GOAL.md`: checkout screen, abandonment hook, kiosk claim screen, index route, kitchen screen, and menu screen.
- `src/lib/checkout.ts` is frontend-owned cart-to-order mapping logic, not a temporary seam. It remains, but its duplicate `CreateOrderInput`/`CreateOrderResult` declarations will be replaced with imports from `order.functions.ts`.
- Once imports are migrated, `menu.ts`, `kiosk-session.ts` plus its test, `payment.ts` plus its test, and `kitchen.ts` plus its test are dead and will be deleted.

## Implementation approach

1. Before wiring client callsites, split each backend `*.functions.ts` module at the TanStack import-protection boundary: move DB/cookie/PostHog imports and named handler bodies to colocated `*.functions.server.ts` files, keep public types/validators and thin wrappers in the importable modules, and repoint backend tests to server handlers. The exported client-facing function names and all handler contracts remain unchanged.
2. Implement `getKioskSession` in `src/lib/kiosk.functions.ts` as a named `createServerFn({ method: "GET" })`. Its server handler will call `readKioskCookie(serverEnv.KIOSK_COOKIE_SECRET)`, return `null` for a missing or invalid cookie, select the referenced kiosk row by id, and map it to the public `Kiosk` shape. It will not create a second session store or alter cookie semantics.
3. Export the existing nested catalog types, swap each callsite in the verified list to the real backend module, and move the existing prefix-format helper into the kiosk claim component while importing `ClaimKioskInput`. In `kitchen-screen.tsx`, declare the six-code local `KitchenErrorCode` union and import `KitchenOrderEvent`/`KitchenOrder` from `kitchen.functions.ts`; keep the existing SSE route and duck-typed error handling unchanged.
4. Make `checkout.ts` consume `CreateOrderInput` and `CreateOrderResult` from `order.functions.ts`, preserving its pure mapping behavior and existing tests.
5. Delete only the four now-dead seam modules and their colocated tests. Do not delete `checkout.ts` or its test, backend handlers, or the SSE route.
6. Create an ignored local `.env` containing the approved development-only values:

   ```dotenv
   KIOSK_CLAIM_PASSWORD=dev-kiosk-claim-2026
   KIOSK_COOKIE_SECRET=dev-kiosk-cookie-secret-2026-rotate
   STAFF_COOKIE_SECRET=dev-staff-cookie-secret-2026-rotate
   ```

   `POSTHOG_KEY` and `POSTHOG_HOST` remain optional. The values are intentionally non-production and must never be committed.
7. Run the focused backend tests and browser suite after each seam migration, then run the full lint, format, typecheck, unit test, and build commands. Finally migrate and seed the real database, start the built app, and drive the live customer and staff flow.

## Discovered runtime drift and decisions

The first production build exposed two integration-specific client/server boundary issues and one generated-bundle issue not present in the initial seam comparison:

- `PostHogProvider` was rendered from the root SSR tree while statically importing `@posthog/react` and `posthog-js`. It now has an SSR-safe wrapper in `provider.tsx`; the actual provider and SDK initialization live in `provider.client.tsx`, loaded only after hydration through `createClientOnlyFn`.
- `use-abandonment.ts` also statically imported `usePostHog` from `@posthog/react`, so the provider boundary alone could not keep the browser SDK out of SSR. Cart-abandonment capture now loads `analytics.client.ts` only when the client-side effect fires; cart expiry and clearing remain independent of analytics success.
- Rolldown's production SSR vendor splitting produced a circular React/CommonJS helper chunk (`__commonJSMin is not a function`) once the integrated server graph was built. Nitro's supported `inlineDynamicImports` option is enabled as `nitro({ inlineDynamicImports: true })` in `vite.config.ts`, producing one server bundle and removing the cycle. A clean build and built-server `GET /` returned HTTP 200 after this change.
- The repeatable seed script also had undocumented FK drift: deleting catalog
  rows after a real order existed failed on `order_items.product_id`. It now
  clears order-item addons/variants, payment attempts, order items, orders,
  and kiosk counters before catalog rows. Reseeding after a real paid order
  completed successfully without resetting the database file.

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
