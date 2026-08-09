import { beforeEach, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createTestDatabase, mockDatabaseModule, withStartContext } from "#/test/db-test-support";
import {
  addons,
  addonGroups,
  categories,
  orderItemAddons,
  orderItemVariants,
  orderItems,
  orders,
  products,
  variantGroups,
  variantOptions,
} from "#/db/schema";

const db = await createTestDatabase(`file:/tmp/self-service-kitchen-${randomUUID()}.db`);
await db.run(sql`
  INSERT INTO kiosks (id, name, prefix) VALUES
    ('kiosk-a', 'Alpha kiosk', 'A'),
    ('kiosk-b', 'Beta kiosk', 'B')
`);
await db.insert(categories).values({
  id: "category-kitchen",
  slug: "kitchen-category",
  name: "Kitchen category",
  displayOrder: 1,
  isActive: true,
});
await db.insert(products).values({
  id: "product-kitchen",
  categoryId: "category-kitchen",
  slug: "kitchen-product",
  name: "Kitchen product",
  description: "Kitchen test product",
  basePriceCents: 850,
  imageUrl: null,
  isAvailable: true,
});
await db.insert(variantGroups).values({
  id: "variant-group-kitchen",
  productId: "product-kitchen",
  slug: "kitchen-variant",
  name: "Kitchen variant",
  minSelections: 0,
  maxSelections: 1,
});
await db.insert(variantOptions).values({
  id: "variant-option-kitchen",
  variantGroupId: "variant-group-kitchen",
  slug: "variant-choice",
  name: "Variant choice",
  priceDeltaCents: 75,
  isDefault: false,
});
await db.insert(addonGroups).values({
  id: "addon-group-kitchen",
  productId: "product-kitchen",
  slug: "kitchen-addon",
  name: "Kitchen addon",
  minSelections: 0,
  maxSelections: 1,
});
await db.insert(addons).values({
  id: "addon-kitchen",
  addonGroupId: "addon-group-kitchen",
  slug: "addon-choice",
  name: "Addon choice",
  priceDeltaCents: 125,
  isActive: true,
});

let requestCookie = "";
let setCookieHeader = "";
const capturedDomainEvents: Array<{
  event: string;
  distinctId: string;
  properties: Record<string, unknown>;
}> = [];
mockDatabaseModule(db);
mock.module("#/env.server", () => ({
  serverEnv: {
    KIOSK_CLAIM_PASSWORD: "shared-password",
    KIOSK_COOKIE_SECRET: "kiosk-secret",
    KIOSK_COOKIE_SECURE: false,
    STAFF_COOKIE_SECRET: "staff-secret",
    STAFF_COOKIE_SECURE: false,
    POSTHOG_KEY: "",
  },
}));
mock.module("./posthog.server", () => ({
  captureDomainEvent: (event: string, distinctId: string, properties: Record<string, unknown>) => {
    capturedDomainEvents.push({ event, distinctId, properties });
  },
}));
mock.module("@tanstack/react-start/server", () => ({
  getRequestHeader: (name: string) => (name === "cookie" ? requestCookie : undefined),
  setResponseHeader: (name: string, value: string) => {
    if (name === "Set-Cookie") {
      setCookieHeader = value;
      requestCookie = value.split(";", 1)[0] ?? "";
    }
  },
}));

const { signKioskCookie } = await import("./kiosk-cookie.server");
const { signStaffCookie, verifyStaffCookie } = await import("./staff-cookie.server");
const {
  KitchenOrderError,
  StaffSessionError,
  advanceOrderHandler,
  claimStaffSessionHandler,
  listActiveOrdersHandler,
} = await import("./kitchen.functions");
const { reconcilePaymentAttemptHandler, startPaymentAttemptHandler } =
  await import("./payment.functions");
const { KitchenEventDispatcher, kitchenEventDispatcher } = await import("./kitchen-events.server");

const setStaffCookie = () => {
  requestCookie = `staff_session=${signStaffCookie({ issuedAt: 1_754_672_000_000 }, "staff-secret")}`;
};

const setKioskCookie = (kioskId = "kiosk-a") => {
  requestCookie = `kiosk_session=${signKioskCookie(
    { kioskId, issuedAt: 1_754_672_000_000 },
    "kiosk-secret",
  )}`;
};

const insertOrder = async ({
  id = `order-${randomUUID()}`,
  status = "paid",
  orderNumber = "A-1",
  createdAt = new Date("2026-08-08T09:00:00.000Z"),
  paidAt = new Date("2026-08-08T09:01:00.000Z"),
}: {
  id?: string;
  status?: string;
  orderNumber?: string | null;
  createdAt?: Date;
  paidAt?: Date | null;
} = {}) => {
  await db.insert(orders).values({
    id,
    kioskId: "kiosk-a",
    orderNumber,
    status,
    subtotalCents: 1_000,
    totalAmountCents: 1_000,
    createdAt,
    paidAt,
  });
  return id;
};

