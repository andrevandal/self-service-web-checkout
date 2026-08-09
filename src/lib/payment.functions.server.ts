// Server-only payment handlers are kept behind the client-safe function wrapper.
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as v from "valibot";
import { serverEnv } from "#/env.server";
import { db } from "#/db/client.server";
import { kioskOrderCounters, kiosks, orders, paymentAttempts } from "#/db/schema";
import { readKioskCookie } from "./kiosk-cookie.server";
import { getKitchenOrderSnapshot } from "./kitchen.functions.server";
import { kitchenEventDispatcher } from "./kitchen-events.server";
import { captureDomainEvent } from "./posthog.server";

const PAYMENT_ATTEMPT_EXPIRY_MS = 120_000;

export type PaymentMethod = "credit" | "debit";

// Distinct simulated processor/merchant tokens per payment method - a real
// integration would route credit and debit through different token/network
// rails even though both flow through the same physical pinpad
// (`executeTerminalCommand` in #/lib/terminal stays a single entry point
// regardless of which method is selected).
const PAYMENT_METHOD_TOKENS: Record<PaymentMethod, string> = {
  credit: "tok_sim_credit_default",
  debit: "tok_sim_debit_default",
};

export type PaymentAttemptStatus =
  | "pending"
  | "approved"
  | "declined"
  | "unavailable"
  | "invalid"
  | "expired";

export type PaymentReceipt = {
  terminalCommand: string;
  reference: string;
  amountCents: number;
  method: PaymentMethod;
  outcome: "approved" | "declined" | "unavailable";
};

export type StartPaymentAttemptInput = {
  orderId: string;
  method: PaymentMethod;
};

export type StartPaymentAttemptResult = {
  id: string;
  orderId: string;
  status: "pending";
  terminalCommand: string;
  expectedAmountCents: number;
  method: PaymentMethod;
  expiresAt: string;
};

export type ReconcilePaymentAttemptInput = {
  attemptId: string;
  receipt: PaymentReceipt;
};

export type ExpirePaymentAttemptInput = {
  attemptId: string;
};

export type ExpirePaymentAttemptResult = {
  attemptId: string;
  orderId: string;
  attemptStatus: "expired";
  orderStatus: "expired";
  amountCents: number;
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
    detail: string,
  ) {
    // `message` is the only Error property TanStack Start's RPC serializer
    // preserves across the client/server boundary (see
    // @tanstack/router-core's ShallowErrorPlugin). Using `code` as the
    // message lets client-side error-copy lookups key off `error.message`
    // after deserialization; `detail` stays available server-side.
    super(code);
    this.name = "PaymentAttemptError";
    this.cause = detail;
  }
}

type PaymentOutcomeEvent = {
  kioskId: string;
  orderId: string;
  attemptId: string;
  amountCents: number;
  outcome: "approved" | "declined" | "unavailable" | "invalid" | "expired";
  failureReason?: string;
  attemptCount: number;
  elapsedMs: number;
  orderElapsedMs?: number;
};

const toPaymentEventProperties = ({
  kioskId,
  orderId,
  attemptId,
  amountCents,
  outcome,
  failureReason,
  attemptCount,
  elapsedMs,
}: PaymentOutcomeEvent) => ({
  kiosk_id: kioskId,
  order_id: orderId,
  attempt_id: attemptId,
  amount_cents: amountCents,
  outcome,
  ...(failureReason ? { failure_reason: failureReason } : {}),
  attempt_count: attemptCount,
  elapsed_ms: elapsedMs,
});

const startPaymentAttemptInputSchema = v.object({
  orderId: v.pipe(v.string(), v.minLength(1)),
  method: v.picklist(["credit", "debit"]),
});

const paymentReceiptSchema = v.object({
  terminalCommand: v.pipe(v.string(), v.minLength(1)),
  reference: v.pipe(v.string(), v.minLength(1)),
  amountCents: v.pipe(v.number(), v.integer(), v.minValue(0)),
  method: v.picklist(["credit", "debit"]),
  outcome: v.picklist(["approved", "declined", "unavailable"]),
});

const reconcilePaymentAttemptInputSchema = v.object({
  attemptId: v.pipe(v.string(), v.minLength(1)),
  receipt: paymentReceiptSchema,
});
const expirePaymentAttemptInputSchema = v.object({
  attemptId: v.pipe(v.string(), v.minLength(1)),
});

