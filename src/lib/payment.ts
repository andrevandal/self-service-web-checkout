import { createServerFn } from "@tanstack/react-start";
import type { CreateOrderInput, CreateOrderResult } from "#/lib/checkout";

export type CreateOrderErrorCode =
  | "configuration"
  | "kiosk_identity"
  | "invalid_input"
  | "catalog_unavailable"
  | "selection_invalid";

export class CreateOrderError extends Error {
  constructor(
    public readonly code: CreateOrderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CreateOrderError";
  }
}

export type StartPaymentAttemptInput = { orderId: string };
export type StartPaymentAttemptResult = {
  id: string;
  orderId: string;
  status: "pending";
  terminalCommand: string;
  expectedAmountCents: number;
  expiresAt: string;
};

export type PaymentReceipt = {
  terminalCommand: string;
  reference: string;
  amountCents: number;
  outcome: "approved" | "declined" | "unavailable";
};

export type ReconcilePaymentAttemptInput = {
  attemptId: string;
  receipt: PaymentReceipt;
};

export type ReconcilePaymentAttemptResult = {
  attemptId: string;
  orderId: string;
  attemptStatus: "approved" | "declined" | "unavailable";
  orderStatus: "paid" | "payment_pending";
  orderNumber: string | null;
  amountCents: number;
  reference: string;
};

export type PaymentAttemptErrorCode =
  | "configuration"
  | "kiosk_identity"
  | "invalid_input"
  | "order_not_pending"
  | "attempt_not_found"
  | "attempt_ownership"
  | "attempt_resolved"
  | "attempt_expired"
  | "receipt_invalid";

export class PaymentAttemptError extends Error {
  constructor(
    public readonly code: PaymentAttemptErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PaymentAttemptError";
  }
}

type CatalogProduct = {
  name: string;
  basePriceCents: number;
  variants: Record<string, { optionName: string; priceDeltaCents: number }>;
  addons: Record<string, { addonName: string; priceDeltaCents: number }>;
  requiredVariantOptionIds: string[];
};

const catalogProducts: Record<string, CatalogProduct> = {
  "product-classic-cheese-toastie": {
    name: "Classic cheese toastie",
    basePriceCents: 650,
    variants: {},
    addons: {},
    requiredVariantOptionIds: [],
  },
  "product-melted-mushroom-toastie": {
    name: "Melted mushroom toastie",
    basePriceCents: 850,
    variants: {
      "option-sourdough": { optionName: "Sourdough", priceDeltaCents: 0 },
      "option-rye": { optionName: "Rye", priceDeltaCents: 50 },
    },
    addons: {
      "addon-extra-cheese": { addonName: "Extra cheese", priceDeltaCents: 100 },
      "addon-hot-honey": { addonName: "Hot honey", priceDeltaCents: 75 },
    },
    requiredVariantOptionIds: ["option-sourdough", "option-rye"],
  },
  "product-house-pickles": {
    name: "House pickles",
    basePriceCents: 300,
    variants: {},
    addons: {},
    requiredVariantOptionIds: [],
  },
};

type PendingOrder = CreateOrderResult & { prefix: string; paid: boolean };
type PendingAttempt = {
  orderId: string;
  terminalCommand: string;
  expectedAmountCents: number;
  expiresAt: number;
  status: "pending" | "approved" | "declined" | "unavailable" | "invalid" | "expired";
};

const pendingOrders = new Map<string, PendingOrder>();
const paymentAttempts = new Map<string, PendingAttempt>();
let nextPickupNumber = 13;

const validateCreateOrderInput = (input: CreateOrderInput): CreateOrderInput => {
  if (!input || !Array.isArray(input.lines) || input.lines.length === 0) {
    throw new CreateOrderError("invalid_input", "Cart must contain valid line items");
  }
  for (const line of input.lines) {
    if (
      !line.productId ||
      !Number.isInteger(line.quantity) ||
      line.quantity < 1 ||
      !Array.isArray(line.variantOptionIds) ||
      !Array.isArray(line.addonIds)
    ) {
      throw new CreateOrderError("invalid_input", "Cart must contain valid line items");
    }
  }
  return input;
};

