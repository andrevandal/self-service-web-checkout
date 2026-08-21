# Kiosk UI/UX polish Implementation Plan

> **For agentic workers:** Execute this plan task-by-task in this worktree. Use the real browser for every customer-visible slice, keep red/green evidence for each task, and do not start a task until its listed dependency is green. Tasks 5–8 form an explicit parallel wave after Task 4.

**Goal:** Replace the monolithic in-page kiosk journey with a persistent routed customer shell, apply every available UI/system polish item from `GOAL.md` 1–17, refactor seed relationships around natural keys, and adopt the fully researched 24-product reference catalog.

**Architecture:** A TanStack Router pathless `_kiosk` layout gates all customer routes through the existing kiosk session, owns cart/checkout/abandonment state, and mounts one `KioskShell` around an `Outlet`. Menu, search, product details, cart, and checkout become child routes backed by the existing TanStack Query/server-function contracts. Menu visuals, checkout visuals, scoped CSS/loading, and seed mechanics are disjoint parallel slices after routing stabilizes; metadata follows once route files stop moving.

**Tech Stack:** Bun, TypeScript, React 19, TanStack Start/Router/Query, Valibot-compatible search validation, Tailwind CSS 4, existing shadcn/ui Carousel/Embla, Lucide icons, Playwright, Drizzle ORM/libSQL, and SQLite.

## Global Constraints

- Treat `GOAL.md` polish items 1–17 and `docs/specs/2026-08-21-kiosk-polish-ui-design.md` as the implementation contract. Do not reinterpret or silently drop an item.
- Complete item 8's navigation foundation before tasks that attach loading, metadata, menu behavior, or checkout behavior to the new routes.
- Preserve the existing server-function boundary: customer code calls `getKioskSession`, `getMenu`, `createOrder`, `startPaymentAttempt`, `reconcilePaymentAttempt`, and `expirePaymentAttempt`; do not add raw REST fetches or change their input/output/error contracts.
- Keep `/api/kitchen/events`, `KitchenScreen`, staff-cookie behavior, kitchen query keys, and SSE event shapes unchanged.
- Use a pathless customer layout so `/`, `/search`, `/details`, `/cart`, and `/pay` share one mounted shell while `/kitchen` and API routes remain outside it.
- Do not add a global state library. Cross-route customer state lives in a typed React context owned by `KioskCustomerLayout`; full reload cart persistence remains out of scope.
- The checkout `step` search parameter mirrors the authoritative live state machine. A URL edit or direct deep link must not skip order creation, terminal execution, reconciliation, or receipt printing.
- Preserve one-tap add for products with no options. Configurable products navigate to `/details?id=` and use a page, not a drawer/overlay.
- Reuse the installed `Carousel`/Embla implementation. Keep the integration bleed fix: outer `-mx-5 w-[calc(100%+2.5rem)]`, inner left/right 20-pixel padding, no `px-5` clipping on the outer carousel.
- Product card media is exactly 280 by 280 CSS pixels at every breakpoint. Carousel item/card basis is 280 pixels; horizontal overflow is expected.
- Keep all customer actions at least 48 CSS pixels, visible keyboard focus, sentence-case copy, warm-paper/forest-green tokens, Inter, no emoji, and no inaccessible nested interactive controls.
- Confetti is deterministic, decorative, CSS-driven, and disabled by `prefers-reduced-motion`; do not add a confetti dependency or use random values during SSR/hydration.
- Scope scrollbar and `user-select: none` rules beneath `[data-kiosk-customer]`. Kiosk setup and `/kitchen` must remain selectable and their inputs usable.
- Do not hand-edit `src/routeTree.gen.ts`. Run `bun run generate-routes` after route file changes and commit the generated result with those changes.
- Frontend-visible tasks start with failing `e2e/browser/*.spec.ts` assertions against the real built app. Add colocated `bun test` only for pure logic; seed work uses `scripts/seed.test.ts` with the existing in-memory database pattern.
- The complete 24-product reference payload is now resolved (researched, `curl`-verified images) and embedded in Task 9. Implement the natural-key seed mechanism with current data in Task 8, then run Task 9 to adopt the full catalog. Do not alter the researched payload's names, prices, or images beyond fixing a demonstrated defect.
- Track B backend logging may run concurrently with Track A. Track B's kiosk-claim-screen and kitchen-screen logging tasks (Track B Tasks 7 and 10) also have no Track A dependency — Track A never touches `kiosk-claim-screen.tsx` or `kitchen-screen.tsx` — so they may run in Track B's backend wave. Only Track B's menu-screen instrumentation (Track B Task 8) and checkout-screen/`use-abandonment` instrumentation (Track B Task 9) must wait until Task 11 of this plan completes, because Task 11 is where dead local state, stale exports, and route generation finally settle; earlier instrumentation would target call sites Task 11 then deletes or moves. Track A adds no env field, so Track B owns its `src/env.ts` edits.
- After all available slices, update `docs/PRD.md`, `README.md` if route onboarding changes, and `CHANGELOG.md` in the same implementation change. Keep the design and plan current if implementation reveals drift.
- Run final repository checks once after integration, not independently in parallel agents. Do not weaken assertions, shorten production behavior only for tests, or bypass hooks.

## Sequencing note

Tasks 1–4 are one sequential dependency chain: red navigation contract → persistent layout/cart route → search/details routes → payment route/state projection. After Task 4 is green, Tasks 5, 6, 7, and 8 are safe to dispatch concurrently because their write sets are disjoint:

- Task 5: `menu-screen.tsx`, `product-card.tsx`, and menu/shell browser assertions.
- Task 6: `checkout-screen.tsx`, payment-confetti files, and checkout browser assertions.
- Task 7: `_kiosk.index.tsx`, `menu-skeleton.tsx`, `styles.css`, and global-polish browser assertions.
- Task 8: `scripts/seed.ts` and `scripts/seed.test.ts`.

Task 9 depends only on Task 8 landing; its payload is now embedded in this plan and no longer blocked. Task 10 waits for Tasks 5–8 because it edits route files for metadata. Task 11 integrates and records proof. If agents do not have isolated branches/worktrees, run the same tasks serially in numeric order rather than allowing concurrent writes.

---

### Task 1: Lock the routed kiosk contract with a failing browser spec

**Files:**
- Create: `e2e/browser/kiosk-navigation.spec.ts`
- Modify: `e2e/browser/home.spec.ts`
- Modify: `e2e/browser/menu-cart.spec.ts`
- Modify: `e2e/browser/checkout-payment.spec.ts`
- Modify: `e2e/browser/design-system-shell.spec.ts`

**Interfaces:**
- Consumes: current real claim helper, menu/cart controls, checkout flow, TanStack browser history, and `[data-testid="kiosk-shell"]`/`[data-testid="kiosk-bottom-bar"]`.
- Produces: red executable contracts for `/search?q=`, `/details?id=`, `/cart`, `/pay?step=`, persistent shell identity, browser Back, branded not-found, and removal of drawer/Menu-heading assumptions.

- [ ] **Step 1: Write route and shell-persistence tests before source changes.**

In `kiosk-navigation.spec.ts`, use `claimFixtureKiosk(page)` and define separate tests with these exact observable contracts:

