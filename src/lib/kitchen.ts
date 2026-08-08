import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, setResponseHeader } from "@tanstack/react-start/server";

export type KitchenOrderStatus = "paid" | "preparing";

export type KitchenOrderItem = {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  variants: Array<{
    id: string;
    optionId: string;
    optionName: string;
    priceDeltaCents: number;
  }>;
  addons: Array<{
    id: string;
    addonId: string;
    addonName: string;
    priceDeltaCents: number;
  }>;
};

export type KitchenOrder = {
  id: string;
  orderNumber: string;
  status: KitchenOrderStatus;
  subtotalCents: number;
  totalAmountCents: number;
  createdAt: string;
  paidAt: string;
  items: KitchenOrderItem[];
};

export type OrderStatusEvent = {
  type: "order.preparing" | "order.done";
  orderId: string;
  orderNumber: string;
  status: "preparing" | "done";
};

export type KitchenOrderPaidEvent = {
  type: "order.paid";
  order: KitchenOrder;
};

export type KitchenEvent = KitchenOrderPaidEvent | OrderStatusEvent;

export type KitchenErrorCode =
  | "configuration"
  | "invalid_password"
  | "invalid_input"
  | "staff_identity"
  | "order_not_found"
  | "invalid_transition";

export class KitchenError extends Error {
  readonly code: KitchenErrorCode;

  constructor(code: KitchenErrorCode) {
    super(code);
    this.name = "KitchenError";
    this.code = code;
  }
}

const STAFF_PASSWORD = "warm-melted";
const STAFF_COOKIE = "staff_session";
const staffSessions = new Set<string>();

const fixtureOrders: KitchenOrder[] = [
  {
    id: "order-paid-101",
    orderNumber: "A-101",
    status: "paid",
    subtotalCents: 1025,
    totalAmountCents: 1025,
    createdAt: "2026-08-08T12:00:00.000Z",
    paidAt: "2026-08-08T12:00:01.000Z",
    items: [
      {
        id: "item-paid-101",
        productId: "product-melted-mushroom-toastie",
        productName: "Melted mushroom toastie",
        quantity: 1,
        unitPriceCents: 850,
        variants: [
          {
            id: "variant-paid-101",
            optionId: "option-sourdough",
            optionName: "Sourdough",
            priceDeltaCents: 0,
          },
        ],
        addons: [
          {
            id: "addon-paid-101",
            addonId: "addon-extra-cheese",
            addonName: "Extra cheese",
            priceDeltaCents: 100,
          },
        ],
      },
    ],
  },
];

const cloneOrder = (order: KitchenOrder): KitchenOrder => ({
  ...order,
  items: order.items.map((item) => ({
    ...item,
    variants: item.variants.map((variant) => ({ ...variant })),
    addons: item.addons.map((addon) => ({ ...addon })),
  })),
});

const cloneOrders = (): KitchenOrder[] => fixtureOrders.map(cloneOrder);

const readCookie = (name: string): string | null => {
  const header = getRequestHeader("cookie");
  if (!header) {
    return null;
  }

  for (const part of header.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (key === name) {
      return valueParts.join("=") || null;
    }
  }

  return null;
};

const requireStaffSession = () => {
  const token = readCookie(STAFF_COOKIE);
  if (!token || !staffSessions.has(token)) {
    throw new KitchenError("staff_identity");
  }
};

export const claimStaffSession = createServerFn({ method: "POST" })
  .validator((input: { password: string }) => input)
  .handler(({ data }): { issuedAt: number } => {
    if (!data.password.trim()) {
      throw new KitchenError("invalid_input");
    }
    if (data.password !== STAFF_PASSWORD) {
      throw new KitchenError("invalid_password");
    }

    const token = crypto.randomUUID();
    staffSessions.add(token);
    setResponseHeader("Set-Cookie", `${STAFF_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`);
    return { issuedAt: Date.now() };
  });

export const listActiveOrders = createServerFn({ method: "GET" }).handler((): KitchenOrder[] => {
  requireStaffSession();
  return cloneOrders()
    .filter((order) => order.status === "paid" || order.status === "preparing")
    .sort((first, second) => first.createdAt.localeCompare(second.createdAt));
});

export const advanceOrder = createServerFn({ method: "POST" })
  .validator((input: { orderId: string; toStatus: "preparing" | "done" }) => input)
  .handler(({ data }): OrderStatusEvent => {
    requireStaffSession();

    const order = fixtureOrders.find((candidate) => candidate.id === data.orderId);
    if (!order) {
      throw new KitchenError("order_not_found");
    }

    const expectedFrom = data.toStatus === "preparing" ? "paid" : "preparing";
    if (order.status !== expectedFrom) {
      throw new KitchenError("invalid_transition");
    }

    order.status = data.toStatus === "preparing" ? "preparing" : "preparing";
    if (data.toStatus === "done") {
      fixtureOrders.splice(fixtureOrders.indexOf(order), 1);
    }

    return {
      type: data.toStatus === "preparing" ? "order.preparing" : "order.done",
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: data.toStatus,
    };
  });

export const resetKitchenFixture = () => {
  fixtureOrders.splice(0, fixtureOrders.length, {
    id: "order-paid-101",
    orderNumber: "A-101",
    status: "paid",
    subtotalCents: 1025,
    totalAmountCents: 1025,
    createdAt: "2026-08-08T12:00:00.000Z",
    paidAt: "2026-08-08T12:00:01.000Z",
    items: [
      {
        id: "item-paid-101",
        productId: "product-melted-mushroom-toastie",
        productName: "Melted mushroom toastie",
        quantity: 1,
        unitPriceCents: 850,
        variants: [
          {
            id: "variant-paid-101",
            optionId: "option-sourdough",
            optionName: "Sourdough",
            priceDeltaCents: 0,
          },
        ],
        addons: [
          {
            id: "addon-paid-101",
            addonId: "addon-extra-cheese",
            addonName: "Extra cheese",
            priceDeltaCents: 100,
          },
        ],
      },
    ],
  });
  staffSessions.clear();
};
