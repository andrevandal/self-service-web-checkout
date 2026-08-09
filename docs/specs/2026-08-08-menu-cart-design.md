# Menu browse and cart build UI

## Contents

- [Goal](#goal)
- [User experience](#user-experience)
- [Architecture](#architecture)
- [Cart model and money](#cart-model-and-money)
- [States and validation](#states-and-validation)
- [Accessibility and visual language](#accessibility-and-visual-language)
- [Verification](#verification)

## Goal

Replace the claimed branch's placeholder menu preview with the customer ordering screen. The menu is the kiosk's resting state: it loads with an empty cart, supports category browsing and no-latency search over the fetched menu, and lets a customer add products directly or customize them before adding. A pinned cart footer always communicates item count and the running subtotal, while retaining a path to checkout for the next workflow.

The unclaimed branch remains the spec 2 setup screen. The root session gate and `KioskShell` are reused without changing their cookie or server-function behavior.

## User experience

The claimed branch renders a fixed-height `KioskShell` with:

1. A header identifying Warm & Melted and the claimed kiosk.
2. A scrollable menu area with a heading, an always-visible search field, and horizontally scrollable category pills. The first category is selected initially. Choosing a category filters the visible product cards; a search query filters the already-fetched menu across product name, description, and category name. Search results preserve the server's category/product order and make the active category filter explicit.
3. Product cards on the paper background. Each card has an opaque image placeholder when `imageUrl` is absent, product name, optional description, and a real currency price. Cards are large touch targets. Tapping a product with no variant or addon groups adds it immediately; tapping a product with options opens the customization sheet.
4. A bottom-sheet customization drawer with an opaque backdrop, focusable close control, selected product details, one required radio-style option for each variant group, and checkbox-style addons. Variant and addon constraints come from the menu response (`minSelections`/`maxSelections`); the Add to order action remains disabled until required/minimum selections are met and never allows a group over its maximum. Successful add closes the sheet and returns focus to the product trigger.
5. A pinned bottom bar that always shows `N items` and the running subtotal. An icon-only cart toggle button (outline when idle, inverted/filled when the cart-details screen is active) opens a dedicated full-screen order-details view that takes over from the menu, listing each line's product/customization summary, line total, and a Remove action; the same toggle closes it and returns to the menu. Removing a line updates the count and subtotal immediately. The checkout action is present as a disabled/non-navigating affordance until spec 4 supplies its server flow.

Copy uses sentence case, no emoji, and no upsell language. Loading, empty-search, and menu failure states remain inside the shell and give the customer a clear next action (retry for failure, clear search for no results).

## Architecture

`src/routes/index.tsx` keeps the session query and gate. Once a session exists it renders a focused menu screen component; the unclaimed branch still renders `KioskClaimScreen`.

`src/lib/menu.ts` is the temporary frontend-facing adapter. It exports the stable `Menu` type and a named `getMenu` `createServerFn({ method: "GET" })` with no arguments. Its deterministic in-memory fixture mirrors the backend contract until the backend module is merged. The route calls this function only through TanStack Query (`useQuery`); no raw REST request is introduced. Replacing the adapter's implementation/import with the backend `getMenu` is a one-line boundary swap with no component changes.

Menu state is server state and is kept in a query keyed by `["menu"]`. Search text, selected category, selected product, drawer open state, and cart state are local UI state. The cart is a small reducer in `src/lib/cart.ts`, so rendering and interaction code do not duplicate cent math. Visible products are derived from the query result rather than copied into state; deterministic category/product order from `getMenu()` is retained.

The customization sheet is plain React and token classes (no new UI dependency). It uses an opaque backdrop and a bottom-sheet surface inside the existing shell; an effect focuses the sheet heading/close control when opened and restores focus to the originating product trigger when closed. Escape and backdrop dismissal close the sheet without adding a line. Selection updates stay local until Add to order succeeds.

## Cart model and money

Cart lines use a stable generated line ID and retain an immutable snapshot of the selected product/customization needed for display and future checkout mapping:

- product and category IDs, product name, and base price cents;
- selected variant group/option IDs, names, and `priceDeltaCents` values;
- selected addon group/addon IDs, names, and `priceDeltaCents` values;
- computed `unitPriceCents` and line quantity (initially one).

For this workflow, each tap creates a separate line, even when the same product/customization is added again; this keeps Remove deterministic and avoids an unrequested quantity editor. The reducer computes each line's unit price as `basePriceCents + sum(variant deltas) + sum(addon deltas)` and the cart subtotal as the integer sum of line unit prices. No floating-point arithmetic is used for cart state or comparisons. Currency is formatted only at the presentation boundary with `Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })`, converting cents to dollars for display exactly once.

## States and validation

The menu query has explicit loading, successful, empty, and error states. A successful empty menu explains that no products are available; an error shows a retry action through TanStack Query. Search with no matches shows the query and a clear-search action without changing the selected category.

A product with no option groups bypasses the drawer. A product with variants/addons opens the drawer with no implicit selections; required variant groups must be selected by the customer. Add-to-order validation checks every group before dispatching an add action:

- variant groups require exactly one selection when `minSelections` is 1 (the backend contract's one-selection example);
- addon groups enforce their minimum and maximum, including zero as a valid minimum;
- an option cannot be selected twice and a group cannot exceed its maximum.

Validation text is shown beside the group and announced through the dialog's live status. Pending additions disable the submit action to prevent duplicate taps. Removing a cart line is immediate and does not alter menu query data.

## Accessibility and visual language

Use Inter for all text and numbers, existing spec 1 tokens, and Lucide 2px-stroke icons. All controls are at least 48px high with visible `:focus-visible` rings. Category pills are real buttons with `aria-pressed`; the search input has a visible label; product cards are buttons with names that include the product and price. The drawer has `role="dialog"`, an accessible title, `aria-modal="true"`, labelled option groups, keyboard Escape handling, and focus restoration. Backdrop dismissal is supplemental rather than the only close path. Loading/error updates use `aria-live` without stealing focus. Green is reserved for the primary action and selected state; menu cards use white surfaces and soft shadows on the paper background.

## Verification

The first implementation test is a failing Playwright test in `e2e/browser/menu-cart.spec.ts` that claims the fixture kiosk, loads the menu, directly adds a product with no options, opens a product with variants/addons, completes customization and adds it, verifies footer count/subtotal, opens cart details, removes one line, and verifies the count/subtotal decreases. The test uses accessible names and visible behavior rather than implementation details.

Colocated unit tests in `src/lib/cart.test.ts` cover adding direct and customized lines, integer subtotal calculation with positive and negative option deltas, and removing a specific line. After the red browser test, implementation proceeds to green, followed by the repository lint, format, typecheck, unit, build, and full browser-e2e checks.