1. `keeps the customer shell mounted across menu search details cart and pay`: save `document.querySelector('[data-testid="kiosk-shell"]')` and bottom bar nodes on `window` after claim; navigate through visible controls; after each navigation assert the saved node is strictly equal to the current node, the URL is correct, and subtotal/item count persist.
2. `uses typed search and product detail URLs`: activate Search, expect `/search?q=`, fill `Latte`, expect `q=Latte` via replace navigation, select the Latte result, expect `/details?id=<non-empty id>`, choose required Whole Milk, add, and observe cart subtotal without a dialog.
3. `uses cart and payment URLs without trusting edited payment steps`: add Espresso, open order details at `/cart`, select Pay at `/pay?step=choosing_method`, then edit the URL to `/pay?step=confirmed`. Because an edited URL is a full page load (`page.goto`) that remounts `KioskCustomerLayout` and full-reload cart persistence is out of scope, `checkoutCart` is null: expect a replace-navigation to `/` with an empty cart and no confirmation UI, order number, or success copy anywhere on the page. Do not expect the live choosing-method screen to survive the reload.
4. `renders the branded root not found component`: visit `/missing-kiosk-page`, expect heading `Page not found`, copy containing `Warm & Melted`, a touch-sized `Back to menu` link, and no browser console warning containing TanStack's generic not-found fallback.
5. `preserves cart with browser back`: add one item, navigate menu → search → details, call `page.goBack()` twice, and assert both restored URLs and the unchanged footer subtotal.

Do not assert internal component names, React state, generated route IDs, or network request payloads.

- [ ] **Step 2: Update existing specs to describe the intended routed UI.**

Remove assertions for the `Menu` heading and customization `dialog`. Replace them with named search/category/product/detail/cart-route assertions. In checkout expectations, assert `/pay?step=choosing_method` after Pay and `/` after completion. Keep all existing cart totals, payment result, fixed-shell geometry, Inter, and primary-color assertions.

- [ ] **Step 3: Run the new browser contract and record the expected red state.**

Run:

```bash
bun scripts/reset-db.ts
bun run db:migrate
bun run db:seed
bun run build:e2e:core
PW_PROJECT=core bunx playwright test e2e/browser/kiosk-navigation.spec.ts
```

Expected: FAIL because `/search`, `/details`, `/cart`, `/pay`, and the branded root not-found component do not exist and the current shell is replaced by local branches. Record failing test names and first relevant assertion; do not commit a knowingly red standalone test slice.

---

### Task 2: Build the persistent customer layout, cart route, and not-found boundary

**Files:**
- Create: `src/components/kiosk-customer-layout.tsx`
- Create: `src/components/cart-screen.tsx`
- Create: `src/routes/_kiosk.tsx`
- Create: `src/routes/_kiosk.index.tsx`
- Create: `src/routes/_kiosk.cart.tsx`
- Modify: `src/components/kiosk-shell.tsx`
- Modify: `src/components/menu-screen.tsx`
- Modify: `src/routes/__root.tsx`
- Delete: `src/routes/index.tsx`
- Regenerate: `src/routeTree.gen.ts`
- Test: `e2e/browser/kiosk-navigation.spec.ts`, `e2e/browser/design-system-shell.spec.ts`, `e2e/browser/kiosk-claim.spec.ts`
- Commit only (edited in Task 1, not touched here): `e2e/browser/home.spec.ts`, `e2e/browser/menu-cart.spec.ts`, `e2e/browser/checkout-payment.spec.ts`

**Interfaces:**
- Consumes: `getKioskSession(): Promise<Kiosk | null>`, `cartReducer`, `subtotalCents`, `useAbandonment`, `KioskShell`, `KioskClaimScreen`, `AbandonmentDialog`, and TanStack `Outlet`/navigation.
- Produces: `KioskCustomerLayout({ kioskId }: { kioskId: string })`, `useKioskFlow(): KioskFlowContextValue`, persistent `KioskShell`, `/`, `/cart`, root `notFoundComponent`, and the following shared state contract:

```ts
type KioskFlowContextValue = {
  kioskId: string;
  cart: CartState;
  checkoutCart: CartState | null;
  payment: PaymentContext | null;
  contentRef: RefObject<HTMLElement | null>;
  addCartLine: (item: CartLineInput) => void;
  removeCartLine: (lineId: string) => void;
  beginCheckout: () => void;
  updatePayment: (next: PaymentContext) => void;
  cancelCheckout: () => void;
  completeCheckout: () => void;
};
```

- [ ] **Step 1: Move the kiosk-session gate into a pathless route.**

Create `_kiosk.tsx` with `createFileRoute('/_kiosk')`, loader `() => getKioskSession()`, and the existing `['kiosk-session']` query initialized from loader data. Render `KioskClaimScreen` when the query has no session. Render `<KioskCustomerLayout kioskId={session.id} />` for a valid session. Do not redirect unclaimed tablets to a second setup URL and do not change claim cookies or `window.location.reload()` behavior.

- [ ] **Step 2: Create the persistent flow provider and shell.**

In `kiosk-customer-layout.tsx`, own `useReducer(cartReducer, [])`, `checkoutCart`, `payment`, `useAbandonment`, and a content-element ref. Render exactly one customer root marked `data-kiosk-customer`, one `KioskShell`, one `<Outlet />`, and one `AbandonmentDialog`. Keep pointer interaction reset above the outlet. Implement lifecycle semantics exactly:

- `beginCheckout`: snapshot current cart into `checkoutCart` and initialize payment to `{ phase: 'choosing_method', orderId: null, attemptId: null }`.
- `cancelCheckout`: clear only checkout snapshot/payment; keep cart.
- `completeCheckout`: reset cart and clear checkout/payment.
- idle cart expiry: clear cart and checkout.
- idle pending-payment expiry: retain the existing `expirePaymentAttempt({ data: { attemptId } })` path before cancellation/clear.

Use `useMemo` for the context value and stable callbacks so route screens do not rerender from avoidable provider identity churn.

- [ ] **Step 3: Keep one shell and expose its scroll element.**

Add `contentRef?: Ref<HTMLElement>` to `KioskShellProps`, attach it to the existing `<main data-testid="kiosk-content">`, and remove `border-b border-border` from its header. Keep fixed-height, overflow, footer border, safe-area padding, test IDs, and layout tokens unchanged.

The customer layout supplies the brand header and one bottom bar. Bottom-bar order-details action navigates to `/cart` and changes to `Hide order details` on `/cart`; Pay calls `beginCheckout()` then navigates to `/pay` with `{ step: 'choosing_method' }`. Both remain disabled for an empty cart. Use TanStack navigation, not `window.location`.

- [ ] **Step 4: Extract the cart branch into `/cart`.**

Move the current cart markup and remove-line behavior from `MenuScreen` into `CartScreen`, consuming `useKioskFlow()`. `_kiosk.cart.tsx` renders `CartScreen`. `MenuScreen` becomes outlet content only: remove its `KioskShell`, cart-open, checkout, abandonment, cart reducer, and kioskId ownership. Keep its current menu query/error/empty behavior temporarily; later tasks refine it.

Replace `src/routes/index.tsx` with `_kiosk.index.tsx`, which renders the reduced `MenuScreen` under `_kiosk`. Delete the old route file; do not leave an alias or duplicate `/` route.

- [ ] **Step 5: Add the root branded not-found boundary.**

Add `notFoundComponent` to `createRootRouteWithContext` in `src/routes/__root.tsx`. Render a centered `Page not found` heading, calm explanatory copy, and a minimum-48-pixel TanStack `Link` to `/` labeled `Back to menu`. Do not mount the customer shell for unknown root URLs and do not suppress console warnings manually.

- [ ] **Step 6: Generate routes and run the focused green subset.**

Run:

