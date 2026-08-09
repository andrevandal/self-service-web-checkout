# Menu browse and cart build UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the claimed kiosk placeholder with a client-filtered menu, option-selection drawer, and cent-accurate local cart whose pinned footer supports adding and removing lines.

**Architecture:** Keep the root route's existing `getKioskSession()` gate and render a `MenuScreen` only in the claimed branch. Add a temporary `getMenu` server-function adapter with the stable backend `Menu` shape, then make `MenuScreen` query it once and derive search/category results locally. Keep cart state in a focused reducer module and keep product-option UI in a plain React bottom-sheet drawer using the existing KioskShell tokens.

**Tech Stack:** React 19, TanStack Router/Query, TanStack Start `createServerFn`, Tailwind v4 token classes, Lucide React, Playwright, Bun test.

## Global Constraints

- Every cross-layer call is a named `createServerFn` invoked through TanStack Query; no raw REST requests.
- `getMenu(): Promise<Menu>` is a `createServerFn({ method: "GET" })` with no parameters and returns active, deterministically ordered categories/products/options with integer cents.
- The menu is the default resting state after a valid kiosk session; do not add an idle/attract screen.
- Search is always available and filters the already-fetched menu client-side; preserve server category/product order.
- Product cards add directly when both option-group arrays are empty; products with options require the customization sheet.
- Cart state and comparisons use integer cents only. Format currency at render time with `Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })`.
- Reuse `KioskShell`, spec 1 tokens, Lucide 2px-stroke icons, and Inter for every UI face and number. Do not add Base UI or another dependency.
- Touch controls are at least 48px tall, use sentence case, and expose accessible labels, focus rings, dialog semantics, Escape close, and focus restoration.
- Write the browser test before implementation, run it red, implement until green, then backfill colocated cart reducer tests.
- Skip project-wide lint, format, typecheck, unit, and e2e commands until implementation is complete; run the full required checks once at the end.

## File map

- Create `e2e/browser/menu-cart.spec.ts`: browser contract for direct add, customized add, footer subtotal/count, cart detail removal, and subtotal decrease.
- Create `src/lib/menu.ts`: temporary deterministic `Menu` types, fixture payload, and named `getMenu` server function matching the backend signature.
- Create `src/lib/cart.ts`: pure cart line types, cent-price calculation, reducer, and subtotal selectors.
- Create `src/components/menu-screen.tsx`: menu query orchestration, search/category derivation, product cards, cart footer/detail panel, and drawer state.
- Create `src/components/customization-drawer.tsx`: controlled option-selection sheet with group constraints, dialog accessibility, validation, and focus lifecycle.
- Create `src/lib/cart.test.ts`: focused reducer tests for adding/removing and positive/negative deltas.
- Modify `src/routes/index.tsx`: replace claimed placeholder markup with `MenuScreen` while retaining the session gate and kiosk header identity.

## Task 1: Define the red browser contract

**Files:**
- Create: `e2e/browser/menu-cart.spec.ts`
- Reuse: `e2e/browser/kiosk-claim-helpers.ts`

**Interfaces:**
- Consumes the existing `claimFixtureKiosk(page)` helper and user-visible route behavior.
- Produces a failing Playwright contract that the menu implementation must satisfy.

- [ ] **Step 1: Write the failing end-to-end test**

Use fixture product names that the eventual adapter must expose: `Classic cheese toastie` (direct add, `$6.50`) and `Melted mushroom toastie` (variant/addon customization, base `$8.50`). Assert user-visible semantics rather than implementation selectors:

```ts
import { expect, test } from "@playwright/test";
import { claimFixtureKiosk } from "./kiosk-claim-helpers";

test("browses, customizes, and removes menu items", async ({ page }) => {
  await claimFixtureKiosk(page);

  await expect(page.getByRole("heading", { name: "Menu" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Toasties" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search menu" })).toBeVisible();
  await expect(page.getByText("0 items")).toBeVisible();
  await expect(page.getByText("$0.00")).toBeVisible();

  await page.getByRole("button", { name: /Classic cheese toastie.*\$6\.50/ }).click();
  await expect(page.getByText("1 item")).toBeVisible();
  await expect(page.getByText("$6.50")).toBeVisible();

  await page.getByRole("button", { name: /Melted mushroom toastie.*\$8\.50/ }).click();
  const drawer = page.getByRole("dialog", { name: "Customize melted mushroom toastie" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("radio", { name: /Sourdough/ }).check();
  await drawer.getByRole("checkbox", { name: /Extra cheese/ }).check();
  await drawer.getByRole("button", { name: "Add to order" }).click();

  await expect(page.getByText("2 items")).toBeVisible();
  await expect(page.getByText("$16.00")).toBeVisible();

  await page.getByRole("button", { name: "View cart" }).click();
  await expect(page.getByRole("region", { name: "Cart details" })).toBeVisible();
  await page.getByRole("button", { name: "Remove Classic cheese toastie" }).click();

  await expect(page.getByText("1 item")).toBeVisible();
  await expect(page.getByText("$9.50")).toBeVisible();
});
```

