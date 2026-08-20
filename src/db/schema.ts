import { index, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const kiosks = sqliteTable("kiosks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  prefix: text("prefix").notNull().unique(),
});

export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    displayOrder: integer("display_order").notNull().default(0),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [index("categories_is_active_idx").on(table.isActive)],
);

export const products = sqliteTable(
  "products",
  {
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
  },
  (table) => [
    index("products_category_id_idx").on(table.categoryId),
    index("products_is_available_idx").on(table.isAvailable),
  ],
);

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
  (table) => [
    unique("addons_group_slug").on(table.addonGroupId, table.slug),
    index("addons_is_active_idx").on(table.isActive),
  ],
);

export const kioskOrderCounters = sqliteTable(
  "kiosk_order_counters",
  {
    kioskId: text("kiosk_id")
      .notNull()
      .references(() => kiosks.id, { onDelete: "cascade" }),
    serviceDate: text("service_date").notNull(),
    nextNumber: integer("next_number").notNull().default(1),
  },
  (table) => [primaryKey({ columns: [table.kioskId, table.serviceDate] })],
);

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    kioskId: text("kiosk_id")
      .notNull()
      .references(() => kiosks.id),
    orderNumber: text("order_number"),
    status: text("status").notNull(),
    subtotalCents: integer("subtotal_cents").notNull(),
    totalAmountCents: integer("total_amount_cents").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    paidAt: integer("paid_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("orders_kiosk_id_idx").on(table.kioskId),
    index("orders_status_idx").on(table.status),
  ],
);
export const paymentAttempts = sqliteTable(
  "payment_attempts",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    method: text("method").notNull(),
    terminalCommand: text("terminal_command").notNull(),
    receipt: text("receipt"),
    expectedAmountCents: integer("expected_amount_cents").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("payment_attempts_order_id_idx").on(table.orderId),
    index("payment_attempts_status_idx").on(table.status),
  ],
);

export const orderItems = sqliteTable(
  "order_items",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    productName: text("product_name").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
  },
  (table) => [
    index("order_items_order_id_idx").on(table.orderId),
    index("order_items_product_id_idx").on(table.productId),
  ],
);

export const orderItemVariants = sqliteTable(
  "order_item_variants",
  {
    id: text("id").primaryKey(),
    orderItemId: text("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "cascade" }),
    variantOptionId: text("variant_option_id")
      .notNull()
      .references(() => variantOptions.id),
    optionName: text("option_name").notNull(),
    priceDeltaCents: integer("price_delta_cents").notNull(),
  },
  (table) => [
    index("order_item_variants_order_item_id_idx").on(table.orderItemId),
    index("order_item_variants_variant_option_id_idx").on(table.variantOptionId),
  ],
);

export const orderItemAddons = sqliteTable(
  "order_item_addons",
  {
    id: text("id").primaryKey(),
    orderItemId: text("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "cascade" }),
    addonId: text("addon_id")
      .notNull()
      .references(() => addons.id),
    addonName: text("addon_name").notNull(),
    priceDeltaCents: integer("price_delta_cents").notNull(),
  },
  (table) => [
    index("order_item_addons_order_item_id_idx").on(table.orderItemId),
    index("order_item_addons_addon_id_idx").on(table.addonId),
  ],
);