```bash
bun run generate-routes
bun run typecheck
bun run build:e2e:core
PW_PROJECT=core bunx playwright test e2e/browser/kiosk-navigation.spec.ts --grep "keeps the customer shell|cart|not found"
PW_PROJECT=core bunx playwright test e2e/browser/design-system-shell.spec.ts e2e/browser/kiosk-claim.spec.ts
```

Expected: shell/cart/not-found cases PASS; search/details/pay cases may remain red until Tasks 3–4. Claim persistence and fixed shell assertions PASS.

- [ ] **Step 7: Commit the navigation foundation.**

This commit also lands every spec Task 1 rewrote, including `e2e/browser/checkout-payment.spec.ts`, so no Task 1 edit stays uncommitted while Tasks 3–8 write in parallel.

```bash
git add src/components/kiosk-customer-layout.tsx src/components/cart-screen.tsx src/components/kiosk-shell.tsx src/components/menu-screen.tsx src/routes/_kiosk.tsx src/routes/_kiosk.index.tsx src/routes/_kiosk.cart.tsx src/routes/__root.tsx src/routes/index.tsx src/routeTree.gen.ts e2e/browser/kiosk-navigation.spec.ts e2e/browser/home.spec.ts e2e/browser/menu-cart.spec.ts e2e/browser/checkout-payment.spec.ts e2e/browser/design-system-shell.spec.ts
git commit -m "feat(kiosk): add persistent customer route layout"
```

---

### Task 3: Add shared menu data, search, and routed product details

**Files:**
- Create: `src/lib/menu-query.ts`
- Create: `src/components/product-card.tsx`
- Create: `src/components/search-screen.tsx`
- Create: `src/components/product-details-screen.tsx`
- Create: `src/routes/_kiosk.search.tsx`
- Create: `src/routes/_kiosk.details.tsx`
- Modify: `src/routes/_kiosk.index.tsx`
- Modify: `src/components/menu-screen.tsx`
- Delete: `src/components/customization-drawer.tsx`
- Regenerate: `src/routeTree.gen.ts`
- Test: `e2e/browser/kiosk-navigation.spec.ts`, `e2e/browser/menu-cart.spec.ts`

**Interfaces:**
- Consumes: `getMenu`, `Menu`, `MenuCategory`, `MenuProduct`, `CartLineInput`, `useKioskFlow().addCartLine`, route search/navigation, and `Route.useLoaderData()` for details.
- Produces: `menuQueryOptions`, `ProductCard`, `SearchScreen`, `ProductDetailsScreen`, `/search?q=`, `/details?id=`, shared query key `['menu']`, and no remaining drawer overlay.

```ts
export const menuQueryOptions = queryOptions({
  queryKey: ["menu"],
  queryFn: () => getMenu(),
});

type ProductCardProps = {
  product: MenuProduct;
  onActivate: (product: MenuProduct) => void;
};
```

- [ ] **Step 1: Centralize menu query options and route-level pending/error ownership.**

Create `menu-query.ts` with the exact `['menu']` key and `getMenu()` query. In `_kiosk.index.tsx`, call `useQuery(menuQueryOptions)`. Keep the current text loading state, retry state, and empty-catalog state here for now; pass resolved categories into `MenuScreen`. This separation ensures Task 7 can replace loading UI without touching Task 5's menu visual work.

- [ ] **Step 2: Create reusable product activation without nested controls.**

Move product card rendering into `ProductCard`. Keep one semantic `<button>` per card and its complete accessible name. Its activation callback is supplied by each screen. For products without options, menu/search callbacks call `addCartLine` with empty variants/add-ons. For configurable products, callbacks navigate to `/details` with `{ id: product.id }`. Do not place another `<button>` or `<a>` inside the card button.

- [ ] **Step 3: Implement `/search?q=` as URL-owned search.**

Create `_kiosk.search.tsx` with `validateSearch` that returns `{ q: string }`, defaulting non-strings to `''`. `SearchScreen` reads `Route.useSearch()`, renders a named search input, and replace-navigates on each edit so Back does not replay every keystroke. Match the current case-insensitive product name, description, and category name logic. Render current no-results copy and a clear action that writes `q: ''`. Use `menuQueryOptions`; do not create another search cache or server endpoint.

The menu's centered search control navigates to `/search?q=` on activation instead of filtering locally.

- [ ] **Step 4: Replace the customization drawer with `/details?id=`.**

Create `_kiosk.details.tsx` with:

- search validation to `{ id: string }`, default `''`;
- `loaderDeps` keyed by id;
- a loader that calls `context.queryClient.ensureQueryData(menuQueryOptions)`, finds the product once, and throws `notFound()` for missing/unknown id;
- `ProductDetailsScreen` using the existing variant/add-on validation and `CartLineInput` mapping from `CustomizationDrawer`.

Render details as normal shell content, not `fixed`, `aria-modal`, `role="dialog"`, or an overlay. Include a real heading, 280-pixel product image when available, price, option fieldsets, Add to order, and Back. After add, call `addCartLine` and navigate back when browser history is available, otherwise replace to `/`. Delete `customization-drawer.tsx` after all imports disappear.

- [ ] **Step 5: Generate routes and prove search/details green.**

Run:

```bash
bun run generate-routes
bun run typecheck
bun run build:e2e:core
PW_PROJECT=core bunx playwright test e2e/browser/kiosk-navigation.spec.ts --grep "typed search|product detail|browser back"
PW_PROJECT=core bunx playwright test e2e/browser/menu-cart.spec.ts
```

Expected: `/search?q=` and `/details?id=` tests PASS; no customization dialog exists; cart additions/totals remain correct.

- [ ] **Step 6: Commit routed discovery/details.**

```bash
git add src/lib/menu-query.ts src/components/product-card.tsx src/components/search-screen.tsx src/components/product-details-screen.tsx src/components/menu-screen.tsx src/components/customization-drawer.tsx src/routes/_kiosk.index.tsx src/routes/_kiosk.search.tsx src/routes/_kiosk.details.tsx src/routeTree.gen.ts e2e/browser/kiosk-navigation.spec.ts e2e/browser/menu-cart.spec.ts
git commit -m "feat(kiosk): route search and product details"
```

---

### Task 4: Route checkout and project its live phase into the URL

**Files:**
- Create: `src/routes/_kiosk.pay.tsx`
- Modify: `src/components/kiosk-customer-layout.tsx`
- Modify: `src/components/checkout-screen.tsx`
- Modify: `src/lib/use-abandonment.ts`
- Modify: `e2e/browser/kiosk-navigation.spec.ts`
- Modify: `e2e/browser/checkout-payment.spec.ts`
- Modify: `e2e/browser/abandonment-ux.spec.ts`
- Modify: `e2e/browser/kiosk-claim-helpers.ts`
- Regenerate: `src/routeTree.gen.ts`

**Interfaces:**
- Consumes: `checkoutCart`, `beginCheckout`, `updatePayment`, `cancelCheckout`, `completeCheckout`, existing `CheckoutScreenProps`, `CheckoutPhase`, real order/payment server functions, and `PaymentContext` abandonment behavior.
- Produces: `/pay?step=<CheckoutPhase>`, guarded empty/direct-entry behavior, URL projection through replace navigation, persistent bottom bar, and unchanged real payment workflow.

- [ ] **Step 1: Export one phase vocabulary and validate route search against it.**

In `checkout-screen.tsx`, export a readonly phase tuple and derive the union from it:

```ts
export const CHECKOUT_PHASES = [
  "choosing_method",
  "creating_order",
  "starting_attempt",
  "taking_payment",
  "reconciling",
  "failed",
  "confirmed",
] as const;
export type CheckoutPhase = (typeof CHECKOUT_PHASES)[number];
```

