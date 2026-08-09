// Server-only kitchen handlers are kept behind the client-safe function wrapper.
import { and, asc, eq, inArray } from "drizzle-orm";
import { createHash, timingSafeEqual } from "node:crypto";
import * as v from "valibot";
import { db } from "#/db/client.server";
import { serverEnv } from "#/env.server";
import { orderItemAddons, orderItemVariants, orderItems, orders } from "#/db/schema";
import { readStaffCookie, setStaffCookie } from "./staff-cookie.server";
import {
  kitchenEventDispatcher,
  type KitchenOrder,
  type KitchenOrderEvent,
  type OrderStatusEvent,
} from "./kitchen-events.server";
import { captureDomainEvent } from "./posthog.server";

export type ClaimStaffSessionInput = {
  password: string;
};

export type StaffSession = {
  issuedAt: number;
};

export type AdvanceOrderInput = {
  orderId: string;
  toStatus: "preparing" | "done";
};

export type StaffSessionErrorCode =
  | "configuration"
  | "invalid_password"
  | "invalid_input"
  | "staff_identity";

export class StaffSessionError extends Error {
  constructor(
    public readonly code: StaffSessionErrorCode,
    detail: string,
  ) {
    // `message` is the only Error property TanStack Start's RPC serializer
    // preserves across the client/server boundary (see
    // @tanstack/router-core's ShallowErrorPlugin). Using `code` as the
    // message lets client-side error-copy lookups key off `error.message`
    // after deserialization; `detail` stays available server-side.
    super(code);
    this.name = "StaffSessionError";
    this.cause = detail;
  }
}

export type KitchenOrderErrorCode =
  | "configuration"
  | "invalid_input"
  | "staff_identity"
  | "order_not_found"
  | "invalid_transition";

export class KitchenOrderError extends Error {
  constructor(
    public readonly code: KitchenOrderErrorCode,
    detail: string,
  ) {
    super(code);
    this.name = "KitchenOrderError";
    this.cause = detail;
  }
}

const claimStaffSessionInputSchema = v.object({ password: v.string() });
const advanceOrderInputSchema = v.object({
  orderId: v.pipe(v.string(), v.minLength(1)),
  toStatus: v.picklist(["preparing", "done"]),
});

const validateClaimStaffSessionInput = (input: unknown): ClaimStaffSessionInput => {
  const result = v.safeParse(claimStaffSessionInputSchema, input);
  if (!result.success || result.output.password.length === 0) {
    throw new StaffSessionError("invalid_input", "Staff password is required");
  }
  return result.output;
};

const validateAdvanceOrderInput = (input: unknown): AdvanceOrderInput => {
  const result = v.safeParse(advanceOrderInputSchema, input);
  if (!result.success) {
    throw new KitchenOrderError("invalid_input", "Order transition is invalid");
  }
  return result.output as AdvanceOrderInput;
};

const passwordDigest = (value: string) => createHash("sha256").update(value).digest();

const passwordsMatch = (provided: string, configured: string) => {
  const providedDigest = passwordDigest(provided);
  const configuredDigest = passwordDigest(configured);
  return timingSafeEqual(providedDigest, configuredDigest);
};

const requireStaffSession = () => {
  const { STAFF_COOKIE_SECRET } = serverEnv;
  if (!STAFF_COOKIE_SECRET) {
    throw new StaffSessionError("configuration", "Staff cookie secret is not configured");
  }
  if (!readStaffCookie(STAFF_COOKIE_SECRET)) {
    throw new StaffSessionError("staff_identity", "A valid staff session is required");
  }
};

const requireKitchenStaffSession = () => {
  try {
    requireStaffSession();
  } catch (error) {
    if (error instanceof StaffSessionError && error.code === "configuration") {
      throw new KitchenOrderError("configuration", String(error.cause ?? error.message));
    }
    if (error instanceof StaffSessionError && error.code === "staff_identity") {
      throw new KitchenOrderError("staff_identity", String(error.cause ?? error.message));
    }
    throw error;
  }
};

const toIsoString = (date: Date) => date.toISOString();