const validateStartPaymentAttemptInput = (input: unknown): StartPaymentAttemptInput => {
  const result = v.safeParse(startPaymentAttemptInputSchema, input);
  if (!result.success) {
    throw new PaymentAttemptError("invalid_input", "Order id is required");
  }
  return result.output;
};

const validateReconcilePaymentAttemptInput = (input: unknown): ReconcilePaymentAttemptInput => {
  const result = v.safeParse(reconcilePaymentAttemptInputSchema, input);
  if (!result.success) {
    throw new PaymentAttemptError("invalid_input", "Attempt receipt is invalid");
  }
  return result.output;
};

const validateExpirePaymentAttemptInput = (input: unknown): ExpirePaymentAttemptInput => {
  const result = v.safeParse(expirePaymentAttemptInputSchema, input);
  if (!result.success) {
    throw new PaymentAttemptError("invalid_input", "Attempt id is required");
  }
  return result.output;
};

const expireAttemptInTransaction = async (
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  attemptId: string,
  orderId: string,
  now: Date,
  expireOrder: boolean,
) => {
  if (expireOrder) {
    const [expiredOrder] = await tx
      .update(orders)
      .set({ status: "expired" })
      .where(and(eq(orders.id, orderId), eq(orders.status, "payment_pending")))
      .returning({ id: orders.id });
    if (!expiredOrder) {
      throw new PaymentAttemptError("order_not_pending", "Order is no longer pending payment");
    }
  }

  const [expiredAttempt] = await tx
    .update(paymentAttempts)
    .set({ status: "expired", resolvedAt: now })
    .where(and(eq(paymentAttempts.id, attemptId), eq(paymentAttempts.status, "pending")))
    .returning({ id: paymentAttempts.id });
  if (!expiredAttempt) {
    throw new PaymentAttemptError("attempt_resolved", "Payment attempt is already resolved");
  }
};