`_kiosk.pay.tsx` validates `step`; unknown/non-string values become `choosing_method`. Do not duplicate a second phase union in the route or abandonment hook; import `CheckoutPhase` for type positions.

- [ ] **Step 2: Render checkout under the persistent shell.**

Remove full-viewport ownership from `CheckoutScreen` (`h-dvh min-h-dvh` and top-level shell assumptions); render its phase content inside the outlet scroll area. The route reads `checkoutCart` from `useKioskFlow()`. If absent or empty, render TanStack `<Navigate to="/" replace />` — this is also the observable behavior for any full reload of `/pay?step=<anything>`, including an edited `step=confirmed`, because the checkout snapshot lives only in layout memory. Pass the snapshot and lifecycle callbacks into `CheckoutScreen`.

The layout's Pay button must call `beginCheckout()` before navigating. Cancel calls `cancelCheckout()` then replace-navigates `/`. Success calls `completeCheckout()` then replace-navigates `/` only when `CheckoutScreen` invokes `onComplete`.

- [ ] **Step 3: Make payment phase update the URL without trusting it.**

Keep `CheckoutScreen`'s internal `phase` as the authority. On each existing `onPaymentStateChange` callback, update layout payment context and replace-navigate the pay route search to that phase. When the route mounts with a live `checkoutCart` but a non-`choosing_method` `step`, correct the URL to the actual internal phase; when there is no `checkoutCart` the Step 2 redirect wins and no phase correction happens. Never initialize `order`, `attemptId`, `orderNumber`, or visual success from `search.step`.

Update `use-abandonment.ts` to import the shared phase type if needed, but keep pending expiry and callback ordering unchanged.

- [ ] **Step 4: Update helpers and browser expectations for route phases.**

`payWithMethod` enters payment through the visible bottom-bar Pay button and choosing-method screen. In browser tests, assert the URL at choosing, at least one busy phase, confirmed, and final `/`. Keep real terminal/payment assertions and the abandonment test that expires a pending attempt.

- [ ] **Step 5: Generate routes and run full navigation/payment green.**

Run:

```bash
bun run generate-routes
bun run typecheck
bun run build:e2e:core
PW_PROJECT=core bunx playwright test e2e/browser/kiosk-navigation.spec.ts e2e/browser/checkout-payment.spec.ts
bun run build:e2e:abandonment
PW_PROJECT=abandonment bunx playwright test e2e/browser/abandonment-ux.spec.ts
```

Expected: all navigation and checkout route tests PASS; a full-reload `/pay?step=confirmed` lands on an empty `/` because `checkoutCart` is null, never on confirmation; abandonment still returns to empty `/` after real expiry.

- [ ] **Step 6: Commit the completed navigation architecture.**

```bash
git add src/routes/_kiosk.pay.tsx src/routeTree.gen.ts src/components/kiosk-customer-layout.tsx src/components/checkout-screen.tsx src/lib/use-abandonment.ts e2e/browser/kiosk-navigation.spec.ts e2e/browser/checkout-payment.spec.ts e2e/browser/abandonment-ux.spec.ts e2e/browser/kiosk-claim-helpers.ts
git commit -m "feat(checkout): route live payment phases"
```

---

### Task 5: Apply menu header, scrollspy, card, image, and carousel polish

**Files:**
- Modify: `src/components/menu-screen.tsx`
- Modify: `src/components/product-card.tsx`
- Modify: `e2e/browser/menu-cart.spec.ts`
- Modify: `e2e/browser/design-system-shell.spec.ts`

**Interfaces:**
- Consumes: Task 3's resolved categories and `ProductCard`, `useKioskFlow().contentRef`, installed `Carousel`/`CarouselApi`, existing category IDs/headings, and route navigation.
- Produces: backlog items 1–7: centered search, sticky scrollspy pills, no customer header rule, circular plus treatment, 280-by-280 images, and one horizontal carousel row per category.

- [ ] **Step 1: Add failing real-screen menu polish assertions.**

Before source edits, assert:

- no heading named `Menu` and no `Tap an item to customize and add.` text;
- search control centered and category row remains at the same viewport y-position after content scrolling;
- first pill has `aria-current="true"`, then scrolling to two later category headings changes `aria-current` to each category;
- a product image and card each have a 280-by-280 media box at default and a narrow 390-pixel viewport;
- category product containers have `aria-roledescription="carousel"` and stay one row;
- product button exposes the intended add/customize accessible name and its bottom-right plus visual has a circular 48-by-48 box;
- kiosk header has computed bottom border width `0px` while footer border remains.

Run the focused specs and record red failures before changing source.

- [ ] **Step 2: Remove title/subtitle and make category status sticky.**

Render only the centered search activation control and category pills in menu controls. Place the pill carousel in `sticky top-0 z-20 bg-background` within the real shell content; preserve enough vertical padding for focus rings. Search itself scrolls normally; pills remain visible.

Initialize active category to the first non-empty category. Attach one passive scroll listener to `contentRef.current`; batch offset reads with `requestAnimationFrame`; select the last section whose top is at or above the sticky activation line. Clean up listener and pending frame. On active change, call `CarouselApi.scrollTo(categoryIndex)` and set the pill's selected forest-green styling plus `aria-current="true"`. Category click uses the same sticky offset and smooth scrolling.

- [ ] **Step 3: Convert category grids to one-row carousels.**

For each category section, render:

```tsx
<Carousel className="-mx-5 w-[calc(100%+2.5rem)]" opts={{ align: "start", dragFree: true }}>
  <CarouselContent className="-ml-4 pl-5 pr-5">
    <CarouselItem className="basis-[280px] pl-4">...</CarouselItem>
  </CarouselContent>
</Carousel>
```

Do not add breakpoint grid classes, wrap rows, or outer `px-5`. Keep section heading and accessible carousel/category labels.

- [ ] **Step 4: Make product media and CTA concrete.**

In `ProductCard`, set card width/basis to 280 pixels and image wrapper to `size-[280px] shrink-0`. Keep `object-cover`, alt behavior, content, price, shadow, focus, and active feedback. Replace CTA text with a bottom-right `span` inside the card button styled as a 48-by-48 circular forest-green control containing Lucide `Plus` with `aria-hidden`. The outer button's accessible label states `Add <name>, <price>` for no-option products or `Customize <name>, <price>` for configurable products. Do not nest an icon button.

- [ ] **Step 5: Run menu and shell browser proof.**

Run:

```bash
bun run build:e2e:core
PW_PROJECT=core bunx playwright test e2e/browser/menu-cart.spec.ts e2e/browser/design-system-shell.spec.ts
```

Expected: all menu items 1–7 and prior cart/design-token behavior PASS at both tested viewport widths.

- [ ] **Step 6: Commit menu polish.**

```bash
git add src/components/menu-screen.tsx src/components/product-card.tsx e2e/browser/menu-cart.spec.ts e2e/browser/design-system-shell.spec.ts
git commit -m "feat(menu): polish category browsing"
```

---

### Task 6: Differentiate Cancel and add payment celebration/countdown

**Files:**
- Create: `src/components/payment-confetti.tsx`
- Create: `src/components/payment-confetti.css`
- Modify: `src/components/checkout-screen.tsx`
- Modify: `e2e/browser/checkout-payment.spec.ts`

**Interfaces:**
- Consumes: Task 4's routed `CheckoutScreen`, existing 2-second completion behavior, `onComplete`, warm/forest/amber CSS variables, and `prefers-reduced-motion`.
- Produces: low-emphasis choosing-method Cancel, deterministic decorative confetti, visible `Returning to menu in 2 seconds` countdown, and one `onComplete` call at zero.

