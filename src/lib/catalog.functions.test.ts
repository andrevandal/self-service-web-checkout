import { expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { createTestDatabase, mockDatabaseModule, withStartContext } from "#/test/db-test-support";

const db = await createTestDatabase();

await db.run(sql`INSERT INTO categories (id, slug, name, display_order, is_active)
  VALUES
    ('category-tea', 'tea', 'Tea', 2, 1),
    ('category-coffee', 'coffee', 'Coffee', 1, 1),
    ('category-hidden', 'hidden', 'Hidden', 3, 0)`);
await db.run(sql`INSERT INTO products
    (id, category_id, slug, name, description, base_price_cents, image_url, is_available)
  VALUES
    ('product-mocha', 'category-coffee', 'mocha', 'Mocha', 'Chocolate espresso', 600, NULL, 1),
    ('product-latte', 'category-coffee', 'latte', 'Latte', 'Smooth espresso', 525, 'latte.jpg', 1),
    ('product-unavailable', 'category-coffee', 'unavailable', 'Unavailable', NULL, 100, NULL, 0),
    ('product-hidden', 'category-hidden', 'hidden-product', 'Hidden product', NULL, 100, NULL, 1)`);
await db.run(sql`INSERT INTO variant_groups
    (id, product_id, slug, name, min_selections, max_selections)
  VALUES ('variant-milk', 'product-latte', 'milk-selection', 'Select Milk', 1, 1)`);
await db.run(sql`INSERT INTO variant_options
    (id, variant_group_id, slug, name, price_delta_cents, is_default)
  VALUES
    ('variant-oat', 'variant-milk', 'oat-milk', 'Oat Milk', 80, 0),
    ('variant-whole', 'variant-milk', 'whole-milk', 'Whole Milk', 0, 1)`);
await db.run(sql`INSERT INTO addon_groups
    (id, product_id, slug, name, min_selections, max_selections)
  VALUES ('addon-group-coffee', 'product-latte', 'coffee-addons', 'Add-ons', 0, NULL)`);
await db.run(sql`INSERT INTO addons
    (id, addon_group_id, slug, name, price_delta_cents, is_active)
  VALUES
    ('addon-extra-shot', 'addon-group-coffee', 'extra-shot', 'Extra Shot', 100, 1),
    ('addon-inactive', 'addon-group-coffee', 'inactive-addon', 'Inactive Add-on', 200, 0)`);

mockDatabaseModule(db);
const { loadMenu } = await import("./catalog.functions");

test("getMenu returns the active catalog in a nested deterministic shape", async () => {
  const menu = await withStartContext(() => loadMenu());

  expect(menu.categories.map(({ slug }) => slug)).toEqual(["coffee", "tea"]);
  expect(menu.categories[0]?.products.map(({ slug }) => slug)).toEqual(["latte", "mocha"]);
  expect(menu.categories[1]?.products).toEqual([]);

  const latte = menu.categories[0]?.products[0];
  expect(latte).toMatchObject({
    id: "product-latte",
    categoryId: "category-coffee",
    basePriceCents: 525,
    description: "Smooth espresso",
    imageUrl: "latte.jpg",
    variantGroups: [
      {
        id: "variant-milk",
        productId: "product-latte",
        slug: "milk-selection",
        name: "Select Milk",
        minSelections: 1,
        maxSelections: 1,
        options: [
          {
            id: "variant-oat",
            variantGroupId: "variant-milk",
            slug: "oat-milk",
            name: "Oat Milk",
            priceDeltaCents: 80,
            isDefault: false,
          },
          {
            id: "variant-whole",
            variantGroupId: "variant-milk",
            slug: "whole-milk",
            name: "Whole Milk",
            priceDeltaCents: 0,
            isDefault: true,
          },
        ],
      },
    ],
    addonGroups: [
      {
        id: "addon-group-coffee",
        productId: "product-latte",
        slug: "coffee-addons",
        name: "Add-ons",
        minSelections: 0,
        maxSelections: null,
        addons: [
          {
            id: "addon-extra-shot",
            addonGroupId: "addon-group-coffee",
            slug: "extra-shot",
            name: "Extra Shot",
            priceDeltaCents: 100,
          },
        ],
      },
    ],
  });

  expect(JSON.stringify(menu)).not.toContain("unavailable");
  expect(JSON.stringify(menu)).not.toContain("hidden-product");
  expect(JSON.stringify(menu)).not.toContain("inactive-addon");
});