const insertOrderItem = async (orderId: string) => {
  const itemId = `item-${randomUUID()}`;
  await db.insert(orderItems).values({
    id: itemId,
    orderId,
    productId: "product-kitchen",
    productName: "Kitchen product snapshot",
    quantity: 2,
    unitPriceCents: 850,
  });
  await db.insert(orderItemVariants).values({
    id: `item-variant-${randomUUID()}`,
    orderItemId: itemId,
    variantOptionId: "variant-option-kitchen",
    optionName: "Variant choice snapshot",
    priceDeltaCents: 75,
  });
  await db.insert(orderItemAddons).values({
    id: `item-addon-${randomUUID()}`,
    orderItemId: itemId,
    addonId: "addon-kitchen",
    addonName: "Addon choice snapshot",
    priceDeltaCents: 125,
  });
};

beforeEach(async () => {
  requestCookie = "";
  setCookieHeader = "";
  capturedDomainEvents.length = 0;
  await db.delete(orderItemVariants);
  await db.delete(orderItemAddons);
  await db.delete(orderItems);
  await db.delete(orders);
});

test("staff claim signs a separate session and rejects a kiosk token", async () => {
  await expect(claimStaffSessionHandler({ password: "wrong-password" })).rejects.toMatchObject({
    name: "StaffSessionError",
    code: "invalid_password",
  });

  const session = await withStartContext(() =>
    claimStaffSessionHandler({ password: "shared-password" }),
  );

  expect(session).toEqual({ issuedAt: expect.any(Number) });
  expect(setCookieHeader).toStartWith("staff_session=");
  expect(
    verifyStaffCookie(
      signKioskCookie({ kioskId: "kiosk-a", issuedAt: Date.now() }, "kiosk-secret"),
      "staff-secret",
    ),
  ).toBeNull();
});

test("active list requires staff authority, filters statuses, and returns snapshots", async () => {
  const paidId = await insertOrder({ id: "order-paid", status: "paid", orderNumber: "A-1" });
  const preparingId = await insertOrder({
    id: "order-preparing",
    status: "preparing",
    orderNumber: "A-2",
    createdAt: new Date("2026-08-08T09:02:00.000Z"),
  });
  await insertOrderItem(paidId);
  await insertOrder({
    id: "order-pending",
    status: "payment_pending",
    orderNumber: null,
    paidAt: null,
  });
  await insertOrder({ id: "order-done", status: "done", orderNumber: "A-0" });

  await expect(withStartContext(() => listActiveOrdersHandler())).rejects.toMatchObject({
    code: "staff_identity",
  });

  setStaffCookie();
  const active = await withStartContext(() => listActiveOrdersHandler());

  expect(active).toHaveLength(2);
  expect(active.map((order) => order.id)).toEqual([paidId, preparingId]);
  expect(active[0]).toMatchObject({
    id: paidId,
    orderNumber: "A-1",
    status: "paid",
    subtotalCents: 1_000,
    totalAmountCents: 1_000,
    createdAt: "2026-08-08T09:00:00.000Z",
    paidAt: "2026-08-08T09:01:00.000Z",
    items: [
      {
        productName: "Kitchen product snapshot",
        quantity: 2,
        unitPriceCents: 850,
        variants: [
          {
            optionName: "Variant choice snapshot",
            priceDeltaCents: 75,
          },
        ],
        addons: [
          {
            addonName: "Addon choice snapshot",
            priceDeltaCents: 125,
          },
        ],
      },
    ],
  });
});

test("advance order enforces paid to preparing to done and emits transitions", async () => {
  const orderId = await insertOrder({ id: "order-transition", status: "paid", orderNumber: "A-7" });
  setStaffCookie();
  const events: unknown[] = [];
  const unsubscribe = kitchenEventDispatcher.subscribe((event) => events.push(event));

  try {
    const preparing = await withStartContext(() =>
      advanceOrderHandler({ orderId, toStatus: "preparing" }),
    );
    expect(preparing).toEqual({
      type: "order.preparing",
      orderId,
      orderNumber: "A-7",
      status: "preparing",
    });
    const done = await withStartContext(() => advanceOrderHandler({ orderId, toStatus: "done" }));
    expect(done).toEqual({ type: "order.done", orderId, orderNumber: "A-7", status: "done" });
    expect(events).toEqual([preparing, done]);

    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order?.status).toBe("done");
    expect(await withStartContext(() => listActiveOrdersHandler())).toEqual([]);
  } finally {
    unsubscribe();
  }
});