- [ ] **Step 1: Add failing checkout visual/behavior assertions.**

Assert choosing-method Cancel has computed `border-top-width: 0px`, no primary background, muted foreground, and a minimum 48-pixel target while Debit remains outlined. On confirmation, assert a `data-testid="payment-confetti"` decorative region, text matching `Returning to menu in 2 seconds`, then `1 second`, then automatic `/` navigation. Under `page.emulateMedia({ reducedMotion: 'reduce' })`, assert confetti elements have no running animation while confirmation/countdown still work.

- [ ] **Step 2: Implement deterministic reduced-motion-safe confetti.**

`PaymentConfetti` renders a module-level fixed array of particle descriptors (stable id, x position, delay, duration, rotation, token color), not `Math.random()`. Render `aria-hidden="true"`, `data-testid="payment-confetti"`, and no text. Import `payment-confetti.css` from the component. CSS positions particles over confirmation, animates transform/opacity, uses existing green/amber/red tokens, applies `pointer-events: none`, and disables animation in `@media (prefers-reduced-motion: reduce)`.

- [ ] **Step 3: Add visible countdown with one timer lifecycle.**

Set `CONFIRMATION_SECONDS = 2`. On entering confirmed, set remaining seconds to 2, decrement once per second, and call `onComplete` exactly once when it reaches zero. Clear interval/timeout on unmount or phase change. Render polite copy with singular/plural grammar. Do not restart the timer because `onComplete` identity changes; keep callback access in a ref or require a stable parent callback.

- [ ] **Step 4: Lower only choosing-method Cancel emphasis.**

Remove border/outlined treatment from the choosing-method Cancel and use muted text with a subtle secondary hover/focus background. Leave Credit primary, Debit outlined, failure Retry primary, and failure Cancel semantics unchanged unless a failing accessibility assertion requires the same touch/focus baseline.

- [ ] **Step 5: Run checkout browser proof.**

Run:

```bash
bun run build:e2e:core
PW_PROJECT=core bunx playwright test e2e/browser/checkout-payment.spec.ts
```

Expected: both credit/debit flows PASS, countdown is observed at 2 and 1, completion resets at `/`, and reduced-motion mode has no confetti animation.

- [ ] **Step 6: Commit checkout polish.**

```bash
git add src/components/payment-confetti.tsx src/components/payment-confetti.css src/components/checkout-screen.tsx e2e/browser/checkout-payment.spec.ts
git commit -m "feat(checkout): clarify payment completion"
```

---

### Task 7: Add menu skeleton and customer-scoped system CSS

