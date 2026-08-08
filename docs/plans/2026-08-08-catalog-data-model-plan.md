# Catalog data model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the Warm & Melted catalog in Drizzle/SQLite, seed its four categories and seven products, and expose a typed `getMenu()` TanStack Start server function.

**Architecture:** Keep the existing `pings` table and health scaffold intact while adding six catalog tables to `src/db/schema.ts`. A repeatable `scripts/seed.ts` inserts fixed UUID rows in dependency order. `src/lib/catalog.functions.ts` owns the public `getMenu()` server-function boundary and assembles active catalog rows from explicit ordered Drizzle queries into a nested `Menu` response.

**Tech Stack:** Bun, TypeScript, TanStack Start `createServerFn`, Drizzle ORM/libSQL, SQLite, Drizzle Kit migrations, Bun tests.

## Global Constraints

- Persist all money as integer cents in `INTEGER NOT NULL` columns: `base_price_cents` and `price_delta_cents`.
- `getMenu()` accepts no parameters and returns `basePriceCents`/`priceDeltaCents`; no floating-point or dollar conversion occurs in the server contract.
- Return only active categories, available products under those categories, and active addons; return empty active categories and all variant groups/options.
- Order categories by `display_order, id`; order products and nested groups/options/addons by `slug, id`.
- Every cross-layer read uses the named `getMenu` `createServerFn`; do not add a menu REST endpoint.
- Child catalog rows reference parents with `ON DELETE CASCADE`; parent-scoped slugs use composite unique constraints.
- Begin with the colocated server-function test and run it red before writing schema, seed, or function implementation.
- Do not run repo-wide lint, format, typecheck, build, or full test checks until all implementation tasks are complete; run the required final check command once at the end.

---

## File map

- Modify: `src/db/schema.ts` — retain `pings`, add categories/products/variant groups/options/addon groups/addons.
- Create: `src/lib/catalog.functions.test.ts` — in-memory direct-call contract test for `getMenu()`; this is the first implementation artifact and must fail before the function exists.
- Create: `src/lib/catalog.functions.ts` — exported `Menu` type and `getMenu` server function.
- Modify: `scripts/seed.ts` — replace ping-only seed behavior with repeatable catalog seeding while retaining the CLI entrypoint.
- Modify: `scripts/seed.test.ts` — test catalog counts and repeatability instead of the obsolete ping-only behavior.
- Generate: `drizzle/0001_*.sql` and matching `drizzle/meta/*` — migration and snapshot produced by Drizzle Kit after schema changes.
- Create: no route files — the catalog boundary is a server function, not `/api/menu`.

### Task 1: Write the failing `getMenu()` test

**Files:**
- Create: `src/lib/catalog.functions.test.ts`

**Interfaces:**
- Consumes: the future `loadMenu(): Promise<Menu>` extracted handler and public `getMenu` `createServerFn` wrapper from `#/lib/catalog.functions`.
- Produces: the executable nested response assertions that define the contract for later implementation.

- [ ] **Step 1: Create an isolated database and mock the server client**

Create a `file::memory:` database with `createDatabase`, create the six catalog tables with raw SQL, and mock `#/db/client.server` before importing `loadMenu`. The setup must include the production column names and foreign keys, including integer-cent columns and boolean integer columns:

```ts
import { expect, mock, test } from "bun:test";
import { sql } from "drizzle-orm";
import { createDatabase } from "#/db/client";

const db = createDatabase("file::memory:");
await db.run(sql`PRAGMA foreign_keys = ON`);
await db.run(sql`CREATE TABLE categories (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
)`);
await db.run(sql`CREATE TABLE products (
  id TEXT PRIMARY KEY NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  base_price_cents INTEGER NOT NULL,
  image_url TEXT,
  is_available INTEGER NOT NULL DEFAULT 1
)`);
await db.run(sql`CREATE TABLE variant_groups (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  min_selections INTEGER NOT NULL DEFAULT 1,
  max_selections INTEGER NOT NULL DEFAULT 1,
  UNIQUE(product_id, slug)
)`);
await db.run(sql`CREATE TABLE variant_options (
  id TEXT PRIMARY KEY NOT NULL,
  variant_group_id TEXT NOT NULL REFERENCES variant_groups(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  price_delta_cents INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  UNIQUE(variant_group_id, slug)
)`);
await db.run(sql`CREATE TABLE addon_groups (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  min_selections INTEGER NOT NULL DEFAULT 0,
  max_selections INTEGER,
  UNIQUE(product_id, slug)
)`);
await db.run(sql`CREATE TABLE addons (
  id TEXT PRIMARY KEY NOT NULL,
  addon_group_id TEXT NOT NULL REFERENCES addon_groups(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  price_delta_cents INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(addon_group_id, slug)
)`);

mock.module("#/db/client.server", () => ({ db }));
const { loadMenu } = await import("./catalog.functions");
```

- [ ] **Step 2: Insert fixture rows for availability, nesting, and ordering**

Insert two active categories (`coffee` with display order `1`, `tea` with display order `2`) and one inactive category. Insert products whose slugs deliberately differ from insertion order, plus one unavailable product and one product under the inactive category. Insert one variant group with two options and one addon group with one active and one inactive addon. Include an active category with no products so the test proves empty categories survive.

- [ ] **Step 3: Assert the direct server-function contract**

Call `await loadMenu()` inside the mocked Start context and assert the exact observable shape. The Bun test executes the extracted handler directly because the Start compiler's RPC transform is not active under plain `bun test`:

```ts
const menu = await loadMenu();
expect(menu.categories.map(({ slug }) => slug)).toEqual(["coffee", "tea"]);
expect(menu.categories[0]?.products.map(({ slug }) => slug)).toEqual(["latte", "mocha"]);
expect(menu.categories[0]?.products[0]).toMatchObject({
  basePriceCents: 525,
  description: "Smooth espresso",
  variantGroups: [
    expect.objectContaining({
      slug: "milk-selection",
      options: [expect.objectContaining({ slug: "whole-milk", priceDeltaCents: 0 })],
    }),
  ],
  addonGroups: [
    expect.objectContaining({
      slug: "coffee-addons",
      addons: [expect.objectContaining({ slug: "extra-shot", priceDeltaCents: 100 })],
    }),
  ],
});
expect(menu.categories[1]?.products).toEqual([]);
expect(JSON.stringify(menu)).not.toContain("inactive-addon");
```

Also assert no unavailable product or inactive-category product is present and that a negative price delta remains an integer if the fixture includes one.

- [ ] **Step 4: Run the test and verify a real red phase**

Run:

```bash
bun test src/lib/catalog.functions.test.ts
```

Expected: FAIL because `./catalog.functions` does not exist yet. Do not add a stub or suppress the failure; continue to schema implementation only after recording this red result.

### Task 2: Add the Drizzle catalog schema

**Files:**
- Modify: `src/db/schema.ts`

**Interfaces:**
- Consumes: existing `pings` table and `sqlite-core` imports.
- Produces: typed `categories`, `products`, `variantGroups`, `variantOptions`, `addonGroups`, and `addons` exports used by the server function and seed script.

- [ ] **Step 1: Add the required SQLite imports and table declarations**

Retain `pings`. Add `text`, `integer`, and `unique` imports and define these declarations with camelCase properties and snake_case columns:

```ts
export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    displayOrder: integer("display_order").notNull().default(0),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  },
);

export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  categoryId: text("category_id").notNull().references(() => categories.id, { onDelete: "cascade" }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  basePriceCents: integer("base_price_cents").notNull(),
  imageUrl: text("image_url"),
  isAvailable: integer("is_available", { mode: "boolean" }).notNull().default(true),
});
```

Use the same pattern for the four child tables. Their required fields are:

```ts
export const variantGroups = sqliteTable("variant_groups", {
  id: text("id").primaryKey(),
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  minSelections: integer("min_selections").notNull().default(1),
  maxSelections: integer("max_selections").notNull().default(1),
}, (table) => [unique().on(table.productId, table.slug)]);

export const variantOptions = sqliteTable("variant_options", {
  id: text("id").primaryKey(),
  variantGroupId: text("variant_group_id").notNull().references(() => variantGroups.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  priceDeltaCents: integer("price_delta_cents").notNull().default(0),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
}, (table) => [unique().on(table.variantGroupId, table.slug)]);

export const addonGroups = sqliteTable("addon_groups", {
  id: text("id").primaryKey(),
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  minSelections: integer("min_selections").notNull().default(0),
  maxSelections: integer("max_selections"),
}, (table) => [unique().on(table.productId, table.slug)]);

export const addons = sqliteTable("addons", {
  id: text("id").primaryKey(),
  addonGroupId: text("addon_group_id").notNull().references(() => addonGroups.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  priceDeltaCents: integer("price_delta_cents").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
}, (table) => [unique().on(table.addonGroupId, table.slug)]);
```

- [ ] **Step 2: Generate the migration from the schema**

Run:

```bash
bun run db:generate
```

Expected: a new migration under `drizzle/` creates the six catalog tables and their unique constraints/foreign keys without replacing the existing `pings` migration. Inspect the generated SQL and confirm every price column is `integer NOT NULL`, every child foreign key has `ON DELETE CASCADE`, and the generated metadata files are present.

### Task 3: Implement repeatable catalog seed data

**Files:**
- Modify: `scripts/seed.ts`
- Modify: `scripts/seed.test.ts`

**Interfaces:**
- Consumes: `createDatabase(url)` and the catalog table exports.
- Produces: `seed(url: string): Promise<{ categories: number; products: number }>` and a CLI that logs the inserted catalog counts.

- [ ] **Step 1: Define fixed typed seed rows in dependency order**

Keep the payload in `scripts/seed.ts` as typed constants. Use the exact fixed UUIDs, slugs, names, descriptions, image URLs, category order, availability flags, and relationships from `references.md`. Convert decimal payload prices to cents in the constants:

```ts
const categoriesSeed = [
  { id: "01912a30-0001-7000-8000-000000000001", slug: "coffee-espresso", name: "Coffee & Espresso", displayOrder: 1, isActive: true },
  { id: "01912a30-0001-7000-8000-000000000002", slug: "refreshment-hydration", name: "Refreshment & Hydration", displayOrder: 2, isActive: true },
  { id: "01912a30-0001-7000-8000-000000000003", slug: "warm-savories", name: "Warm Savories", displayOrder: 3, isActive: true },
  { id: "01912a30-0001-7000-8000-000000000004", slug: "sweet-treats", name: "Sweet Treats", displayOrder: 4, isActive: true },
] as const;
```

The complete seed constants must include all seven products, Latte's three milk options (`0`, `80`, `80` cents), and its two active addons (`100`, `75` cents). Do not add products or customization rows outside the reference payload.

- [ ] **Step 2: Make `seed(url)` clear and repopulate only the catalog**

Create the database from the supplied URL. In one transaction, delete `addons`, `addonGroups`, `variantOptions`, `variantGroups`, `products`, and `categories` in child-to-parent order, then insert categories, products, variant groups, variant options, addon groups, and addons in parent-to-child order. Return `{ categories: 4, products: 7 }` from the completed seed. Do not delete or insert `pings`, kiosks, orders, or payment rows.

- [ ] **Step 3: Update the seed test to prove repeatability**

Replace the ping-only assertion with an in-memory catalog setup using the generated migration SQL (or equivalent DDL), call `seed(url)` twice, and assert both calls return four categories/seven products. Query counts after the second call and assert exactly four category rows, seven product rows, one variant group, three variant options, one addon group, and two addon rows. This catches duplicate inserts and incomplete clearing.

- [ ] **Step 4: Verify the seed test narrowly**

Run:

```bash
bun test scripts/seed.test.ts
```

Expected: PASS after the schema and seed implementation are present, with no duplicate rows after the second seed invocation.

### Task 4: Implement `Menu` and `getMenu()`

**Files:**
- Create: `src/lib/catalog.functions.ts`
- Modify: `src/lib/catalog.functions.test.ts`

**Interfaces:**
- Consumes: catalog table exports, `db` from `#/db/client.server`, and the Task 1 fixture contract.
- Produces: `export type Menu`, `export const loadMenu = async (): Promise<Menu>`, and `export const getMenu = createServerFn({ method: "GET" }).handler(loadMenu)`.

- [ ] **Step 1: Declare the exact serializable `Menu` response type**

Use the approved response shape, preserving integer cents and nullability:

```ts
export type Menu = {
  categories: Array<{
    id: string; slug: string; name: string; displayOrder: number;
    products: Array<{
      id: string; categoryId: string; slug: string; name: string;
      description: string | null; basePriceCents: number; imageUrl: string | null;
      variantGroups: Array<{
        id: string; productId: string; slug: string; name: string;
        minSelections: number; maxSelections: number;
        options: Array<{
          id: string; variantGroupId: string; slug: string; name: string;
          priceDeltaCents: number; isDefault: boolean;
        }>;
      }>;
      addonGroups: Array<{
        id: string; productId: string; slug: string; name: string;
        minSelections: number; maxSelections: number | null;
        addons: Array<{ id: string; addonGroupId: string; slug: string; name: string; priceDeltaCents: number }>;
      }>;
    }>;
  }>;
};
```

- [ ] **Step 2: Query only visible parent rows in explicit order**

Inside the server-function handler, query active categories ordered by `asc(categories.displayOrder), asc(categories.id)`. If there are none, return `{ categories: [] }`. Query available products whose `categoryId` is in the active category IDs, ordered by `asc(products.slug), asc(products.id)`. If there are no visible products, return the categories with empty product arrays.

Then query all variant groups for visible products ordered by `slug, id`, all variant options for those groups ordered by `slug, id`, all addon groups for visible products ordered by `slug, id`, and active addons for those groups ordered by `slug, id`. Use Drizzle `and`, `eq`, `inArray`, and `asc`; preserve database errors by allowing them to throw.

- [ ] **Step 3: Assemble nested maps without mutating database rows**

Group options by `variantGroupId`, addons by `addonGroupId`, groups by `productId`, and products by `categoryId`. Map each category to a new serializable object. Map each visible product to its own nested arrays, defaulting to `[]` when no group exists. Do not expose `isActive` for addons because inactive rows were filtered before assembly.

- [ ] **Step 4: Run the focused test green**

Run:

```bash
bun test src/lib/catalog.functions.test.ts
```

Expected: PASS for active/available filtering, empty active categories, deterministic ordering, exact integer-cent values, and variant/addon nesting. If the test fails, fix the implementation at the query or assembly boundary rather than weakening assertions.

- [ ] **Step 5: Refactor only after green**

Review the function for duplicate map-building logic, accidental response fields, and unnecessary copies. Keep one readable handler and small local grouping helpers only if they remove repeated code. Re-run the two focused tests after the refactor:

```bash
bun test src/lib/catalog.functions.test.ts scripts/seed.test.ts
```

### Task 5: Lock and communicate the frontend boundary

**Files:**
- No source files unless the focused tests require a contract correction.

**Interfaces:**
- Produces: the stable `getMenu()` signature for `KioskUi`.

- [ ] **Step 1: Send the exact signature to `KioskUi`**

Send a concise `hub` message naming the import and the complete response contract:

```text
import { getMenu, type Menu } from "#/lib/catalog.functions";
getMenu(): Promise<Menu>; // createServerFn({ method: "GET" }), no params
Menu = { categories: [{ id, slug, name, displayOrder, products: [{ id, categoryId, slug, name, description, basePriceCents, imageUrl, variantGroups: [{ id, productId, slug, name, minSelections, maxSelections, options: [{ id, variantGroupId, slug, name, priceDeltaCents, isDefault }] }], addonGroups: [{ id, productId, slug, name, minSelections, maxSelections, addons: [{ id, addonGroupId, slug, name, priceDeltaCents }] }] }] }] }
```

State that the result excludes inactive categories, unavailable products, and inactive addons; categories/products/group collections have deterministic ordering; prices are integer cents.

- [ ] **Step 2: Confirm no ad hoc menu route exists**

Search `src/routes` for menu API handlers and remove none; the only new public boundary must remain the named server function.

### Task 6: Run final checks and commit implementation

**Files:**
- All implementation files from Tasks 2–4 plus generated migration metadata.

- [ ] **Step 1: Run the required repository checks once**

Run exactly:

```bash
bun run lint && bun run format && bun run typecheck && bun run test
```

Expected: every command exits zero. If format modifies files, inspect the diff, rerun the command as needed until it exits zero, then rerun any directly affected focused test before committing.

- [ ] **Step 2: Review the implementation diff and status**

Confirm the diff contains only the catalog schema/migration, seed, `getMenu()` function/test, updated seed test, and the already committed docs are clean. Confirm no files in the sibling `kiosk-ui` worktree or `main` were touched.

- [ ] **Step 3: Commit the implementation**

```bash
git add src/db/schema.ts src/lib/catalog.functions.ts src/lib/catalog.functions.test.ts scripts/seed.ts scripts/seed.test.ts drizzle
git commit -m "feat(catalog): add menu schema and server function"
```

Expected: a Conventional Commit with the `catalog` scope and passing staged-file hooks.