export const createOrderHandler = (input: CreateOrderInput): CreateOrderResult => {
  const data = validateCreateOrderInput(input);
  const items = data.lines.map((line) => {
    const product = catalogProducts[line.productId];
    if (!product) {
      throw new CreateOrderError("catalog_unavailable", "A product is no longer available");
    }
    if (
      new Set(line.variantOptionIds).size !== line.variantOptionIds.length ||
      new Set(line.addonIds).size !== line.addonIds.length
    ) {
      throw new CreateOrderError("selection_invalid", "Product selections are invalid");
    }
    if (
      product.requiredVariantOptionIds.length > 0 &&
      !product.requiredVariantOptionIds.some((optionId) => line.variantOptionIds.includes(optionId))
    ) {
      throw new CreateOrderError("selection_invalid", "Choose a required product option");
    }
    const variants = line.variantOptionIds.map((optionId) => {
      const option = product.variants[optionId];
      if (!option) {
        throw new CreateOrderError("selection_invalid", "Product selections are invalid");
      }
      return {
        id: globalThis.crypto.randomUUID(),
        optionId,
        optionName: option.optionName,
        priceDeltaCents: option.priceDeltaCents,
      };
    });
    const addons = line.addonIds.map((addonId) => {
      const addon = product.addons[addonId];
      if (!addon) {
        throw new CreateOrderError("selection_invalid", "Product selections are invalid");
      }
      return {
        id: globalThis.crypto.randomUUID(),
        addonId,
        addonName: addon.addonName,
        priceDeltaCents: addon.priceDeltaCents,
      };
    });
    const unitPriceCents =
      product.basePriceCents +
      variants.reduce((sum, variant) => sum + variant.priceDeltaCents, 0) +
      addons.reduce((sum, addon) => sum + addon.priceDeltaCents, 0);
    return {
      id: globalThis.crypto.randomUUID(),
      productId: line.productId,
      productName: product.name,
      quantity: line.quantity,
      unitPriceCents,
      variants,
      addons,
    };
  });
  const subtotalCents = items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
  const result: CreateOrderResult = {
    id: globalThis.crypto.randomUUID(),
    kioskId: "kiosk-front-counter",
    status: "payment_pending",
    orderNumber: null,
    subtotalCents,
    totalAmountCents: subtotalCents,
    items,
  };
  pendingOrders.set(result.id, { ...result, prefix: "A", paid: false });
  return result;
};

export const startPaymentAttemptHandler = ({ orderId }: StartPaymentAttemptInput) => {
  if (!orderId) {
    throw new PaymentAttemptError("invalid_input", "Order id is required");
  }
  const order = pendingOrders.get(orderId);
  if (!order || order.paid) {
    throw new PaymentAttemptError(
      "order_not_pending",
      "Order is not available for a payment attempt",
    );
  }
  const id = globalThis.crypto.randomUUID();
  const terminalCommand = `fake-terminal:${globalThis.crypto.randomUUID()}`;
  const expiresAt = Date.now() + 120_000;
  const attempt: PendingAttempt = {
    orderId,
    terminalCommand,
    expectedAmountCents: order.totalAmountCents,
    expiresAt,
    status: "pending",
  };
  paymentAttempts.set(id, attempt);
  return {
    id,
    orderId,
    status: "pending" as const,
    terminalCommand,
    expectedAmountCents: order.totalAmountCents,
    expiresAt: new Date(expiresAt).toISOString(),
  } satisfies StartPaymentAttemptResult;
};

export const reconcilePaymentAttemptHandler = ({
  attemptId,
  receipt,
}: ReconcilePaymentAttemptInput): ReconcilePaymentAttemptResult => {
  if (!attemptId || !receipt?.terminalCommand || !receipt.reference) {
    throw new PaymentAttemptError("invalid_input", "Attempt receipt is invalid");
  }
  const attempt = paymentAttempts.get(attemptId);
  if (!attempt) {
    throw new PaymentAttemptError("attempt_not_found", "Payment attempt was not found");
  }
  if (attempt.status !== "pending") {
    throw new PaymentAttemptError("attempt_resolved", "Payment attempt is already resolved");
  }
  if (Date.now() >= attempt.expiresAt) {
    attempt.status = "expired";
    throw new PaymentAttemptError("attempt_expired", "Payment attempt has expired");
  }
  if (
    receipt.terminalCommand !== attempt.terminalCommand ||
    receipt.amountCents !== attempt.expectedAmountCents
  ) {
    attempt.status = "invalid";
    throw new PaymentAttemptError("receipt_invalid", "Payment receipt does not match attempt");
  }
  const order = pendingOrders.get(attempt.orderId);
  if (!order || order.paid) {
    throw new PaymentAttemptError("order_not_pending", "Order is no longer pending payment");
  }
  if (receipt.outcome !== "approved") {
    attempt.status = receipt.outcome;
    return {
      attemptId,
      orderId: attempt.orderId,
      attemptStatus: receipt.outcome,
      orderStatus: "payment_pending",
      orderNumber: null,
      amountCents: attempt.expectedAmountCents,
      reference: receipt.reference,
    };
  }
  attempt.status = "approved";
  order.paid = true;
  const orderNumber = `${order.prefix}-${nextPickupNumber++}`;
  return {
    attemptId,
    orderId: attempt.orderId,
    attemptStatus: "approved",
    orderStatus: "paid",
    orderNumber,
    amountCents: attempt.expectedAmountCents,
    reference: receipt.reference,
  };
};

export const createOrder = createServerFn({ method: "POST" })
  .validator((input: CreateOrderInput) => input)
  .handler(({ data }) => createOrderHandler(data));

export const startPaymentAttempt = createServerFn({ method: "POST" })
  .validator((input: StartPaymentAttemptInput) => input)
  .handler(({ data }) => startPaymentAttemptHandler(data));

export const reconcilePaymentAttempt = createServerFn({ method: "POST" })
  .validator((input: ReconcilePaymentAttemptInput) => input)
  .handler(({ data }) => reconcilePaymentAttemptHandler(data));
