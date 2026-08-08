import { beforeEach, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createTestDatabase, mockDatabaseModule, withStartContext } from "#/test/db-test-support";
import { orderItemAddons, orderItemVariants, orderItems, orders } from "#/db/schema";
import type { CreateOrderInput } from "./order.functions";
const db = await createTestDatabase(`file:/tmp/self-service-order-${randomUUID()}.db`);
await db.run(sql`INSERT INTO kiosks (id, name, prefix) VALUES ('kiosk-a', 'Alpha kiosk', 'A')`);
await db.run(sql`
  INSERT INTO categories (id, slug, name, display_order, is_active)
  VALUES ('category-drinks', 'drinks', 'Drinks', 1, 1)
`);
await db.run(sql`
  INSERT INTO products
    (id, category_id, slug, name, description, base_price_cents, image_url, is_available)
  VALUES
    ('product-latte', 'category-drinks', 'latte', 'Caffe Latte', 'Steamed milk coffee', 500, NULL, 1),
    ('product-unavailable', 'category-drinks', 'unavailable', 'Unavailable', NULL, 250, NULL, 0)
`);
await db.run(sql`
  INSERT INTO variant_groups
    (id, product_id, slug, name, min_selections, max_selections)
  VALUES ('variant-group-milk', 'product-latte', 'milk', 'Milk', 1, 1)
`);
await db.run(sql`
  INSERT INTO variant_options
    (id, variant_group_id, slug, name, price_delta_cents, is_default)
  VALUES
    ('variant-oat', 'variant-group-milk', 'oat', 'Oat milk', 75, 0),
    ('variant-cow', 'variant-group-milk', 'cow', 'Whole milk', 0, 1)
`);
await db.run(sql`
  INSERT INTO addon_groups
    (id, product_id, slug, name, min_selections, max_selections)
  VALUES ('addon-group-coffee', 'product-latte', 'coffee', 'Coffee add-ons', 0, 2)
`);
await db.run(sql`
  INSERT INTO addons
    (id, addon_group_id, slug, name, price_delta_cents, is_active)
  VALUES ('addon-syrup', 'addon-group-coffee', 'syrup', 'Vanilla syrup', 50, 1)
`);

let requestCookie = "";
mockDatabaseModule(db);
mock.module("#/env.server", () => ({
  serverEnv: { KIOSK_COOKIE_SECRET: "cookie-secret" },
}));
mock.module("@tanstack/react-start/server", () => ({
  getRequestHeader: () => requestCookie,
  setResponseHeader: () => {},
}));

// Import after mocks so direct server-function execution gets the shared test context.
const { signKioskCookie } = await import("./kiosk-cookie.server");
const { createOrderHandler, CreateOrderError } = await import("./order.functions");

const setKioskCookie = (kioskId = "kiosk-a") => {
  requestCookie = `kiosk_session=${signKioskCookie(
    { kioskId, issuedAt: 1_754_672_000_000 },
    "cookie-secret",
  )}`;
};

const validInput = (): CreateOrderInput => ({
  lines: [
    {
      productId: "product-latte",
      quantity: 2,
      variantOptionIds: ["variant-oat"],
      addonIds: ["addon-syrup"],
    },
  ],
});

beforeEach(async () => {
  setKioskCookie();
  await db.delete(orderItemAddons);
  await db.delete(orderItemVariants);
  await db.delete(orderItems);
  await db.delete(orders);
});

test("createOrder creates an immutable pending order from live catalog prices", async () => {
  const input = validInput();
  const result = await withStartContext(() =>
    createOrderHandler({
      ...input,
      unitPriceCents: 1,
    } as CreateOrderInput),
  );

  expect(result).toMatchObject({
    kioskId: "kiosk-a",
    status: "payment_pending",
    orderNumber: null,
    subtotalCents: 1_250,
    totalAmountCents: 1_250,
  });
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({
    productId: "product-latte",
    productName: "Caffe Latte",
    quantity: 2,
    unitPriceCents: 500,
    variants: [
      {
        optionId: "variant-oat",
        optionName: "Oat milk",
        priceDeltaCents: 75,
      },
    ],
    addons: [
      {
        addonId: "addon-syrup",
        addonName: "Vanilla syrup",
        priceDeltaCents: 50,
      },
    ],
  });

  const [order] = await db.select().from(orders).where(eq(orders.id, result.id));
  expect(order).toMatchObject({
    id: result.id,
    kioskId: "kiosk-a",
    status: "payment_pending",
    orderNumber: null,
    subtotalCents: 1_250,
    totalAmountCents: 1_250,
    paidAt: null,
  });
  const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, result.id));
  expect(item).toMatchObject({
    orderId: result.id,
    productId: "product-latte",
    productName: "Caffe Latte",
    quantity: 2,
    unitPriceCents: 500,
  });
  expect(
    await db.select().from(orderItemVariants).where(eq(orderItemVariants.orderItemId, item.id)),
  ).toMatchObject([
    {
      orderItemId: item.id,
      variantOptionId: "variant-oat",
      optionName: "Oat milk",
      priceDeltaCents: 75,
    },
  ]);
  expect(
    await db.select().from(orderItemAddons).where(eq(orderItemAddons.orderItemId, item.id)),
  ).toMatchObject([
    {
      orderItemId: item.id,
      addonId: "addon-syrup",
      addonName: "Vanilla syrup",
      priceDeltaCents: 50,
    },
  ]);

  const counters = await db.all(sql`SELECT * FROM kiosk_order_counters`);
  expect(counters).toEqual([]);
});

test("createOrder requires signed kiosk identity", async () => {
  requestCookie = "";
  await expect(withStartContext(() => createOrderHandler(validInput()))).rejects.toBeInstanceOf(
    CreateOrderError,
  );
  await expect(withStartContext(() => createOrderHandler(validInput()))).rejects.toMatchObject({
    code: "kiosk_identity",
  });
});

test("createOrder rejects empty and zero-quantity carts", async () => {
  await expect(withStartContext(() => createOrderHandler({ lines: [] }))).rejects.toMatchObject({
    code: "invalid_input",
  });
  await expect(
    withStartContext(() =>
      createOrderHandler({ ...validInput(), lines: [{ ...validInput().lines[0], quantity: 0 }] }),
    ),
  ).rejects.toMatchObject({ code: "invalid_input" });
  expect(await db.select().from(orders)).toEqual([]);
});

test("createOrder rejects unavailable products", async () => {
  await expect(
    withStartContext(() =>
      createOrderHandler({
        lines: [
          {
            productId: "product-unavailable",
            quantity: 1,
            variantOptionIds: [],
            addonIds: [],
          },
        ],
      }),
    ),
  ).rejects.toMatchObject({ code: "catalog_unavailable" });
  expect(await db.select().from(orders)).toEqual([]);
});

test("createOrder rejects unknown and out-of-bounds selections", async () => {
  await expect(
    withStartContext(() =>
      createOrderHandler({
        lines: [{ ...validInput().lines[0], variantOptionIds: ["missing-option"] }],
      }),
    ),
  ).rejects.toMatchObject({ code: "selection_invalid" });
  await expect(
    withStartContext(() =>
      createOrderHandler({
        lines: [{ ...validInput().lines[0], variantOptionIds: [] }],
      }),
    ),
  ).rejects.toMatchObject({ code: "selection_invalid" });
  expect(await db.select().from(orders)).toEqual([]);
});