export const getKitchenOrderSnapshot = async (orderId: string): Promise<KitchenOrder | null> => {
  const [order] = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      subtotalCents: orders.subtotalCents,
      totalAmountCents: orders.totalAmountCents,
      createdAt: orders.createdAt,
      paidAt: orders.paidAt,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (
    !order ||
    (order.status !== "paid" && order.status !== "preparing") ||
    !order.orderNumber ||
    !order.paidAt
  ) {
    return null;
  }

  const itemRows = await db
    .select({
      id: orderItems.id,
      productId: orderItems.productId,
      productName: orderItems.productName,
      quantity: orderItems.quantity,
      unitPriceCents: orderItems.unitPriceCents,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id))
    .orderBy(asc(orderItems.id));
  const itemIds = itemRows.map((item) => item.id);
  const variantRows =
    itemIds.length === 0
      ? []
      : await db
          .select({
            id: orderItemVariants.id,
            orderItemId: orderItemVariants.orderItemId,
            optionId: orderItemVariants.variantOptionId,
            optionName: orderItemVariants.optionName,
            priceDeltaCents: orderItemVariants.priceDeltaCents,
          })
          .from(orderItemVariants)
          .where(inArray(orderItemVariants.orderItemId, itemIds))
          .orderBy(asc(orderItemVariants.id));
  const addonRows =
    itemIds.length === 0
      ? []
      : await db
          .select({
            id: orderItemAddons.id,
            orderItemId: orderItemAddons.orderItemId,
            addonId: orderItemAddons.addonId,
            addonName: orderItemAddons.addonName,
            priceDeltaCents: orderItemAddons.priceDeltaCents,
          })
          .from(orderItemAddons)
          .where(inArray(orderItemAddons.orderItemId, itemIds))
          .orderBy(asc(orderItemAddons.id));
  const variantsByItemId = new Map<string, typeof variantRows>();
  for (const variant of variantRows) {
    const variants = variantsByItemId.get(variant.orderItemId) ?? [];
    variants.push(variant);
    variantsByItemId.set(variant.orderItemId, variants);
  }
  const addonsByItemId = new Map<string, typeof addonRows>();
  for (const addon of addonRows) {
    const itemAddons = addonsByItemId.get(addon.orderItemId) ?? [];
    itemAddons.push(addon);
    addonsByItemId.set(addon.orderItemId, itemAddons);
  }

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    subtotalCents: order.subtotalCents,
    totalAmountCents: order.totalAmountCents,
    createdAt: toIsoString(order.createdAt),
    paidAt: toIsoString(order.paidAt),
    items: itemRows.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      variants: (variantsByItemId.get(item.id) ?? []).map((variant) => ({
        id: variant.id,
        optionId: variant.optionId,
        optionName: variant.optionName,
        priceDeltaCents: variant.priceDeltaCents,
      })),
      addons: (addonsByItemId.get(item.id) ?? []).map((addon) => ({
        id: addon.id,
        addonId: addon.addonId,
        addonName: addon.addonName,
        priceDeltaCents: addon.priceDeltaCents,
      })),
    })),
  };
};

export const claimStaffSessionHandler = async (
  input: ClaimStaffSessionInput,
): Promise<StaffSession> => {
  const data = validateClaimStaffSessionInput(input);
  const { KIOSK_CLAIM_PASSWORD, STAFF_COOKIE_SECRET, STAFF_COOKIE_SECURE } = serverEnv;
  if (!KIOSK_CLAIM_PASSWORD || !STAFF_COOKIE_SECRET) {
    throw new StaffSessionError("configuration", "Staff claim is not configured");
  }
  if (!passwordsMatch(data.password, KIOSK_CLAIM_PASSWORD)) {
    throw new StaffSessionError("invalid_password", "Invalid staff claim password");
  }

  const session = { issuedAt: Date.now() };
  setStaffCookie(session, STAFF_COOKIE_SECRET, STAFF_COOKIE_SECURE);
  return session;
};

export const listActiveOrdersHandler = async (): Promise<KitchenOrder[]> => {
  requireKitchenStaffSession();
  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(inArray(orders.status, ["paid", "preparing"]))
    .orderBy(asc(orders.createdAt), asc(orders.id));
  const snapshots = await Promise.all(rows.map(({ id }) => getKitchenOrderSnapshot(id)));
  return snapshots.map((snapshot, index) => {
    if (!snapshot) {
      throw new KitchenOrderError(
        "order_not_found",
        `Active order ${rows[index]?.id ?? "unknown"} is incomplete`,
      );
    }
    return snapshot;
  });
};

export const advanceOrderHandler = async (input: AdvanceOrderInput): Promise<OrderStatusEvent> => {
  requireKitchenStaffSession();
  const data = validateAdvanceOrderInput(input);
  const transition = await db.transaction(async (tx) => {
    const [order] = await tx
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        kioskId: orders.kioskId,
        totalAmountCents: orders.totalAmountCents,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(eq(orders.id, data.orderId))
      .limit(1);
    if (!order) {
      throw new KitchenOrderError("order_not_found", "Order was not found");
    }

    const expectedStatus = data.toStatus === "preparing" ? "paid" : "preparing";
    if (order.status !== expectedStatus || !order.orderNumber) {
      throw new KitchenOrderError("invalid_transition", "Order transition is not allowed");
    }

    const [updated] = await tx
      .update(orders)
      .set({ status: data.toStatus })
      .where(and(eq(orders.id, data.orderId), eq(orders.status, expectedStatus)))
      .returning({ id: orders.id, orderNumber: orders.orderNumber });
    if (!updated?.orderNumber) {
      throw new KitchenOrderError("invalid_transition", "Order transition is no longer current");
    }

    return {
      event: {
        type: data.toStatus === "preparing" ? "order.preparing" : "order.done",
        orderId: updated.id,
        orderNumber: updated.orderNumber,
        status: data.toStatus,
      } as OrderStatusEvent,
      kioskId: order.kioskId,
      amountCents: order.totalAmountCents,
      createdAt: order.createdAt,
    };
  });

  const eventName =
    transition.event.status === "preparing" ? "kitchen_order_started" : "kitchen_order_done";
  captureDomainEvent(eventName, transition.kioskId, {
    kiosk_id: transition.kioskId,
    order_id: transition.event.orderId,
    amount_cents: transition.amountCents,
    outcome: transition.event.status,
    elapsed_ms: Math.max(0, Date.now() - transition.createdAt.getTime()),
  });
  kitchenEventDispatcher.emit(transition.event);
  return transition.event;
};

export type { KitchenOrder, KitchenOrderEvent };

export const claimStaffSessionServerHandler = ({
  data,
}: {
  data: ClaimStaffSessionInput;
}): Promise<StaffSession> => claimStaffSessionHandler(data);

export const advanceOrderServerHandler = ({
  data,
}: {
  data: AdvanceOrderInput;
}): Promise<OrderStatusEvent> => advanceOrderHandler(data);