test("advance order rejects skips, backwards moves, and unknown orders without events", async () => {
  const orderId = await insertOrder({ id: "order-invalid", status: "paid", orderNumber: "A-8" });
  setStaffCookie();
  const events: unknown[] = [];
  const unsubscribe = kitchenEventDispatcher.subscribe((event) => events.push(event));

  try {
    await expect(
      withStartContext(() => advanceOrderHandler({ orderId, toStatus: "done" })),
    ).rejects.toMatchObject({ name: "KitchenOrderError", code: "invalid_transition" });
    await expect(
      withStartContext(() => advanceOrderHandler({ orderId: "missing", toStatus: "preparing" })),
    ).rejects.toMatchObject({ name: "KitchenOrderError", code: "order_not_found" });
    await expect(
      withStartContext(() => advanceOrderHandler({ orderId, toStatus: "preparing" })),
    ).resolves.toMatchObject({ status: "preparing" });
    await expect(
      withStartContext(() => advanceOrderHandler({ orderId, toStatus: "preparing" })),
    ).rejects.toMatchObject({ code: "invalid_transition" });
    expect(events).toHaveLength(1);
  } finally {
    unsubscribe();
  }
});

test("dispatcher delivers events and unsubscribe stops delivery", () => {
  const dispatcher = new KitchenEventDispatcher();
  const received: string[] = [];
  const unsubscribe = dispatcher.subscribe((event) => received.push(event.type));
  dispatcher.emit({
    type: "order.preparing",
    orderId: "order-1",
    orderNumber: "A-1",
    status: "preparing",
  });
  unsubscribe();
  dispatcher.emit({ type: "order.done", orderId: "order-1", orderNumber: "A-1", status: "done" });
  expect(received).toEqual(["order.preparing"]);
});

test("approved payment emits a full paid order after reconciliation commits", async () => {
  const orderId = await insertOrder({
    id: "order-paid-event",
    status: "payment_pending",
    orderNumber: null,
    paidAt: null,
  });
  setKioskCookie();
  const attempt = await withStartContext(() => startPaymentAttemptHandler({ orderId }));
  const events: unknown[] = [];
  const unsubscribe = kitchenEventDispatcher.subscribe((event) => events.push(event));

  try {
    const result = await withStartContext(() =>
      reconcilePaymentAttemptHandler({
        attemptId: attempt.id,
        receipt: {
          terminalCommand: attempt.terminalCommand,
          reference: "receipt-event",
          amountCents: attempt.expectedAmountCents,
          outcome: "approved",
        },
      }),
    );
    expect(result.orderStatus).toBe("paid");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "order.paid",
      orderId,
      orderNumber: result.orderNumber,
      status: "paid",
      order: {
        id: orderId,
        orderNumber: result.orderNumber,
        status: "paid",
        items: [],
      },
    });

    const declinedOrderId = await insertOrder({
      id: "order-declined-event",
      status: "payment_pending",
      orderNumber: null,
      paidAt: null,
    });
    const declinedAttempt = await withStartContext(() =>
      startPaymentAttemptHandler({ orderId: declinedOrderId }),
    );
    await withStartContext(() =>
      reconcilePaymentAttemptHandler({
        attemptId: declinedAttempt.id,
        receipt: {
          terminalCommand: declinedAttempt.terminalCommand,
          reference: "receipt-declined-event",
          amountCents: declinedAttempt.expectedAmountCents,
          outcome: "declined",
        },
      }),
    );
    expect(events).toHaveLength(1);
  } finally {
    unsubscribe();
  }
});

test("claim and queue functions reject malformed input", async () => {
  setStaffCookie();
  await expect(claimStaffSessionHandler({ password: "" })).rejects.toMatchObject({
    name: "StaffSessionError",
    code: "invalid_input",
  });
  await expect(
    withStartContext(() => advanceOrderHandler({ orderId: "", toStatus: "preparing" })),
  ).rejects.toMatchObject({ code: "invalid_input" });
  expect(KitchenOrderError).toBeDefined();
  expect(StaffSessionError).toBeDefined();
});

test("captures kitchen transition outcomes after commit", async () => {
  const orderId = await insertOrder({ id: "order-kitchen-analytics" });
  setStaffCookie();

  await withStartContext(() => advanceOrderHandler({ orderId, toStatus: "preparing" }));
  await withStartContext(() => advanceOrderHandler({ orderId, toStatus: "done" }));

  expect(capturedDomainEvents.map(({ event }) => event)).toEqual([
    "kitchen_order_started",
    "kitchen_order_done",
  ]);
  expect(capturedDomainEvents.every(({ distinctId }) => distinctId === "kiosk-a")).toBe(true);
  expect(capturedDomainEvents[0]?.properties).toMatchObject({
    kiosk_id: "kiosk-a",
    order_id: orderId,
    amount_cents: 1_000,
    outcome: "preparing",
  });
  expect(capturedDomainEvents[1]?.properties).toMatchObject({
    kiosk_id: "kiosk-a",
    order_id: orderId,
    amount_cents: 1_000,
    outcome: "done",
  });
});