The test intentionally targets the current claimed placeholder, which has no `Menu` heading, menu fixture cards, or cart count, so it must fail before implementation.

- [ ] **Step 2: Run the browser test and verify it is red**

Run from `kiosk-ui`:

```bash
bun run build && bunx playwright test e2e/browser/menu-cart.spec.ts
```

Expected: FAIL on the first menu assertion because the existing claimed branch still renders `Self-service web checkout` and the static preview. Do not change production code to make this first run pass.

- [ ] **Step 3: Commit the red test**

```bash
git add e2e/browser/menu-cart.spec.ts
git commit -m "test(menu-cart): define browse and cart browser flow"
```

## Task 2: Implement the menu adapter and pure cart core

**Files:**
- Create: `src/lib/menu.ts`
- Create: `src/lib/cart.ts`

**Interfaces:**
- `menu.ts` produces exported `Menu`, `MenuCategory`, `MenuProduct`, `MenuVariantGroup`, `MenuVariantOption`, `MenuAddonGroup`, and `MenuAddon` types plus `getMenu(): Promise<Menu>` from a no-argument GET server function.
- `cart.ts` consumes those option fields and produces `CartLine`, `CartLineInput`, `CartAction`, `CartState`, `cartReducer`, `linePriceCents`, and `subtotalCents` for the UI and later checkout mapping.

- [ ] **Step 1: Add the stable menu types and deterministic fixture**

Define the exact backend-compatible nested shape:

```ts
export type MenuVariantOption = {
  id: string;
  variantGroupId: string;
  slug: string;
  name: string;
  priceDeltaCents: number;
  isDefault: boolean;
};

export type MenuVariantGroup = {
  id: string;
  productId: string;
  slug: string;
  name: string;
  minSelections: number;
  maxSelections: number;
  options: MenuVariantOption[];
};

export type MenuAddon = {
  id: string;
  addonGroupId: string;
  slug: string;
  name: string;
  priceDeltaCents: number;
};

export type MenuAddonGroup = {
  id: string;
  productId: string;
  slug: string;
  name: string;
  minSelections: number;
  maxSelections: number | null;
  addons: MenuAddon[];
};

export type MenuProduct = {
  id: string;
  categoryId: string;
  slug: string;
  name: string;
  description: string | null;
  basePriceCents: number;
  imageUrl: string | null;
  variantGroups: MenuVariantGroup[];
  addonGroups: MenuAddonGroup[];
};

export type MenuCategory = {
  id: string;
  slug: string;
  name: string;
  displayOrder: number;
  products: MenuProduct[];
};

export type Menu = { categories: MenuCategory[] };
```

Export `getMenu` as `createServerFn({ method: "GET" }).handler(() => menuFixture)`. The fixture must contain ordered `Toasties` and `Sides` categories, direct-add `Classic cheese toastie` at 650 cents, and customized `Melted mushroom toastie` at 850 cents with a required `Bread` variant (`Sourdough` 0, `Rye` 50) and optional `Extras` addons (`Extra cheese` 100, `Hot honey` 75). Keep all IDs/slugs stable and return a new top-level object only if the adapter needs to protect fixture data from mutation. This module is intentionally the one-line import seam for the eventual backend `#/lib/catalog.functions` function.

- [ ] **Step 2: Add cart line snapshots and reducer**

Use immutable snapshots so future menu changes cannot change an existing cart line:

```ts
export type CartVariantSelection = {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  priceDeltaCents: number;
};

export type CartAddonSelection = {
  groupId: string;
  groupName: string;
  addonId: string;
  addonName: string;
  priceDeltaCents: number;
};

export type CartLineInput = {
  productId: string;
  categoryId: string;
  productName: string;
  basePriceCents: number;
  variants: CartVariantSelection[];
  addons: CartAddonSelection[];
};

export type CartLine = CartLineInput & { id: string; unitPriceCents: number };
export type CartState = CartLine[];
export type CartAction =
  | { type: "add"; item: CartLineInput; lineId?: string }
  | { type: "remove"; lineId: string };
```

