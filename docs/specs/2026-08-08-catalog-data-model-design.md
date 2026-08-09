# Catalog data model design

## Contents

- [Goal and scope](#goal-and-scope)
- [Design decisions](#design-decisions)
- [Data model](#data-model)
- [Menu server function](#menu-server-function)
- [Seed strategy](#seed-strategy)
- [Testing and verification](#testing-and-verification)
- [Non-goals](#non-goals)

## Goal and scope

Add the catalog persistence model, repeatable Warm & Melted seed data, and one
read-only TanStack Start server function for the kiosk menu. The catalog model
covers categories, products, variant groups/options, and addon groups/addons.
This spec does not add cart validation, kiosk identity, orders, or inventory.

The product requirements are authoritative: menus contain active categories and
products with descriptions, images, and base prices; products may have exactly-
one variant groups and zero-or-more addon groups, with per-option price deltas.

## Design decisions

### Explicit relational queries

`getMenu()` uses independent Drizzle queries for each catalog table and assembles
the nested response in memory. This is preferred over one large join because it
keeps each relation explicit, avoids null-expanded rows for products without
customization, and is straightforward to test. SQLite JSON aggregation is not
used because it would couple the response to database-specific JSON behavior.

Queries apply the customer-facing availability rules at the data boundary:
active categories, available products, and active addons only. Variant groups
and options have no availability flag in the requirements, so all persisted
variant groups/options are returned. Empty active categories remain in the
response so category navigation is stable.

### Integer money

All persisted prices are integer cents. `base_price_cents` and
`price_delta_cents` are SQLite `INTEGER NOT NULL` columns, avoiding floating
point drift in this and the checkout spec. `getMenu()` also returns cents
(`basePriceCents` and `priceDeltaCents`) so all server-function math remains
exact and the UI can format currency at the presentation boundary.

### Stable ordering

Categories are ordered by `display_order`, then `id`. Products and every nested
group/option collection are ordered by `slug`, then `id`; the ordering is
explicit rather than relying on insertion order. Slugs are unique globally for
categories/products and scoped to their parent for variant groups/options and
addon groups/addons.

## Data model

The schema uses text UUID primary keys (UUIDv7 values are supplied by seed and
future domain code), camelCase Drizzle properties mapped to snake_case SQLite
columns, and foreign keys for every parent-child relationship. Child rows use
`ON DELETE CASCADE` so a catalog subtree cannot leave orphan customization
rows.

The tables and fields are:

- `categories`: `id`, globally unique `slug`, `name`, `displayOrder` (default
  `0`), and `isActive` (default `true`).
- `products`: `id`, `categoryId`, globally unique `slug`, `name`, nullable
  `description`, integer `basePriceCents`, nullable `imageUrl`, and
  `isAvailable` (default `true`).
- `variantGroups`: `id`, `productId`, scoped `slug`, `name`, `minSelections`
  (default `1`), and `maxSelections` (default `1`).
- `variantOptions`: `id`, `variantGroupId`, scoped `slug`, `name`, integer
  `priceDeltaCents` (default `0`), and `isDefault` (default `false`).
- `addonGroups`: `id`, `productId`, scoped `slug`, `name`, `minSelections`
  (default `0`), and nullable `maxSelections`.
- `addons`: `id`, `addonGroupId`, scoped `slug`, `name`, integer
  `priceDeltaCents` (default `0`), and `isActive` (default `true`).

Composite unique constraints enforce each parent-scoped slug. The schema also
keeps the selection bounds as data for the checkout validator; this spec does
not enforce the bounds with database `CHECK` constraints.

## Menu server function

The public boundary is a named server function, not an ad hoc REST endpoint:

```ts
export const getMenu = createServerFn({ method: "GET" }).handler(
  async (): Promise<Menu> => {
    // Read the active catalog and return its nested representation.
  },
);
```

It accepts no parameters and returns:

```ts
type Menu = {
  categories: Array<{
    id: string;
    slug: string;
    name: string;
    displayOrder: number;
    products: Array<{
      id: string;
      categoryId: string;
      slug: string;
      name: string;
      description: string | null;
      basePriceCents: number;
      imageUrl: string | null;
      variantGroups: Array<{
        id: string;
        productId: string;
        slug: string;
        name: string;
        minSelections: number;
        maxSelections: number;
        options: Array<{
          id: string;
          variantGroupId: string;
          slug: string;
          name: string;
          priceDeltaCents: number;
          isDefault: boolean;
        }>;
      }>;
      addonGroups: Array<{
        id: string;
        productId: string;
        slug: string;
        name: string;
        minSelections: number;
        maxSelections: number | null;
        addons: Array<{
          id: string;
          addonGroupId: string;
          slug: string;
          name: string;
          priceDeltaCents: number;
        }>;
      }>;
    }>;
  }>;
};
```

The response omits inactive categories, unavailable products, and inactive
addons. Since omitted addons are already filtered, their response objects do
not include an `isActive` property. Database errors propagate to the caller;
the function does not silently return an empty menu.

## Seed strategy

`scripts/seed.ts` inserts the exact Warm & Melted reference payload:

- Four active categories in display order: Coffee & Espresso, Refreshment &
  Hydration, Warm Savories, and Sweet Treats.
- Seven available products: Espresso, Latte, Cold Brew, Ham & Cheese Croissant,
  Everything Bagel, Fudge Brownie, and Chocolate Chip Cookie.
- Latte's `milk-selection` variant group with Whole, Oat, and Almond Milk
  options, plus its `coffee-addons` group with Extra Shot and Vanilla Syrup.
- Price values from the payload converted once to integer cents (for example,
  `$5.25` becomes `525` and `$0.80` becomes `80`).

The script is repeatable: it deletes the catalog subtree in child-to-parent
order inside one transaction, then inserts the fixed IDs and rows in dependency
order. It does not touch kiosks, orders, or payment tables owned by later
specs. The migration creates an empty catalog for deployments; seeding is an
explicit `bun run db:seed` operation.

## Testing and verification

The colocated catalog test creates an isolated `file::memory:` libSQL database,
creates the catalog tables, mocks `#/db/client.server` before importing the
module, and invokes its exported `loadMenu()` handler directly inside a mocked
TanStack Start context. `getMenu` remains the public
`createServerFn({ method: "GET" })` wrapper around that handler; using the
extracted handler keeps the plain Bun test independent of Start's compile-time
RPC transform. The first test version is written and run before the schema,
seed, and handler exist so it records a real red phase.

The passing assertions cover the observable contract: four seeded categories
and seven products, nested latte variant/addon data, integer-cent pricing,
required deterministic ordering, and exclusion of inactive/unavailable rows.
A seed test also proves repeatability without duplicate rows. The final repo
checks are run once after implementation:

```bash
bun run lint && bun run format && bun run typecheck && bun run test
```

## Non-goals

This spec does not implement stock or out-of-stock tracking, product search,
cart or checkout totals, menu administration, kiosk claiming, order snapshots,
or an HTTP `/api/*` menu endpoint. All reads cross the application boundary
through the named `getMenu` server function.