export const startPaymentAttemptHandler = async (
  input: StartPaymentAttemptInput,
): Promise<StartPaymentAttemptResult> => {
  const data = validateStartPaymentAttemptInput(input);
  const secret = serverEnv.KIOSK_COOKIE_SECRET;
  if (!secret) {
    throw new PaymentAttemptError("configuration", "Kiosk cookie secret is not configured");
  }

  const cookie = readKioskCookie(secret);
  if (!cookie) {
    throw new PaymentAttemptError("kiosk_identity", "A valid kiosk session is required");
  }

  const transactionResult = await db.transaction(async (tx) => {
    const [kiosk] = await tx
      .select({ id: kiosks.id })
      .from(kiosks)
      .where(eq(kiosks.id, cookie.kioskId))
      .limit(1);
    if (!kiosk) {
      throw new PaymentAttemptError("kiosk_identity", "Kiosk session no longer exists");
    }

    const [order] = await tx
      .select({
        id: orders.id,
        kioskId: orders.kioskId,
        status: orders.status,
        totalAmountCents: orders.totalAmountCents,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(eq(orders.id, data.orderId))
      .limit(1);
    if (!order || order.kioskId !== cookie.kioskId || order.status !== "payment_pending") {
      throw new PaymentAttemptError(
        "order_not_pending",
        "Order is not available for a payment attempt",
      );
    }

    const previousAttempts = await tx
      .select({ id: paymentAttempts.id })
      .from(paymentAttempts)
      .where(eq(paymentAttempts.orderId, order.id));
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + PAYMENT_ATTEMPT_EXPIRY_MS);
    const id = randomUUID();
    const terminalCommand = `fake-terminal:${data.method}:${PAYMENT_METHOD_TOKENS[data.method]}:${randomUUID()}`;
    await tx.insert(paymentAttempts).values({
      id,
      orderId: order.id,
      status: "pending",
      method: data.method,
      terminalCommand,
      receipt: null,
      expectedAmountCents: order.totalAmountCents,
      createdAt,
      expiresAt,
      resolvedAt: null,
    });

    return {
      result: {
        id,
        orderId: order.id,
        status: "pending" as const,
        terminalCommand,
        expectedAmountCents: order.totalAmountCents,
        method: data.method,
        expiresAt: expiresAt.toISOString(),
      },
      kioskId: kiosk.id,
      orderCreatedAt: order.createdAt,
      createdAt,
      attemptCount: previousAttempts.length + 1,
    };
  });

  captureDomainEvent("payment_attempt_started", transactionResult.kioskId, {
    kiosk_id: transactionResult.kioskId,
    order_id: transactionResult.result.orderId,
    attempt_id: transactionResult.result.id,
    amount_cents: transactionResult.result.expectedAmountCents,
    attempt_count: transactionResult.attemptCount,
    elapsed_ms: Math.max(
      0,
      transactionResult.createdAt.getTime() - transactionResult.orderCreatedAt.getTime(),
    ),
  });

  return transactionResult.result;
};

export const expirePaymentAttemptHandler = async (
  input: ExpirePaymentAttemptInput,
): Promise<ExpirePaymentAttemptResult> => {
  const data = validateExpirePaymentAttemptInput(input);
  const secret = serverEnv.KIOSK_COOKIE_SECRET;
  if (!secret) {
    throw new PaymentAttemptError("configuration", "Kiosk cookie secret is not configured");
  }

  const cookie = readKioskCookie(secret);
  if (!cookie) {
    throw new PaymentAttemptError("kiosk_identity", "A valid kiosk session is required");
  }

  const transactionResult = await db.transaction(async (tx) => {
    const [kiosk] = await tx
      .select({ id: kiosks.id })
      .from(kiosks)
      .where(eq(kiosks.id, cookie.kioskId))
      .limit(1);
    if (!kiosk) {
      throw new PaymentAttemptError("kiosk_identity", "Kiosk session no longer exists");
    }

    const [attempt] = await tx
      .select({
        id: paymentAttempts.id,
        orderId: orders.id,
        orderKioskId: orders.kioskId,
        orderStatus: orders.status,
        orderCreatedAt: orders.createdAt,
        attemptStatus: paymentAttempts.status,
        expectedAmountCents: paymentAttempts.expectedAmountCents,
        attemptCreatedAt: paymentAttempts.createdAt,
      })
      .from(paymentAttempts)
      .innerJoin(orders, eq(paymentAttempts.orderId, orders.id))
      .where(eq(paymentAttempts.id, data.attemptId))
      .limit(1);

    if (!attempt) {
      throw new PaymentAttemptError("attempt_not_found", "Payment attempt was not found");
    }
    if (attempt.orderKioskId !== cookie.kioskId) {
      throw new PaymentAttemptError(
        "attempt_ownership",
        "Payment attempt belongs to another kiosk",
      );
    }
    if (attempt.attemptStatus !== "pending") {
      throw new PaymentAttemptError("attempt_resolved", "Payment attempt is already resolved");
    }
    if (attempt.orderStatus !== "payment_pending") {
      throw new PaymentAttemptError("order_not_pending", "Order is no longer pending payment");
    }

    const now = new Date();
    const attemptCount = await tx
      .select({ id: paymentAttempts.id })
      .from(paymentAttempts)
      .where(eq(paymentAttempts.orderId, attempt.orderId));
    await expireAttemptInTransaction(tx, attempt.id, attempt.orderId, now, true);

    return {
      result: {
        attemptId: attempt.id,
        orderId: attempt.orderId,
        attemptStatus: "expired" as const,
        orderStatus: "expired" as const,
        amountCents: attempt.expectedAmountCents,
      },
      event: {
        kioskId: attempt.orderKioskId,
        orderId: attempt.orderId,
        attemptId: attempt.id,
        amountCents: attempt.expectedAmountCents,
        outcome: "expired" as const,
        failureReason: "client_idle_timeout",
        attemptCount: attemptCount.length,
        elapsedMs: Math.max(0, now.getTime() - attempt.attemptCreatedAt.getTime()),
        orderElapsedMs: Math.max(0, now.getTime() - attempt.orderCreatedAt.getTime()),
      },
    };
  });

  captureDomainEvent(
    "payment_attempt_result",
    transactionResult.event.kioskId,
    toPaymentEventProperties(transactionResult.event),
  );
  captureDomainEvent("order_expired", transactionResult.event.kioskId, {
    kiosk_id: transactionResult.event.kioskId,
    order_id: transactionResult.event.orderId,
    attempt_id: transactionResult.event.attemptId,
    amount_cents: transactionResult.event.amountCents,
    outcome: "expired",
    failure_reason: "client_idle_timeout",
    attempt_count: transactionResult.event.attemptCount,
    elapsed_ms: transactionResult.event.orderElapsedMs ?? transactionResult.event.elapsedMs,
  });

  return transactionResult.result;
};

type ReconcileTransactionResult =
  | { kind: "result"; value: ReconcilePaymentAttemptResult; event: PaymentOutcomeEvent }
  | { kind: "terminal-error"; error: PaymentAttemptError; event: PaymentOutcomeEvent };

export const reconcilePaymentAttemptHandler = async (
  input: ReconcilePaymentAttemptInput,
): Promise<ReconcilePaymentAttemptResult> => {
  const data = validateReconcilePaymentAttemptInput(input);
  const secret = serverEnv.KIOSK_COOKIE_SECRET;
  if (!secret) {
    throw new PaymentAttemptError("configuration", "Kiosk cookie secret is not configured");
  }

  const cookie = readKioskCookie(secret);
  if (!cookie) {
    throw new PaymentAttemptError("kiosk_identity", "A valid kiosk session is required");
  }

  const transactionResult = await db.transaction<ReconcileTransactionResult>(async (tx) => {
    const [kiosk] = await tx
      .select({ id: kiosks.id })
      .from(kiosks)
      .where(eq(kiosks.id, cookie.kioskId))
      .limit(1);
    if (!kiosk) {
      throw new PaymentAttemptError("kiosk_identity", "Kiosk session no longer exists");
    }

    const [attempt] = await tx
      .select({
        id: paymentAttempts.id,
        orderId: orders.id,
        orderKioskId: orders.kioskId,
        orderStatus: orders.status,
        orderCreatedAt: orders.createdAt,
        kioskPrefix: kiosks.prefix,
        attemptStatus: paymentAttempts.status,
        terminalCommand: paymentAttempts.terminalCommand,
        expectedAmountCents: paymentAttempts.expectedAmountCents,
        expiresAt: paymentAttempts.expiresAt,
        attemptCreatedAt: paymentAttempts.createdAt,
      })
      .from(paymentAttempts)
      .innerJoin(orders, eq(paymentAttempts.orderId, orders.id))
      .innerJoin(kiosks, eq(orders.kioskId, kiosks.id))
      .where(eq(paymentAttempts.id, data.attemptId))
      .limit(1);

    if (!attempt) {
      throw new PaymentAttemptError("attempt_not_found", "Payment attempt was not found");
    }
    if (attempt.orderKioskId !== cookie.kioskId) {
      throw new PaymentAttemptError(
        "attempt_ownership",
        "Payment attempt belongs to another kiosk",
      );
    }
    if (attempt.attemptStatus !== "pending") {
      throw new PaymentAttemptError("attempt_resolved", "Payment attempt is already resolved");
    }
    if (attempt.orderStatus !== "payment_pending") {
      throw new PaymentAttemptError("order_not_pending", "Order is no longer pending payment");
    }

    const now = new Date();
    const attemptCount = await tx
      .select({ id: paymentAttempts.id })
      .from(paymentAttempts)
      .where(eq(paymentAttempts.orderId, attempt.orderId));
    const eventBase = {
      kioskId: attempt.orderKioskId,
      orderId: attempt.orderId,
      attemptId: attempt.id,
      amountCents: attempt.expectedAmountCents,
      attemptCount: attemptCount.length,
      elapsedMs: Math.max(0, now.getTime() - attempt.attemptCreatedAt.getTime()),
    };
    if (now.getTime() >= attempt.expiresAt.getTime()) {
      await expireAttemptInTransaction(tx, attempt.id, attempt.orderId, now, false);
      return {
        kind: "terminal-error",
        error: new PaymentAttemptError("attempt_expired", "Payment attempt has expired"),
        event: { ...eventBase, outcome: "expired" as const, failureReason: "expired" },
      };
    }

    if (
      data.receipt.terminalCommand !== attempt.terminalCommand ||
      data.receipt.amountCents !== attempt.expectedAmountCents
    ) {
      await tx
        .update(paymentAttempts)
        .set({ status: "invalid", receipt: data.receipt.reference, resolvedAt: now })
        .where(eq(paymentAttempts.id, attempt.id));
      return {
        kind: "terminal-error",
        error: new PaymentAttemptError("receipt_invalid", "Payment receipt does not match attempt"),
        event: { ...eventBase, outcome: "invalid" as const, failureReason: "receipt_invalid" },
      };
    }

    if (data.receipt.outcome !== "approved") {
      await tx
        .update(paymentAttempts)
        .set({ status: data.receipt.outcome, receipt: data.receipt.reference, resolvedAt: now })
        .where(eq(paymentAttempts.id, attempt.id));
      return {
        kind: "result",
        value: {
          attemptId: attempt.id,
          orderId: attempt.orderId,
          attemptStatus: data.receipt.outcome,
          orderStatus: "payment_pending",
          orderNumber: null,
          amountCents: attempt.expectedAmountCents,
          reference: data.receipt.reference,
        },
        event: {
          ...eventBase,
          outcome: data.receipt.outcome,
          failureReason: data.receipt.outcome,
        },
      };
    }

    const serviceDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: process.env.TZ || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const [counter] = await tx
      .insert(kioskOrderCounters)
      .values({ kioskId: attempt.orderKioskId, serviceDate, nextNumber: 2 })
      .onConflictDoUpdate({
        target: [kioskOrderCounters.kioskId, kioskOrderCounters.serviceDate],
        set: { nextNumber: sql`${kioskOrderCounters.nextNumber} + 1` },
      })
      .returning({ nextNumber: kioskOrderCounters.nextNumber });
    if (!counter) {
      throw new Error("Could not allocate an order number");
    }

    const orderNumber = `${attempt.kioskPrefix}-${counter.nextNumber - 1}`;
    const [paidOrder] = await tx
      .update(orders)
      .set({ status: "paid", orderNumber, paidAt: now })
      .where(and(eq(orders.id, attempt.orderId), eq(orders.status, "payment_pending")))
      .returning({ id: orders.id });

    if (!paidOrder) {
      throw new PaymentAttemptError("order_not_pending", "Order is no longer pending payment");
    }
    await tx
      .update(paymentAttempts)
      .set({ status: "approved", receipt: data.receipt.reference, resolvedAt: now })
      .where(eq(paymentAttempts.id, attempt.id));

    return {
      kind: "result",
      value: {
        attemptId: attempt.id,
        orderId: attempt.orderId,
        attemptStatus: "approved",
        orderStatus: "paid",
        orderNumber,
        amountCents: attempt.expectedAmountCents,
        reference: data.receipt.reference,
      },
      event: { ...eventBase, outcome: "approved" as const },
    };
  });

  captureDomainEvent(
    "payment_attempt_result",
    transactionResult.event.kioskId,
    toPaymentEventProperties(transactionResult.event),
  );

  if (transactionResult.kind === "terminal-error") {
    throw transactionResult.error;
  }

  if (transactionResult.value.orderStatus === "paid" && transactionResult.value.orderNumber) {
    captureDomainEvent("order_paid", transactionResult.event.kioskId, {
      kiosk_id: transactionResult.event.kioskId,
      order_id: transactionResult.event.orderId,
      attempt_id: transactionResult.event.attemptId,
      amount_cents: transactionResult.event.amountCents,
      outcome: "approved",
      attempt_count: transactionResult.event.attemptCount,
      elapsed_ms: transactionResult.event.elapsedMs,
    });

    const order = await getKitchenOrderSnapshot(transactionResult.value.orderId);
    if (!order) {
      throw new Error("Paid order snapshot could not be loaded");
    }
    kitchenEventDispatcher.emit({
      type: "order.paid",
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: "paid",
      order,
    });
  }

  return transactionResult.value;
};

export const startPaymentAttemptServerHandler = ({
  data,
}: {
  data: StartPaymentAttemptInput;
}): Promise<StartPaymentAttemptResult> => startPaymentAttemptHandler(data);

export const reconcilePaymentAttemptServerHandler = ({
  data,
}: {
  data: ReconcilePaymentAttemptInput;
}): Promise<ReconcilePaymentAttemptResult> => reconcilePaymentAttemptHandler(data);

export const expirePaymentAttemptServerHandler = ({
  data,
}: {
  data: ExpirePaymentAttemptInput;
}): Promise<ExpirePaymentAttemptResult> => expirePaymentAttemptHandler(data);