**Files:**
- Create: `src/components/menu-skeleton.tsx`
- Create: `e2e/browser/kiosk-global-polish.spec.ts`
- Modify: `src/routes/_kiosk.index.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: Task 3's route-owned menu pending state, Task 2's `[data-kiosk-customer]` and content test id, requested 280-pixel card geometry, and unchanged staff/setup routes.
- Produces: first-load menu skeleton, CSS-only customer scrollbar, customer-only `user-select: none`, and explicit staff/setup exclusion proof.

- [ ] **Step 1: Add failing browser assertions for loading and CSS scope.**

Create tests that hold the first client menu server-function fetch, observe `data-testid="menu-skeleton"` and multiple 280-pixel skeleton cards, release the request, and observe real menu content. Keep a separate failed-request test that proves Retry remains visible. Assert customer content has computed `user-select: none`; clear cookies and prove setup form input selection/focus works; open `/kitchen` and prove computed `user-select` is not `none`. Inspect customer content scrollbar properties and pseudo-element styling in Chromium.

When intercepting, claim the fixture before installing the route and reload afterward so kiosk claim/server-function requests are not blocked. Gate only the menu fetch; continue every unrelated request.

- [ ] **Step 2: Replace only the first menu pending presentation.**

Create `MenuSkeleton` with one centered search placeholder, category pill placeholders, and at least four card placeholders using 280-by-280 image blocks plus text/price lines. Use `animate-pulse`, existing background/card/muted tokens, stable keys, `aria-hidden="true"`, and `data-testid="menu-skeleton"`. In `_kiosk.index.tsx`, pair it with one visually hidden or concise `aria-live="polite"` loading label. Do not render skeletons for errors, empty catalogs, or empty search results.

- [ ] **Step 3: Add CSS-only scrollbar under the customer scope.**

In `styles.css`, target `[data-kiosk-customer] [data-testid="kiosk-content"]` with Firefox `scrollbar-width`/`scrollbar-color` and Chromium/WebKit `::-webkit-scrollbar`, track, and thumb rules. Use an unobtrusive 10-pixel track, transparent/paper track, forest thumb with rounded corners, and a darker hover thumb. Do not style `html`, `body`, kitchen, or setup scroll containers globally.

- [ ] **Step 4: Add structurally scoped text-selection prevention.**

Apply `user-select: none` only beneath `[data-kiosk-customer]`. Do not add `.kitchen` exceptions or route-name selectors; staff/setup exclusion comes from layout structure. Preserve pointer events, keyboard selection in native controls where the browser requires it, focus rings, and accessibility tree text.

- [ ] **Step 5: Run global-polish browser proof.**

Run:

```bash
bun run build:e2e:core
PW_PROJECT=core bunx playwright test e2e/browser/kiosk-global-polish.spec.ts
```

Expected: skeleton, released real menu, Retry, custom scrollbar, customer non-selection, and staff/setup selectability assertions PASS.

- [ ] **Step 6: Commit scoped global polish.**

```bash
git add src/components/menu-skeleton.tsx src/routes/_kiosk.index.tsx src/styles.css e2e/browser/kiosk-global-polish.spec.ts
git commit -m "feat(kiosk): add scoped loading and system polish"
```

---

### Task 8: Refactor seed relationships around natural keys and returned IDs

**Files:**
- Modify: `scripts/seed.test.ts`
- Modify: `scripts/seed.ts`
- Test: `src/lib/catalog.functions.test.ts`

**Interfaces:**
- Consumes: current catalog content, `randomUUID`, Drizzle transaction/`.returning()`, catalog schema natural keys, current dependent-row deletion order, and `loadMenu` relationship assembly.
- Produces: seed definitions with no IDs/foreign-key IDs, parent insert maps based on returned IDs, repeatable atomic seeding, and current counts until Task 9 supplies the expanded 24-product data.

- [ ] **Step 1: Write failing in-memory relationship tests.**

Extend `scripts/seed.test.ts` before implementation to assert:

- two consecutive `seed(url)` calls return current `{ categories: 4, products: 7 }` and preserve existing table counts;
- exported seed-definition data, if exported for testing, contains natural-key references (`categorySlug`, `productSlug`, `variantGroupSlug`, `addonGroupSlug`) and no `id`, `categoryId`, `productId`, `variantGroupId`, or `addonGroupId` fields — this assertion covers only the six catalog tiers (categories, products, variant groups, variant options, add-on groups, add-ons);
- `kiosksSeed` is explicitly out of scope for that assertion: it keeps its stable hardcoded `id: "front-counter"` (`scripts/seed.ts:20`) because `e2e/browser/kiosk-claim-helpers.ts:15` claims the kiosk through the `Claim Front counter` control that every browser spec depends on. Assert that this row is unchanged rather than excluding it silently;
- Latte resolves to Coffee & Espresso and has its milk group/options and add-on group/items after seeding;
- every child FK joins to the parent identified by its natural-key tuple;
- an intentionally unresolved natural key rejects and rolls back rather than inserting partial rows.

Use `createTestDatabase`/in-memory or isolated temp-file style already present. Do not mock Drizzle return values or assert source text.

Run `bun test scripts/seed.test.ts`; expect the no-fixed-ID and unresolved-key cases to FAIL against the current parallel arrays.

- [ ] **Step 2: Replace parallel UUID arrays with relationship definitions.**

Define seed types that carry only seed-relevant scalar fields plus natural-key parent references. Generate `randomUUID()` only while forming database insert values. The pre-existing `kiosks` insert stays exactly as it is — `kiosksSeed` keeps its hardcoded `front-counter` id and its `onConflictDoNothing()` call, and is not a tier here. Insert the six catalog tiers inside the existing transaction:

1. categories → return `{ id, slug }` → `categoryIdBySlug`;
2. products resolved by `categorySlug` → return `{ id, slug }` → `productIdBySlug`;
3. variant groups resolved by `productSlug` → return enough keys to map `productSlug/groupSlug`;
4. variant options resolved through that tuple;
5. add-on groups resolved by `productSlug` → return enough keys to map `productSlug/groupSlug`;
6. add-ons resolved through that tuple.

`variant_groups` and `addon_groups` have no `product_slug` column — they carry only `product_id` (`src/db/schema.ts:46-54,76-84`) — so `.returning()` cannot yield a product slug directly. Build an inverse `productSlugById` map from tier 2's returned `{ id, slug }` rows, then use it to translate each returned group's `productId` back to `productSlug` before keying the tier-3/tier-5 `productSlug/groupSlug` maps that tiers 4 and 6 consume. Do not add a `product_slug` column or a schema migration.

Use a shared small `requireNaturalKey(map, key, relation)` helper that throws `Missing <relation> natural key: <key>`. Do not introduce an ORM repository layer or schema migration.

- [ ] **Step 3: Preserve cleanup order and current catalog content.**

Keep transaction boundaries and the current deletion order for order snapshots, attempts, products, kiosks, and categories. Keep every current product/price/description/image/option unchanged in this task, and keep `kiosksSeed` exactly as it is today, including its `onConflictDoNothing()` insert and hardcoded `front-counter` id. Return counts from inserted definitions, not hard-coded numbers. `main()` keeps the existing count log contract, so `scripts/seed.test.ts:51`'s `Seeded 4 categories and 7 products` assertion still passes in this task.

- [ ] **Step 4: Run seed and catalog regressions.**

Run:

```bash
bun test scripts/seed.test.ts src/lib/catalog.functions.test.ts
bun scripts/reset-db.ts
bun run db:migrate
bun run db:seed
bun run db:seed
```

Expected: unit tests PASS, both real seed runs succeed, output reports 4 categories/7 products, and current nested menu relationships remain loadable.

- [ ] **Step 5: Commit the seed mechanism independently from catalog expansion.**

```bash
git add scripts/seed.ts scripts/seed.test.ts
git commit -m "refactor(seed): resolve catalog relationships by slug"
```

---

### Task 9: Adopt the researched reference catalog

**Files:**
- Modify: `scripts/seed.test.ts`
- Modify: `scripts/seed.ts`
- Test: `src/lib/catalog.functions.test.ts`
- Test: `e2e/browser/menu-cart.spec.ts`

**Interfaces:**
- Consumes: Task 8's natural-key seed definition format plus the researched 17-product payload embedded in Step 1 below (source: web-researched, `curl`-verified in this planning session; not supplied by an external stakeholder — record this provenance in the implementation handoff).
- Produces: full catalog, 24 products, complete relationship assertions, and the two named `refreshment-hydration` products `Green Apple Italian Soda` and `Chamomile Organic Tea`.

- [ ] **Step 1: Transcribe the researched payload into Task 8's natural-key format.**

No supplied catalog payload exists anywhere in this repository or its history (confirmed by full-container search during design). The following 17 products were researched and authored to complete four six-item categories from the current 7 — generic non-trademarked names, original house-voice descriptions, and Unsplash images each independently `curl -sI`-verified `200`/`image/jpeg`:

```ts
// Append to productsSeed (existing categoriesSeed already covers all four slugs)
const newProductsSeed = [
  // coffee-espresso (+4)
  { categorySlug: "coffee-espresso", slug: "cappuccino", name: "Cappuccino", description: "Velvety espresso with steamed milk and a silky foam top.", basePriceCents: 525, imageUrl: "https://images.unsplash.com/photo-1724198218214-4548e3a1c145?auto=format&fit=crop&w=600&q=80", isAvailable: true },
  { categorySlug: "coffee-espresso", slug: "americano", name: "Americano", description: "Strong espresso shots diluted with hot water, bright and smooth.", basePriceCents: 450, imageUrl: "https://images.unsplash.com/photo-1784044085099-6a0a83af8745?auto=format&fit=crop&w=600&q=80", isAvailable: true },
  { categorySlug: "coffee-espresso", slug: "mocha", name: "Mocha", description: "Espresso with steamed milk and dark chocolate—warm indulgence in a cup.", basePriceCents: 550, imageUrl: "https://images.unsplash.com/photo-1533651441215-d01c13c8c4ad?auto=format&fit=crop&w=600&q=80", isAvailable: true },
  { categorySlug: "coffee-espresso", slug: "cortado", name: "Cortado", description: "Equal parts espresso and steamed milk, balanced and refined.", basePriceCents: 475, imageUrl: "https://images.unsplash.com/photo-1759363005683-1f75ce9b3f30?auto=format&fit=crop&w=600&q=80", isAvailable: true },
  // refreshment-hydration (+5)
  { categorySlug: "refreshment-hydration", slug: "green-apple-italian-soda", name: "Green Apple Italian Soda", description: "Crisp, sparkling Italian soda with fresh green apple flavor.", basePriceCents: 475, imageUrl: "https://images.unsplash.com/photo-1648911870076-32f918a5063a?auto=format&fit=crop&w=600&q=80", isAvailable: true },
  { categorySlug: "refreshment-hydration", slug: "chamomile-organic-tea", name: "Chamomile Organic Tea", description: "Soothing organic chamomile steeped hot, gentle and calming.", basePriceCents: 425, imageUrl: "https://images.unsplash.com/photo-1775744229016-0979f0c7fc7b?auto=format&fit=crop&w=600&q=80", isAvailable: true },
  { categorySlug: "refreshment-hydration", slug: "matcha-latte", name: "Matcha Latte", description: "Whisked green tea matcha with steamed milk, earthy and vibrant.", basePriceCents: 525, imageUrl: "https://plus.unsplash.com/premium_photo-1774416430683-a4179188c045?auto=format&fit=crop&w=600&q=80", isAvailable: true },
  { categorySlug: "refreshment-hydration", slug: "iced-tea", name: "Iced Tea", description: "Chilled brewed tea with fresh lemon and mint, refreshingly simple.", basePriceCents: 400, imageUrl: "https://images.unsplash.com/photo-1777360444740-9bfd0d0b7b8e?auto=format&fit=crop&w=600&q=80", isAvailable: true },
  { categorySlug: "refreshment-hydration", slug: "hot-chocolate", name: "Hot Chocolate", description: "Rich, creamy hot chocolate topped with whipped cream and cocoa.", basePriceCents: 475, imageUrl: "https://images.unsplash.com/photo-1781131878749-ca751ecfebfe?auto=format&fit=crop&w=600&q=80", isAvailable: true },
  // warm-savories (+4)
  { categorySlug: "warm-savories", slug: "caprese-sandwich", name: "Caprese Sandwich", description: "Fresh mozzarella, ripe tomato, and basil on toasted bread.", basePriceCents: 625, imageUrl: "https://images.unsplash.com/photo-1509722747041-616f39b57569?auto=format&fit=crop&w=600&q=80", isAvailable: true },
  { categorySlug: "warm-savories", slug: "grilled-chicken-sandwich", name: "Grilled Chicken Sandwich", description: "Tender grilled chicken with lettuce, tomato, and aged cheddar.", basePriceCents: 675, imageUrl: "https://images.unsplash.com/photo-1705131187598-771f00b7712c?auto=format&fit=crop&w=600&q=80", isAvailable: true },
  { categorySlug: "warm-savories", slug: "mediterranean-feta-wrap", name: "Mediterranean Feta Wrap", description: "Roasted vegetables and creamy feta wrapped in a warm tortilla.", basePriceCents: 650, imageUrl: "https://plus.unsplash.com/premium_photo-1695132236599-464dad976549?auto=format&fit=crop&w=600&q=80", isAvailable: true },
  { categorySlug: "warm-savories", slug: "grilled-cheese-sandwich", name: "Grilled Cheese Sandwich", description: "Melted cheese between golden, buttered toast—comfort on a plate.", basePriceCents: 550, imageUrl: "https://plus.unsplash.com/premium_photo-1775582104798-57c50a5f4f73?auto=format&fit=crop&w=600&q=80", isAvailable: true },
  // sweet-treats (+4)
  { categorySlug: "sweet-treats", slug: "cinnamon-roll", name: "Cinnamon Roll", description: "Soft, sweet roll swirled with cinnamon and topped with glaze.", basePriceCents: 425, imageUrl: "https://plus.unsplash.com/premium_photo-1722002219049-1c41e1a034c8?auto=format&fit=crop&w=600&q=80", isAvailable: true },
  { categorySlug: "sweet-treats", slug: "raspberry-tart", name: "Raspberry Tart", description: "Crisp pastry shell filled with custard and fresh raspberries.", basePriceCents: 475, imageUrl: "https://images.unsplash.com/photo-1785769616179-17155c34d4cc?auto=format&fit=crop&w=600&q=80", isAvailable: true },
  { categorySlug: "sweet-treats", slug: "almond-croissant", name: "Almond Croissant", description: "Buttery croissant topped with sliced almonds and powdered sugar.", basePriceCents: 450, imageUrl: "https://plus.unsplash.com/premium_photo-1778405352314-608cf141c8c6?auto=format&fit=crop&w=600&q=80", isAvailable: true },
  { categorySlug: "sweet-treats", slug: "lemon-bar", name: "Lemon Bar", description: "Tart and sweet lemon filling on a buttery shortbread crust.", basePriceCents: 400, imageUrl: "https://images.unsplash.com/photo-1565791931015-523f86a44879?auto=format&fit=crop&w=600&q=80", isAvailable: true },
];

