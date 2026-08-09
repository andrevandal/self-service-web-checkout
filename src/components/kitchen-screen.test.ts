import { describe, expect, test } from "bun:test";
import { applyKitchenEvent } from "#/components/kitchen-screen";
import type { KitchenOrder, KitchenOrderEvent } from "#/lib/kitchen.functions";

const order = (
  id: string,
  orderNumber: string,
  createdAt: string,
  status: "paid" | "preparing" = "paid",
): KitchenOrder => ({
  id,
  orderNumber,
  status,
  subtotalCents: 650,
  totalAmountCents: 650,
  createdAt,
  paidAt: createdAt,
  items: [],
});

describe("applyKitchenEvent", () => {
  test("upserts a paid order and keeps oldest-first order", () => {
    const current = [order("later", "A-2", "2026-08-08T12:02:00.000Z")];
    const event: KitchenOrderEvent = {
      type: "order.paid",
      orderId: "earlier",
      orderNumber: "A-1",
      status: "paid",
      order: order("earlier", "A-1", "2026-08-08T12:01:00.000Z"),
    };

    expect(applyKitchenEvent(current, event).map((item) => item.id)).toEqual(["earlier", "later"]);
    expect(current[0]?.id).toBe("later");
  });

  test("updates preparing status without mutating the existing order", () => {
    const current = [order("paid", "A-1", "2026-08-08T12:01:00.000Z")];
    const event: KitchenOrderEvent = {
      type: "order.preparing",
      orderId: "paid",
      orderNumber: "A-1",
      status: "preparing",
    };

    const next = applyKitchenEvent(current, event);
    expect(next[0]?.status).toBe("preparing");
    expect(current[0]?.status).toBe("paid");
  });

  test("removes an order when it is done", () => {
    const current = [order("done", "A-1", "2026-08-08T12:01:00.000Z", "preparing")];
    const event: KitchenOrderEvent = {
      type: "order.done",
      orderId: "done",
      orderNumber: "A-1",
      status: "done",
    };

    expect(applyKitchenEvent(current, event)).toEqual([]);
  });
});
