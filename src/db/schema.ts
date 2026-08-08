import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  categoryId: text("category_id")
    .notNull()
    .references(() => categories.id, { onDelete: "cascade" }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  basePriceCents: integer("base_price_cents").notNull(),
  imageUrl: text("image_url"),
  isAvailable: integer("is_available", { mode: "boolean" }).notNull().default(true),
});

export const variantGroups = sqliteTable(
  "variant_groups",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    minSelections: integer("min_selections").notNull().default(1),
    maxSelections: integer("max_selections").notNull().default(1),
  },
  (table) => [unique("variant_groups_product_slug").on(table.productId, table.slug)],
);

export const variantOptions = sqliteTable(
  "variant_options",
  {
    id: text("id").primaryKey(),
    variantGroupId: text("variant_group_id")
      .notNull()
      .references(() => variantGroups.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    priceDeltaCents: integer("price_delta_cents").notNull().default(0),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [unique("variant_options_group_slug").on(table.variantGroupId, table.slug)],
);

export const addonGroups = sqliteTable(
  "addon_groups",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    minSelections: integer("min_selections").notNull().default(0),
    maxSelections: integer("max_selections"),
  },
  (table) => [unique("addon_groups_product_slug").on(table.productId, table.slug)],
);

export const addons = sqliteTable(
  "addons",
  {
    id: text("id").primaryKey(),
    addonGroupId: text("addon_group_id")
      .notNull()
      .references(() => addonGroups.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    priceDeltaCents: integer("price_delta_cents").notNull().default(0),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [unique("addons_group_slug").on(table.addonGroupId, table.slug)],
);