// New variant groups: milk-selection, mirroring Latte's existing options exactly, one row per product per schema
const newVariantGroupsSeed = ["cappuccino", "americano", "mocha"].map((productSlug) => ({
  productSlug,
  slug: "milk-selection",
  name: "Select Milk",
  minSelections: 1,
  maxSelections: 1,
  options: [
    { slug: "whole-milk", name: "Whole Milk", priceDeltaCents: 0, isDefault: true },
    { slug: "oat-milk", name: "Oat Milk", priceDeltaCents: 80, isDefault: false },
    { slug: "almond-milk", name: "Almond Milk", priceDeltaCents: 80, isDefault: false },
  ],
}));

// New add-on group
const newAddonGroupsSeed = [
  {
    productSlug: "mocha",
    slug: "mocha-addons",
    name: "Add-ons",
    minSelections: 0,
    maxSelections: null,
    addons: [
      { slug: "extra-shot", name: "Extra Shot", priceDeltaCents: 100, isActive: true },
      { slug: "whipped-cream", name: "Whipped Cream", priceDeltaCents: 75, isActive: true },
    ],
  },
];
```

Merge `newProductsSeed` into the natural-key product list (17 categoryless product objects become products keyed by `categorySlug`, resolved through Task 8's `categoryIdBySlug` map), and merge `newVariantGroupsSeed`/`newAddonGroupsSeed` the same way through `productIdBySlug`. Record this payload's provenance (web-researched, independently `curl`-verified, not externally supplied) in the implementation handoff.

- [ ] **Step 2: Write exact failing data assertions from the payload above.**

Assert 4 categories, exactly 6 products per category, exact category/product slug lists, exact price/description/availability fields, every variant/add-on tuple above, and that the `refreshment-hydration` category contains products named `Green Apple Italian Soda` and `Chamomile Organic Tea` (they are product names, not variant options — neither has a variant group). Assert photo strings are stored without URL validation or fetches.

Also update the count expectations Task 8 left at the old catalog size, in the same edit:

- `scripts/seed.test.ts:51` (test `main loads the database URL from env, seeds rows, and logs counts`) asserts the literal `["Seeded 4 categories and 7 products"]`. Change it to `["Seeded 4 categories and 24 products"]`; raising the product count to 24 breaks this literal string, and `main()`'s log format itself must not change.
- in test `seed is repeatable and populates the catalog`, both `seed(url)` results change from `{ categories: 4, products: 7 }` to `{ categories: 4, products: 24 }`, `count("products")` from 7 to 24, `count("variant_groups")` from 1 to 4, `count("variant_options")` from 3 to 12, `count("addon_groups")` from 1 to 2, and `count("addons")` from 2 to 4.

Run `bun test scripts/seed.test.ts`; expect these new assertions to FAIL against Task 8's still-7-product seed.

- [ ] **Step 3: Merge the payload into `scripts/seed.ts` and run the full data proof.**

Merge `newProductsSeed`/`newVariantGroupsSeed`/`newAddonGroupsSeed` into Task 8's natural-key seed definitions exactly as given above — do not alter names, prices, descriptions, or image URLs. `loadMenu` orders products by slug (`src/lib/catalog.functions.server.ts:35`), so within Coffee & Espresso `Espresso` moves from first of two to fourth of six (`americano`, `cappuccino`, `cortado`, `espresso`, `latte`, `mocha`). Existing helpers and specs that click `Espresso` (`e2e/browser/kiosk-claim-helpers.ts:16`, `e2e/browser/checkout-payment.spec.ts:7,28`, `e2e/browser/abandonment-ux.spec.ts:5`, `e2e/browser/menu-cart.spec.ts:12`) therefore rely on Playwright auto-scrolling the Task 5 horizontal category carousel to reveal it — that is expected behavior, not a regression to investigate. Run:

```bash
bun test scripts/seed.test.ts src/lib/catalog.functions.test.ts
bun scripts/reset-db.ts
bun run db:migrate
bun run db:seed
bun run build:e2e:core
PW_PROJECT=core bunx playwright test e2e/browser/menu-cart.spec.ts
```

Expected: PASS with `{ categories: 4, products: 24 }`, the `Seeded 4 categories and 24 products` log line, six visible products in each category carousel, exact option relationships, and both named `refreshment-hydration` products.

- [ ] **Step 4: Commit catalog data separately for auditable review.**

```bash
git add scripts/seed.ts scripts/seed.test.ts src/lib/catalog.functions.test.ts e2e/browser/menu-cart.spec.ts
git commit -m "feat(seed): adopt researched reference catalog"
```

---

### Task 10: Add favicon and per-route metadata after route stabilization

**Files:**
- Create: `public/favicon.svg`
- Create: `e2e/browser/kiosk-metadata.spec.ts`
- Modify: `src/routes/__root.tsx`
- Modify: `src/routes/_kiosk.index.tsx`
- Modify: `src/routes/_kiosk.search.tsx`
- Modify: `src/routes/_kiosk.details.tsx`
- Modify: `src/routes/_kiosk.cart.tsx`
- Modify: `src/routes/_kiosk.pay.tsx`
- Modify: `src/routes/kitchen.tsx`

**Interfaces:**
- Consumes: stable route files, `HeadContent`, root `head.links`, details loader product, and Warm & Melted voice/tokens.
- Produces: successful `/favicon.svg`, root fallback title, and one title/meta description per UI route.

- [ ] **Step 1: Add failing route metadata browser assertions.**

Drive each real route and assert exact title plus one `meta[name="description"]`:

| Route | Title | Description |
| --- | --- | --- |
| `/` | `Menu | Warm & Melted` | `Browse the Warm & Melted menu and build your order.` |
| `/search?q=Latte` | `Search | Warm & Melted` | `Search drinks, savory bites, and sweet treats.` |
| `/details?id=<Latte id>` | `Latte | Warm & Melted` | Latte's stored description, with `Customize Latte for your Warm & Melted order.` fallback |
| `/cart` | `Your order | Warm & Melted` | `Review your items and subtotal before checkout.` |
| `/pay?step=choosing_method` | `Checkout | Warm & Melted` | `Choose a payment method and complete your order.` |
| `/kitchen` | `Kitchen queue | Warm & Melted` | `View and advance paid and preparing orders.` |

Also request `/favicon.svg`, expect HTTP 200 with `image/svg+xml`, and assert a `link[rel="icon"]` points to it. Record red starter-title/missing-link failures.

- [ ] **Step 2: Create the on-brand SVG favicon and root fallback.**

Create a simple static SVG using a forest-green rounded square, warm-paper foreground, and a legible `W` mark; include an accessible `<title>Warm & Melted</title>`, no external font/image, no script, and no embedded data URL. Add `{ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }` to root head links. Replace `TanStack Start Starter` with fallback `Warm & Melted` and add fallback description `Self-service ordering at Warm & Melted.`

- [ ] **Step 3: Add static and dynamic route heads.**

Add `head` functions with the exact table copy. Details uses the already-resolved loader product; it must not issue a second query. Search titles do not echo raw user input. Payment metadata does not expose phase, order id, attempt id, receipt, or amount. Kitchen metadata stays on the kitchen route outside `_kiosk`.

- [ ] **Step 4: Run metadata browser proof.**

Run:

```bash
bun run build:e2e:core
PW_PROJECT=core bunx playwright test e2e/browser/kiosk-metadata.spec.ts
```

Expected: all title/description/favicon assertions PASS without duplicate description tags.

- [ ] **Step 5: Commit route metadata.**

```bash
git add public/favicon.svg src/routes/__root.tsx src/routes/_kiosk.index.tsx src/routes/_kiosk.search.tsx src/routes/_kiosk.details.tsx src/routes/_kiosk.cart.tsx src/routes/_kiosk.pay.tsx src/routes/kitchen.tsx e2e/browser/kiosk-metadata.spec.ts
git commit -m "feat(kiosk): add branded route metadata"
```

---

### Task 11: Integrate available work, update docs, and record final proof

**Files:**
- Modify: `docs/PRD.md`
- Modify: `README.md` if its navigation/onboarding description changed
- Modify: `CHANGELOG.md`
- Modify: `docs/specs/2026-08-21-kiosk-polish-ui-design.md` if implementation revealed contract drift
- Modify: `docs/plans/2026-08-21-kiosk-polish-ui-plan.md` if sequencing or paths changed
- Modify excluded: `GOAL.md` Plan/Log sections during implementation only

**Interfaces:**
- Consumes: Tasks 1–8 and 10; Task 9's exact data assertions must pass before claiming 24 products.
- Produces: one integrated route/UI/seed result, current product docs, exact test counts, live browser observations, commit hashes, and a truthful blocked/complete status for item 16b.

- [ ] **Step 1: Reconcile parallel-wave outputs without compatibility shims.**

Merge Tasks 5–8 after their focused checks. Resolve imports/types against Task 4's final route/context contracts. Run `bun run generate-routes` once after all route files settle. Remove dead local state, drawer code, stale test selectors, unused exports, and generated drift. This step is the gate Track B's frontend instrumentation waits on: Track B Task 8 (`menu-screen.tsx` call sites) and Track B Task 9 (`checkout-screen.tsx`/`use-abandonment.ts` call sites) may start only after this step is complete, because this is where dead code is deleted, stale exports removed, and route generation re-run. Track B Tasks 7 (`kiosk-claim-screen.tsx`) and 10 (`kitchen-screen.tsx`) have no dependency on this track at all — Track A never touches either file — and need no gate. Announce completion of this step to Track B rather than restoring old call sites to ease its merge.

- [ ] **Step 2: Update product and release documentation.**

Update `docs/PRD.md` current-state flows to name routed search/details/cart/pay, persistent bottom bar, menu carousels/scrollspy, visible confirmation countdown, and scoped kiosk behavior. Update README only where users/operators see route or seed changes. Add a changelog entry noting the researched 24-product catalog. Do not claim 24 products unless Task 9's assertions passed.

- [ ] **Step 3: Run final repository checks exactly once after cleanup.**

Run:

```bash
bun run lint && bun run format && bun run typecheck && bun run test && bun run test:e2e && bun run build
```

Record each exit status and exact Bun/Playwright test counts in `GOAL.md`. A failure blocks completion; do not describe partial green checks as a green suite.

- [ ] **Step 4: Migrate/seed and start the built app for live proof.**

Run:

```bash
bun scripts/reset-db.ts
bun run db:migrate
bun run db:seed
bun run start
```

Use browser control against the built server. Capture landscape and portrait viewport evidence for menu layout, sticky scrollspy through at least three categories, card/image geometry, search/details/cart/pay URLs, same shell/footer identity, Back behavior, Cancel hierarchy, live payment phase URLs, confetti/countdown, not-found, skeleton-to-data transition, scoped selection/scrollbar, route metadata/favicon, and `/kitchen` exclusion. Record observed URLs, titles, category names, cart totals, order number/status, and countdown values rather than only screenshots.

- [ ] **Step 5: Record seed proof and the catalog blocker honestly.**

Run the real seed twice. Record counts and loaded variant/add-on relationships. Once Task 9 has run, record 4 categories, 24 products, six per category, exact relationship assertions, and both named `refreshment-hydration` products (`Green Apple Italian Soda`, `Chamomile Organic Tea`). If Task 9 has not yet run in this pass, report item 16a's counts honestly and note 16b as not-yet-executed rather than claiming 24 products.

- [ ] **Step 6: Update `GOAL.md` and hand off to Main.**

Add the approved design/plan paths, implementation commit hashes, focused red/green evidence, final command/test counts, browser server URL, exact live observations, completed backlog item map, and item 16b status to `GOAL.md`. Send Main a concise handoff including route/context contracts, deleted drawer/old route files, parallel slice commits, the exact Track B gate (Track B Tasks 8–9 unblocked by Task 11 Step 1; Track B Tasks 7 and 10 never blocked), and the researched-catalog provenance note.

Closing agent must record every implementation commit, exact unit/browser test counts, full-check results, built-server URL, landscape/portrait proof, observed route/payment/category states, seed counts/relationships, and the researched-catalog provenance before marking this track done. Do not mark item 16b done without Task 9's assertions actually passing against the real database.