`linePriceCents(item)` returns the base plus all variant/addon deltas. `cartReducer` appends a new line on `add` (using the supplied `lineId` in tests or `crypto.randomUUID()` in the browser), filters exactly one ID on `remove`, and returns the existing state for an unknown removal. `subtotalCents(lines)` reduces integer `unitPriceCents` values. No reducer path converts cents to floating-point dollars.

- [ ] **Step 3: Run a focused type check on the new modules**

Run:

```bash
bunx tsc --noEmit
```

Expected: the new menu/cart modules typecheck; existing route assertions may still be unchanged because Task 3 wires them in. Fix only errors caused by these two modules before continuing.

- [ ] **Step 4: Commit the adapter and cart core**

```bash
git add src/lib/menu.ts src/lib/cart.ts
git commit -m "feat(menu-cart): add menu adapter and cent cart reducer"
```

## Task 3: Build the claimed menu screen and customization drawer

**Files:**
- Create: `src/components/menu-screen.tsx`
- Create: `src/components/customization-drawer.tsx`
- Modify: `src/routes/index.tsx`

**Interfaces:**
- `MenuScreen` receives `{ kioskName: string }` and owns query/UI/cart state for the claimed branch.
- `CustomizationDrawer` receives `{ product: MenuProduct; open: boolean; onOpenChange(open: boolean): void; onAdd(item: CartLineInput): void; }` and reports only validated snapshots to `MenuScreen`.
- `MenuScreen` consumes `getMenu`, the cart reducer, and the fixture product shape; it produces the accessible behavior asserted by `menu-cart.spec.ts`.

- [ ] **Step 1: Implement query/loading/error/empty menu states**

In `MenuScreen`, call:

```ts
const menuQuery = useQuery({ queryKey: ["menu"], queryFn: () => getMenu() });
```

Render a `KioskShell` header with Warm & Melted, the kiosk name, and a menu content region. Show an `aria-live` loading message while pending, an error message plus a `Retry` button that calls `menuQuery.refetch()`, and an empty-menu message when `categories` contains no products. Keep the bottom bar rendered for every state with `0 items` and `$0.00` until a cart exists.

- [ ] **Step 2: Implement client-side search and category filtering**

Track `query` and `selectedCategoryId`. Initialize the selected category to the first category when menu data arrives. Render a labelled search input named `Search menu`, category buttons with `aria-pressed`, and product cards in the original category/product order. Match `query.trim().toLocaleLowerCase()` against product name, description (when non-null), or category name. A non-empty search spans all categories while retaining the current category pill as a visible selection; an empty result shows `No products found` and a `Clear search` button.

- [ ] **Step 3: Implement direct-add and customized product triggers**

Each product card is a 48px+ button whose accessible name includes product name and formatted base price. For products with no variant/addon groups, dispatch `cartReducer` `add` with empty snapshots immediately. For products with groups, set the selected product and open the drawer, retaining the clicked button in a ref for focus restoration. Use a stable presentation helper:

```ts
const formatCents = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
```

No other code path formats or stores dollars.

- [ ] **Step 4: Implement the customization sheet**

Use an in-tree `role="dialog"` with `aria-modal="true"`, an opaque backdrop, and a rounded top sheet. On open, focus the close button or heading; on Escape/backdrop click, call `onOpenChange(false)`; on close, focus the triggering product button. Render each variant group as a labelled fieldset of radio inputs and each addon group as a labelled fieldset of checkbox inputs. Store selected IDs in local records. Enforce `minSelections` and `maxSelections` before toggling. Show inline and `aria-live` errors for unmet minimums. Keep Add to order disabled until every group meets its minimum. On submit, map selected menu options to `CartLineInput` snapshots and call `onAdd`, then close the sheet.

A variant with `minSelections: 1` must have exactly one radio selection. Addon groups permit zero when `minSelections: 0`; `maxSelections: null` means no maximum. Do not infer a default selection in the drawer.

- [ ] **Step 5: Implement pinned cart footer and cart detail panel**

Pass the menu page body and footer to `KioskShell`. The footer always displays `0 items`/`$0.00` or singular/plural item count and the integer-derived formatted subtotal. `View cart` is disabled with an empty cart. With lines, it opens an opaque compact in-page panel/region named `Cart details`; each line shows product/customization names, line price, and `Remove <product name>` button. Removing dispatches `{ type: "remove", lineId }` and immediately updates count/subtotal. Keep the checkout/Pay affordance disabled until spec 4 wires its server function.

- [ ] **Step 6: Replace the claimed placeholder while preserving the session gate**

