# Kiosk UI/UX polish design

## Contents

- [Goal](#goal)
- [Verified current-system findings](#verified-current-system-findings)
- [Proposed architecture and implementation approach](#proposed-architecture-and-implementation-approach)
- [Runtime behavior and failure handling](#runtime-behavior-and-failure-handling)
- [Decisions, trade-offs, and sequencing](#decisions-trade-offs-and-sequencing)
- [Backlog traceability](#backlog-traceability)
- [Validation and browser proof](#validation-and-browser-proof)
- [Reference catalog resolution](#reference-catalog-resolution)
- [Self-review](#self-review)

## Goal

Turn the current single-component customer kiosk flow into a route-addressable, touch-first experience while preserving the real cart, order, payment, abandonment, kiosk-session, and kitchen contracts. The customer shell and bottom bar stay mounted across menu, search, product details, cart, and payment navigation; menu presentation becomes faster to scan and easier to use; payment completion becomes explicit; global polish remains scoped away from staff screens; and the seed mechanism stops encoding relationships as fixed UUIDs.

This design covers `GOAL.md` polish backlog items 1–17. Item 16 is split into a fully specified relationship-aware seed refactor (item 16a) and the full 4-category/24-product catalog data (item 16b). No supplied payload existed anywhere in this repository or its history, so — per explicit direction — a researched, original 17-product catalog was authored to complete the four six-item categories, using generic non-trademarked names, original house-voice descriptions, and independently `curl`-verified Unsplash photography for every new item; see [Reference catalog resolution](#reference-catalog-resolution).

## Verified current-system findings

The following findings come from direct reads of the current worktree and define the seams the implementation must preserve.

- `src/components/menu-screen.tsx:34-119` owns nearly the entire customer journey: menu query, cart reducer, search text, selected product/drawer state, cart-detail state, checkout snapshot, payment context, and abandonment callbacks. Its `checkoutCart` and `cartOpen` branches at `src/components/menu-screen.tsx:172-285` replace the menu in local React state rather than navigating. This is the central boundary that must be split before route-level metadata or route-local pending states can be correct.
- Search is currently an in-page filter (`src/components/menu-screen.tsx:39,48-60,329-435`). Product options open the modal-like `CustomizationDrawer` through local `selectedProduct`/`drawerOpen` state (`src/components/menu-screen.tsx:40-44,69-77,446-453`); the drawer implements its own focus trap and overlay at `src/components/customization-drawer.tsx:21-113,169-305`. Neither interaction has a shareable or reload-visible URL.
- Menu controls still render the `Menu` heading and subtitle (`src/components/menu-screen.tsx:324-327`), while category pills already use the installed shadcn/ui carousel and the integration branch's full-width bleed pattern (`src/components/menu-screen.tsx:346-366`). Category sections have refs and smooth jump behavior (`src/components/menu-screen.tsx:45,62-67,154-170`) but no active category state or scroll tracking.
- Product cards are one large button with a `h-40 w-full` image and text-link-like CTA (`src/components/menu-screen.tsx:121-152`). Category products and search results are responsive grids (`src/components/menu-screen.tsx:166-168,432-434`), not one horizontal row per category.
- First-load menu pending state is only the text line `Loading the menu…` (`src/components/menu-screen.tsx:369-376`). Error, retry, empty-catalog, and empty-search states are already distinct (`src/components/menu-screen.tsx:378-416`) and must remain distinct from loading skeletons.
- `KioskShell` is already the correct fixed-height layout primitive: one non-scrolling header, one `overflow-y-auto` content region, and one non-scrolling footer (`src/components/kiosk-shell.tsx:9-27`). Its header currently carries `border-b` at `src/components/kiosk-shell.tsx:15`; the content element has no exposed ref for scrollspy; and the shell is instantiated inside each `MenuScreen` branch, so local screen changes replace the shell rather than route children changing under a persistent shell.
- The router currently has only UI routes `/` and `/kitchen` (`src/routes/index.tsx:7-25`, `src/routes/kitchen.tsx:1-6`; generated registration in `src/routeTree.gen.ts:11-42`). `src/router.tsx:6-16` already enables TanStack Router scroll restoration and Query integration. TanStack Router pathless layout routes and `Outlet` therefore fit the existing stack without a new routing or state dependency.
- The `/` route currently owns kiosk-session loading and gates between `KioskClaimScreen` and `MenuScreen` (`src/routes/index.tsx:7-25`). Session lookup is already a real GET server function (`src/lib/kiosk.functions.ts`, `getKioskSession`) backed by signed-cookie verification and a kiosk-row lookup (`src/lib/kiosk.functions.server.ts:40-52`). That gate belongs on the customer pathless layout so every customer child route has identical authorization behavior.
- `KioskClaimScreen` is a staff setup surface that already renders its own `KioskShell` and invalidates `['kiosk-session']` before reloading (`src/components/kiosk-claim-screen.tsx:37-58,110-275`). It must remain available when the customer layout loader returns `null`, but it must not inherit customer-only text-selection rules.
- `CheckoutScreen` owns the payment state machine in `CheckoutPhase` (`src/components/checkout-screen.tsx:28-35,59-169`). It calls the real `createOrder`, `startPaymentAttempt`, and `reconcilePaymentAttempt` server functions without raw REST fetches (`src/components/checkout-screen.tsx:73-155`). Its selection screen styles Cancel like another bordered payment action (`src/components/checkout-screen.tsx:180-213`), and confirmation silently calls `onComplete` after 2 seconds (`src/components/checkout-screen.tsx:171-178,216-236`).
- `useAbandonment` receives cart and payment context from `MenuScreen`, resets on pointer activity, and expires a live attempt before clearing checkout (`src/lib/use-abandonment.ts:69-136,155-203`). Moving screens into routes must keep this hook above the route outlet so navigation does not reset its timers or strand a pending payment.
- Catalog data already comes from `getMenu` (`src/lib/catalog.functions.ts`, `getMenu`). `loadMenu` loads only active categories, available products, active add-ons, and all configured variant relationships, then assembles the nested `Menu` result (`src/lib/catalog.functions.server.ts:19-163`). Search, details, and menu must share the same TanStack Query key instead of issuing parallel contracts.
- Order and payment inputs remain server-owned. `CreateOrderInput`/`CreateOrderResult` are exported through `src/lib/order.functions.ts`; payment phases call `startPaymentAttempt`, `reconcilePaymentAttempt`, and `expirePaymentAttempt` through `src/lib/payment.functions.ts`. The polish work changes navigation and presentation, not these server-function signatures, payment correlation, or error codes.
- Kitchen is a separate staff route and layout (`src/components/kitchen-screen.tsx:90-198,294-478`). Its query/actions come from `src/lib/kitchen.functions.ts`, it consumes `EventSource('/api/kitchen/events')` at `src/components/kitchen-screen.tsx:347-389`, and the server route streams `kitchenEventDispatcher` events after staff-cookie verification (`src/lib/kitchen-events.server.ts:49-65`, `src/routes/api/kitchen/events.ts:6-61`). Customer CSS and route restructuring must not wrap, restyle, or intercept this route.
- Environment parsing is centralized in `src/env.ts:3-45` and loaded server-side by `src/env.server.ts:1-4`. Track A requires no new environment variable. This also avoids the only non-UI file overlap with Track B's planned logging-level fields.
- Root head metadata is still the starter title and stylesheet only (`src/routes/__root.tsx:43-64`), and no root `notFoundComponent` exists. There is no `public/` asset directory. Route-level `head` functions plus a root SVG favicon can solve item 17 without an SEO dependency.
- `src/styles.css:11-192` defines the warm-paper, forest-green, Inter-based token system required by `docs/PRD.md`; global rules stop at base box sizing and body styles (`src/styles.css:194-209`). Customer scrollbar and selection rules can be added under a customer-layout data attribute without touching staff/kitchen behavior.
- `scripts/seed.ts:22-199` hard-codes UUIDs and foreign-key UUIDs in six parallel catalog seed arrays. The transaction clears dependent rows in a safe order and inserts those arrays at `scripts/seed.ts:203-227`. `scripts/seed.test.ts:13-33` proves repeatability but only expects 4 categories and 7 products, and `scripts/seed.test.ts:51` additionally pins the literal log line `Seeded 4 categories and 7 products`. Schema IDs have no database default (`src/db/schema.ts:10-100`), so the refactor must generate IDs at insert time, return `{ id, slug }`, and resolve child foreign keys from natural-key maps.
- `kiosksSeed` (`scripts/seed.ts:20`) is deliberately excluded from the natural-key refactor: its hardcoded `id: "front-counter"` is load-bearing because `e2e/browser/kiosk-claim-helpers.ts:15` claims the kiosk through the `Claim Front counter` control that every browser spec depends on. Only categories, products, variant groups, variant options, add-on groups, and add-ons move to natural keys.
- Current browser specs assert behavior that this change intentionally moves or removes: `e2e/browser/menu-cart.spec.ts` and `home.spec.ts` require a `Menu` heading; `menu-cart.spec.ts` expects a customization dialog; `checkout-payment.spec.ts` expects a silent return after confirmation; and `design-system-shell.spec.ts` checks the current fixed shell. These tests must be changed before implementation, not weakened after it.

## Proposed architecture and implementation approach

1. **Land customer navigation architecture first.** Replace `src/routes/index.tsx` with a pathless `src/routes/_kiosk.tsx` layout and child route files for `/`, `/search?q=`, `/details?id=`, `/cart`, and `/pay?step=`. `_kiosk.tsx` owns the existing session loader/query gate. A valid session renders `KioskCustomerLayout` and an `Outlet`; a missing session renders the existing `KioskClaimScreen`. `/kitchen` and API routes remain direct root children.
2. **Move cross-screen customer state into the persistent layout, not a global store.** `KioskCustomerLayout` owns `cartReducer`, the immutable checkout-cart snapshot, `PaymentContext`, `useAbandonment`, and the single `KioskShell` instance. A small colocated React context exposes typed cart actions, checkout lifecycle callbacks, kiosk ID, and the shell content ref to child screens. Menu/search/details/cart/pay routes consume this context. Client-side child navigation preserves state and the exact footer DOM node; a full reload intentionally starts a fresh local cart because cart persistence is not in scope.
3. **Use URL search parameters as typed navigation state.** `/search` validates `q` to a string and updates it with replace navigation while the customer types. `/details` validates `id`, resolves the product from the shared `['menu']` query, and throws TanStack `notFound()` when the id is absent or unknown. `/pay` validates `step` against all existing `CheckoutPhase` values. The checkout state machine remains authoritative: it writes phase changes to the URL with replace navigation; a direct or edited URL cannot manufacture `confirmed` without a live checkout snapshot and successful reconciliation.
4. **Make cart the concrete additional screen for item 12.** The current `cartOpen` branch becomes `/cart`, while menu, search, details, and payment become route screens. This gives the broad “more screens” request a bounded result without inventing unrelated pages. Bottom-bar actions navigate between `/`, `/cart`, and `/pay?step=choosing_method`; Pay remains disabled for an empty cart.
5. **Create a shared menu-query option and reusable product card.** `menuQueryOptions` defines the existing `['menu']`/`getMenu` contract once. Menu and search use it through `useQuery`; details uses `queryClient.ensureQueryData` so dynamic head metadata and unknown-id handling use the same cache. A reusable `ProductCard` keeps the existing one-tap add for products without options and navigates configurable products to `/details?id=`. The old drawer and its overlay/focus-trap code are removed after every caller moves.
6. **Apply menu polish after the route split.** Remove the `Menu` title/subtitle. Keep a centered search control and category carousel as the menu controls. The category carousel becomes sticky inside the shell's scroll region. `KioskShell` exposes its content ref; one requestAnimationFrame-throttled scroll handler chooses the last category heading above the sticky activation line, updates `aria-current`, and asks Embla to reveal the active pill. Category clicks use the same offset and smooth-scroll path. Each category becomes one shadcn/ui carousel row using the existing `-mx-5` outer bleed and inner `pl-5 pr-5` clipping fix. Cards use a fixed 280-pixel width and a 280-by-280 image at every breakpoint, with a visually circular bottom-right plus treatment on…
7. **Polish checkout without changing payment contracts.** On the choosing-method screen, Cancel becomes a borderless low-emphasis action; payment methods retain primary/outlined hierarchy. Confirmation renders deterministic, aria-hidden CSS confetti that is disabled under `prefers-reduced-motion`, plus a polite visible 2-second countdown. Countdown reaching zero performs the existing reset-and-return behavior. No confetti dependency or random server/client rendering is introduced.
8. **Add route-local loading and scoped system CSS.** Replace only the menu query's first-pending text with a stable skeleton containing category-pill and 280-pixel card placeholders; error, retry, empty, and no-results states remain unchanged. Add CSS-only scrollbar rules and `user-select: none` beneath `[data-kiosk-customer]`; staff setup and `/kitchen` remain outside that attribute. Inputs and controls retain focus, keyboard, and accessible-name behavior.
9. **Refactor the seed mechanism independently from catalog content.** Define relationship data by natural keys only: category slug, product slug plus category slug, group slug plus product slug, and option/add-on slug plus group/product slugs. Generate row IDs when inserting each parent tier, call `.returning({ id, slug, ...needed parent key })`, and build maps used by the next tier. Keep the existing transaction and deletion order. Expand `scripts/seed.test.ts` first to prove no seed-data object contains an `id`/foreign-key UUID, relationships resolve after two consecutive seeds, and representative variants/add-ons load through `loadMenu`.
10. **Adopt the researched catalog payload.** Replace the current 7-product reference data with the 24-product set in [Reference catalog resolution](#reference-catalog-resolution), preserving only name, slug, price, description, availability, image URL as an opaque unvalidated string, and option configuration. Final assertions must prove 4 categories, 24 products, exact variants/add-ons, and that the `refreshment-hydration` category contains products named `Green Apple Italian Soda` and `Chamomile Organic Tea`.

## Runtime behavior and failure handling

A request to any customer route first resolves the signed kiosk session through the existing server function. Missing, invalid, or stale kiosk cookies render setup; no customer route bypasses that gate. A valid session mounts one customer layout. Subsequent links change only the outlet, so cart state, abandonment state, header, and bottom bar persist.

The menu's search control navigates to `/search?q=`. Search results derive from cached categories using the current case-insensitive name/description/category match. A configurable product navigates to `/details?id=`; missing products use the branded not-found boundary rather than an empty details shell. Adding a configured line navigates back to the caller's menu/search context where practical, with `/` as the deterministic fallback. Non-configurable products retain one-tap add behavior.

Selecting Pay snapshots the current cart before entering `/pay?step=choosing_method`. Checkout changes the URL only after its internal phase changes. Cancelling clears checkout/payment context but preserves cart for retry. Successful reconciliation and receipt printing enter `confirmed`, start the visible countdown, then clear cart/checkout state and replace-navigate to `/`. An empty or freshly reloaded `/pay` cannot resume a lost local payment UI; it replace-navigates to `/`, while existing server-side payment expiry remains governed by `useAbandonment` and backend contracts.

Menu query failure continues to show Retry. Empty catalog and empty search remain semantically different. Skeletons are `aria-hidden`; one concise `aria-live` loading label is retained for assistive technology. Confetti is decorative and never announced. Reduced-motion users see the static confirmation and countdown without particle motion.

Scrollspy reads the one real shell scroll container, not `window`. It batches scroll work through one animation frame, uses current section offsets, and removes listeners/queued frames on unmount. The active pill is both visually selected with the existing forest-green token and exposed with `aria-current="true"`.

The seed remains atomic. Any unresolved natural key throws with the missing parent slug and rolls the transaction back. No partial catalog can be committed. Photo URL strings are stored as supplied without network requests or validation.

## Decisions, trade-offs, and sequencing

- **Confirm item 8 first.** `GOAL.md` ordering is correct. Route architecture changes ownership of cart state, shell lifetime, menu loading, details UI, checkout state, metadata, and browser selectors. Polishing the monolithic `MenuScreen` first would create high-rebase temporary work and then move it immediately. Navigation tests and architecture land before any task that assumes real routes.
- **Pathless customer layout, not root shell.** A root shell would incorrectly wrap `/kitchen` and API/not-found surfaces. `_kiosk` keeps customer routes together without changing their public paths and makes customer-only CSS scoping explicit.
- **Local React context, not a new state library.** Cross-route state needs one provider, but this POC does not need persistence, selectors, or a global store dependency. The layout lifetime provides the required persistence boundary.
- **URL mirrors checkout; server workflow remains authoritative.** Search and details parameters are inputs. Payment `step` is an observable projection of the live client state machine, not permission to skip payment phases. This avoids deep-linking directly to success while still making the current screen addressable.
- **`/cart` is item 12's bounded extra page.** It converts an existing branch into navigation and improves browser back behavior. No account, history, attract, or marketing pages are added.
- **No new visual dependency.** Existing Embla/shadcn Carousel handles horizontal rows. Deterministic CSS handles confetti and native pseudo-elements handle scrollbars. This reduces bundle and maintenance cost.
- **Fixed 280-pixel media is deliberate.** A 280-pixel carousel basis satisfies the requested invariant and keeps horizontal scanning predictable. It trades multi-column fluid cards for touch-friendly swipe overflow, which item 7 explicitly requests.
- **Customer-only selection scope is structural.** `[data-kiosk-customer]` lives on the valid-session customer layout. Kitchen and kiosk setup stay selectable by construction rather than exception overrides.
- **Track A/Track B implementation order.** Track B backend logging may run concurrently with Track A because it changes server functions/events while Track A changes routes, seed data, and presentation. Track B's kiosk-claim-screen and kitchen-screen logging tasks (Track B Tasks 7 and 10) also have no Track A dependency — Track A never touches either file — so they may run in Track B's backend wave. Only Track B's menu-screen and checkout-screen/`use-abandonment` instrumentation (Track B Tasks 8 and 9) must wait until Track A's final integration task (Task 11) completes, because Task 11 is where Track A deletes dead local state, removes stale exports, and re-runs route generation; instrumenting before that risks targeting call sites Task 11 then deletes or moves again. Track A adds no env field, avoiding Track B's `src/env.ts` logging-level edit.
- **Parallel implementation wave after navigation.** Once the route/layout/payment move is green, menu visuals, checkout visuals, scoped global polish, and the natural-key seed mechanism have disjoint files and may run concurrently. Metadata waits until route files stabilize. Expanded catalog adoption depends only on the natural-key mechanism (Task 8) landing first, since the payload is now resolved — see [Reference catalog resolution](#reference-catalog-resolution).

## Backlog traceability

| Backlog item | Design responsibility | Planned sequence |
| --- | --- | --- |
| 1 | Remove `Menu` heading/subtitle; centered search plus pills | Menu-polish parallel task after navigation |
| 2 | Sticky category pill carousel | Menu-polish parallel task |
| 3 | Remove `KioskShell` header `border-b` | Navigation foundation |
| 4 | Scroll-container scrollspy, active pill, pill reveal | Menu-polish parallel task |
| 5 | Circular plus treatment on actual product button | Shared `ProductCard` plus menu-polish task |
| 6 | Fixed 280-by-280 product media | Menu-polish parallel task |
| 7 | One Embla/shadcn carousel row per category with bleed fix | Menu-polish parallel task |
| 8 | `_kiosk` layout and `/search`, `/details`, `/cart`, `/pay?step=` | First sequential architecture tasks |
| 9 | Root branded `notFoundComponent` | Navigation foundation |
| 10 | Borderless low-emphasis payment Cancel | Checkout-polish parallel task |
| 11 | Reduced-motion-safe confetti and visible 2-second countdown | Checkout-polish parallel task |
| 12 | Menu/search/details/cart/pay become separate screens | Navigation architecture; `/cart` is bounded extra screen |
| 13 | First menu load skeleton, errors unchanged | Scoped-global-polish parallel task |
| 14 | CSS-only customer scrollbars | Scoped-global-polish parallel task |
| 15 | `[data-kiosk-customer]` selection scope; kitchen/setup excluded | Customer layout plus scoped-global-polish task |
| 16a | Natural-key relationship seed mechanism using returned IDs | Seed-refactor parallel task |
| 16b | Full 4-by-6 reference catalog, exact options and named examples | Task 9, payload resolved — see [Reference catalog resolution](#reference-catalog-resolution) |
| 17 | SVG favicon and per-route title/description | Metadata task after route stabilization |

## Validation and browser proof

This is frontend-visible and cross-cutting work, so the plan opens with a failing real-screen Playwright spec in `e2e/browser/kiosk-navigation.spec.ts`. It proves route URLs, browser Back behavior, the same shell/footer DOM node across navigations, guarded direct navigation, branded not-found behavior, and cart/payment state continuity. Each visual parallel task then adds its own failing browser assertion before implementation. Pure seed behavior uses the existing in-memory database pattern in `scripts/seed.test.ts`; no browser test is forced onto seed internals.

Focused checks are:

```bash
bun scripts/reset-db.ts
bun run db:migrate
bun run db:seed
bun run build:e2e:core
PW_PROJECT=core bunx playwright test e2e/browser/kiosk-navigation.spec.ts
PW_PROJECT=core bunx playwright test e2e/browser/menu-cart.spec.ts e2e/browser/design-system-shell.spec.ts
PW_PROJECT=core bunx playwright test e2e/browser/checkout-payment.spec.ts
bun test scripts/seed.test.ts src/lib/catalog.functions.test.ts
```

After all available implementation tasks, run:

```bash
bun run lint
bun run format
bun run typecheck
bun run test
bun run test:e2e
bun run build
```

Live browser proof uses the built core server and records both a landscape kiosk viewport and a portrait tablet viewport. It must show:

1. `/` with no Menu title/subtitle, centered search, sticky active category pill, one-row category carousels, 280-by-280 images, and circular plus controls.
2. Scroll through at least three categories and record active-pill changes plus automatic pill reveal.
3. Navigate `/ → /search?q= → /details?id= → /cart → /pay?step=choosing_method`; record URLs, Back behavior, cart subtotal, and that the shell/footer node stays mounted.
4. Record low-emphasis Cancel, every observed payment step URL, confetti, the visible countdown, and automatic return to an empty `/` menu.
5. Open an unknown URL and record the branded not-found surface without TanStack's generic fallback warning.
6. Record menu skeleton while the first menu request is held, then release it and record real products; separately prove Retry still handles a failed request.
7. Confirm customer text cannot be selected and the custom scrollbar is visible, then confirm `/kitchen` and setup inputs/text remain selectable and usable.
8. Inspect document title and description on every customer route and `/kitchen`, and confirm the SVG favicon request succeeds.
9. Run the relationship-aware seed twice and record counts plus loaded variant/add-on relationships. The 24-product catalog proof becomes claimable once Task 9 runs against the resolved payload; record the full `{ categories: 4, products: 24 }` result and both named examples as products of `refreshment-hydration` (`Green Apple Italian Soda`, `Chamomile Organic Tea`).

## Reference catalog resolution

No supplied catalog payload existed anywhere in this repository, the sibling `../references.md`, or `GOAL.md`'s commit history — confirmed by a full-container search before this section was written. Per explicit direction, a subagent researched and authored the missing 17 products needed to complete four six-item categories from the current 7, then every image URL was independently re-verified in this session with `curl -sI` (not merely trusted from the researching agent's claim), confirming `200`/`image/jpeg` for all 17. Product names are generic, non-trademarked café terms; descriptions are original, written to match the existing house voice. **This is an AI-researched placeholder catalog for the fictional "Warm & Melted" brand, not data supplied by an external stakeholder** — implementation must record this provenance in the closing handoff rather than presenting it as sourced content.

`GOAL.md` item 16b names `Green Apple` Italian Soda and `Chamomile` Organic Tea. This design interprets both as **product names**, not variant options: the payload below defines two ordinary top-level products in `refreshment-hydration` — `Green Apple Italian Soda` (`green-apple-italian-soda`) and `Chamomile Organic Tea` (`chamomile-organic-tea`) — with no variant group attached to either. Assertions therefore check category membership by product name, never variant-option membership.

**New products** (17, all `isAvailable: true`, appended to the existing 7):

| Category | Slug | Name | Price | Description |
| --- | --- | --- | --- | --- |
| Coffee & Espresso | `cappuccino` | Cappuccino | $5.25 | Velvety espresso with steamed milk and a silky foam top. |
| Coffee & Espresso | `americano` | Americano | $4.50 | Strong espresso shots diluted with hot water, bright and smooth. |
| Coffee & Espresso | `mocha` | Mocha | $5.50 | Espresso with steamed milk and dark chocolate—warm indulgence in a cup. |
| Coffee & Espresso | `cortado` | Cortado | $4.75 | Equal parts espresso and steamed milk, balanced and refined. |
| Refreshment & Hydration | `green-apple-italian-soda` | Green Apple Italian Soda | $4.75 | Crisp, sparkling Italian soda with fresh green apple flavor. |
| Refreshment & Hydration | `chamomile-organic-tea` | Chamomile Organic Tea | $4.25 | Soothing organic chamomile steeped hot, gentle and calming. |
| Refreshment & Hydration | `matcha-latte` | Matcha Latte | $5.25 | Whisked green tea matcha with steamed milk, earthy and vibrant. |
| Refreshment & Hydration | `iced-tea` | Iced Tea | $4.00 | Chilled brewed tea with fresh lemon and mint, refreshingly simple. |
| Refreshment & Hydration | `hot-chocolate` | Hot Chocolate | $4.75 | Rich, creamy hot chocolate topped with whipped cream and cocoa. |
| Warm Savories | `caprese-sandwich` | Caprese Sandwich | $6.25 | Fresh mozzarella, ripe tomato, and basil on toasted bread. |
| Warm Savories | `grilled-chicken-sandwich` | Grilled Chicken Sandwich | $6.75 | Tender grilled chicken with lettuce, tomato, and aged cheddar. |
| Warm Savories | `mediterranean-feta-wrap` | Mediterranean Feta Wrap | $6.50 | Roasted vegetables and creamy feta wrapped in a warm tortilla. |
| Warm Savories | `grilled-cheese-sandwich` | Grilled Cheese Sandwich | $5.50 | Melted cheese between golden, buttered toast—comfort on a plate. |
| Sweet Treats | `cinnamon-roll` | Cinnamon Roll | $4.25 | Soft, sweet roll swirled with cinnamon and topped with glaze. |
| Sweet Treats | `raspberry-tart` | Raspberry Tart | $4.75 | Crisp pastry shell filled with custard and fresh raspberries. |
| Sweet Treats | `almond-croissant` | Almond Croissant | $4.50 | Buttery croissant topped with sliced almonds and powdered sugar. |
| Sweet Treats | `lemon-bar` | Lemon Bar | $4.00 | Tart and sweet lemon filling on a buttery shortbread crust. |

Exact `imageUrl` strings (each independently `curl`-verified `200`/`image/jpeg` in this session) and the natural-key seed code ready for transcription live in Task 9 of `docs/plans/2026-08-21-kiosk-polish-ui-plan.md`, which is now unblocked.

**New variant/addon groups** (mirroring Latte's existing milk-selection/add-ons shape, each scoped to its own product per schema):
- `cappuccino`, `americano`, and `mocha` each get their own `milk-selection` variant group — Whole Milk (+$0.00, default), Oat Milk (+$0.80), Almond Milk (+$0.80) — identical option content to Latte's existing group.
- `mocha` additionally gets a `mocha-addons` add-on group — Extra Shot (+$1.00), Whipped Cream (+$0.75).

Final catalog: 4 categories × 6 products = 24 products total.

## Self-review

- **Coverage:** Every `GOAL.md` item 1–17 maps to a design responsibility and task phase; item 16's mechanism and its full 24-product catalog data are both actionable now, with the researched-catalog provenance recorded for audit rather than presented as sourced data.
- **Contract consistency:** Customer route state continues to call `getMenu`, `createOrder`, payment server functions, kiosk session functions, and `expirePaymentAttempt` with existing signatures. `/api/kitchen/events` and kitchen query behavior remain unchanged.
- **Scope:** Added public paths are limited to the requested search/details/pay routes plus `/cart` as the bounded item-12 conversion. No state library, confetti package, API, schema migration, inventory feature, or cart persistence is proposed.
- **Security:** Kiosk session gating remains server-function/cookie based; URL payment steps cannot create a confirmed outcome; no secret or receipt enters metadata, URLs, or analytics; staff routes remain outside customer CSS scope.
- **Performance:** One shared menu query prevents duplicate fetches; one layout prevents remount churn; scrollspy is animation-frame throttled; product rows reuse installed Embla; no avoidable hot-path allocations or dependencies are introduced.
- **Accessibility:** Touch targets remain at least 48 pixels, route screens keep named headings, active category uses `aria-current`, skeleton/confetti are non-content, reduced motion is respected, focus remains visible, and not-found/checkout countdown copy is announced appropriately.
- **Documentation:** Implementation must update `docs/PRD.md`, `README.md` if route onboarding changes, and `CHANGELOG.md` in the same change, per `AGENTS.md`; generated `src/routeTree.gen.ts` is regenerated rather than hand-edited.