In `src/routes/index.tsx`, keep the existing `Route.useLoaderData()`, `useQuery(["kiosk-session"])`, and `if (!sessionQuery.data) return <KioskClaimScreen />;` branch. Replace only the current claimed `KioskShell` placeholder with `<MenuScreen kioskName={sessionQuery.data.name} />`. Remove placeholder heading/preview and hard-coded `$12.50`; do not change setup behavior.

- [ ] **Step 7: Run the focused browser test to make it green**

Run:

```bash
bun run build && bunx playwright test e2e/browser/menu-cart.spec.ts
```

Expected: PASS for direct add, drawer variant/addon add, footer count/subtotal, cart detail removal, and subtotal decrease. If a locator is ambiguous, fix accessible names/semantics in the UI rather than weakening assertions to implementation selectors.

- [ ] **Step 8: Commit the working UI**

```bash
git add src/components/menu-screen.tsx src/components/customization-drawer.tsx src/routes/index.tsx
git commit -m "feat(menu-cart): add browse customize and cart UI"
```

## Task 4: Backfill cart reducer tests

**Files:**
- Create: `src/lib/cart.test.ts`

**Interfaces:**
- Consumes the exported `CartLineInput`, `cartReducer`, `linePriceCents`, and `subtotalCents` from `src/lib/cart.ts`.
- Produces deterministic Bun tests that fail if line snapshots, delta math, or exact-ID removal regress.

- [ ] **Step 1: Add observable reducer tests**

Cover direct add, customized positive/negative deltas, subtotal across lines, and removing one exact line:

```ts
import { describe, expect, test } from "bun:test";
import { cartReducer, linePriceCents, subtotalCents, type CartLineInput } from "./cart";

const item = (overrides: Partial<CartLineInput> = {}): CartLineInput => ({
  productId: "toastie",
  categoryId: "toasties",
  productName: "Test toastie",
  basePriceCents: 850,
  variants: [],
  addons: [],
  ...overrides,
});

describe("cart reducer", () => {
  test("adds a direct product and computes a cent subtotal", () => {
    const state = cartReducer([], { type: "add", item: item(), lineId: "line-1" });
    expect(state).toHaveLength(1);
    expect(state[0]?.unitPriceCents).toBe(850);
    expect(subtotalCents(state)).toBe(850);
  });

  test("adds selected variant/addon deltas without floating point math", () => {
    const state = cartReducer([], {
      type: "add",
      lineId: "line-2",
      item: item({
        variants: [{ groupId: "size", groupName: "Size", optionId: "large", optionName: "Large", priceDeltaCents: 125 }],
        addons: [{ groupId: "extras", groupName: "Extras", addonId: "less", addonName: "Less sauce", priceDeltaCents: -25 }],
      }),
    });
    expect(linePriceCents(state[0]!)).toBe(950);
    expect(subtotalCents(state)).toBe(950);
  });

  test("removes exactly one line and recalculates subtotal", () => {
    const first = cartReducer([], { type: "add", item: item({ productId: "first" }), lineId: "line-1" });
    const both = cartReducer(first, { type: "add", item: item({ productId: "second", basePriceCents: 650 }), lineId: "line-2" });
    const remaining = cartReducer(both, { type: "remove", lineId: "line-1" });
    expect(remaining.map((line) => line.id)).toEqual(["line-2"]);
    expect(subtotalCents(remaining)).toBe(650);
  });
});
```

- [ ] **Step 2: Run the focused unit test**

Run:

```bash
bun test src/lib/cart.test.ts
```

Expected: PASS with three tests. The tests are colocated and do not launch the browser.

- [ ] **Step 3: Commit the backfill**

```bash
git add src/lib/cart.test.ts
git commit -m "test(menu-cart): cover cart cent math and removal"
```

## Task 5: Final verification and delivery

**Files:**
- Modify only files required by failing checks or formatting; keep the design and plan docs current if observable behavior changes.

- [ ] **Step 1: Run all required checks**

Run exactly:

```bash
bun run lint && bun run format && bun run typecheck && bun run test && bun run test:e2e
```

Expected: all commands exit 0. `test:e2e` runs migrations, builds, and the complete Playwright suite, including the new menu/cart flow and existing shell/setup flows.

- [ ] **Step 2: Inspect final status and diff summary**

Run:

```bash
git status --short && git log --oneline -8
```

Expected: only intentional committed menu-cart artifacts remain; no generated test output or untracked fixture files are part of the deliverable.

- [ ] **Step 3: Report completion to Main**

Send Main the design commit (`a53ede1`), plan commit, implementation/test commit IDs, the exact final check command, and its observed exit-0 result. Mention any backend import seam that still needs the one-line swap when BackendPlatform merges.
