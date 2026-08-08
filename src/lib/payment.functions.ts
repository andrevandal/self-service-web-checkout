import { createServerFn } from "@tanstack/react-start";
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as v from "valibot";
import { serverEnv } from "#/env.server";
import { db } from "#/db/client.server";
import { kioskOrderCounters, kiosks, orders, paymentAttempts } from "#/db/schema";
import { readKioskCookie } from "./kiosk-cookie.server";

const PAYMENT_ATTEMPT_EXPIRY_MS = 120_000;

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
  outcome: "approved" | "declined" | "unavailable";
};

export type StartPaymentAttemptInput = {
  orderId: string;
};

export type StartPaymentAttemptResult = {
  id: string;
  orderId: string;
  status: "pending";
  terminalCommand: string;
  expectedAmountCents: number;
  expiresAt: string;
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

const startPaymentAttemptInputSchema = v.object({
  orderId: v.pipe(v.string(), v.minLength(1)),
});

const paymentReceiptSchema = v.object({
  terminalCommand: v.pipe(v.string(), v.minLength(1)),
  reference: v.pipe(v.string(), v.minLength(1)),
  amountCents: v.pipe(v.number(), v.integer(), v.minValue(0)),
  outcome: v.picklist(["approved", "declined", "unavailable"]),
});

const reconcilePaymentAttemptInputSchema = v.object({
  attemptId: v.pipe(v.string(), v.minLength(1)),
  receipt: paymentReceiptSchema,
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

  return db.transaction(async (tx) => {
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

    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + PAYMENT_ATTEMPT_EXPIRY_MS);
    const id = randomUUID();
    const terminalCommand = `fake-terminal:${randomUUID()}`;
    await tx.insert(paymentAttempts).values({
      id,
      orderId: order.id,
      status: "pending",
      terminalCommand,
      receipt: null,
      expectedAmountCents: order.totalAmountCents,
      createdAt,
      expiresAt,
      resolvedAt: null,
    });

    return {
      id,
      orderId: order.id,
      status: "pending",
      terminalCommand,
      expectedAmountCents: order.totalAmountCents,
      expiresAt: expiresAt.toISOString(),
    };
  });
};

type ReconcileTransactionResult =
  | { kind: "result"; value: ReconcilePaymentAttemptResult }
  | { kind: "terminal-error"; error: PaymentAttemptError };

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
        kioskPrefix: kiosks.prefix,
        attemptStatus: paymentAttempts.status,
        terminalCommand: paymentAttempts.terminalCommand,
        expectedAmountCents: paymentAttempts.expectedAmountCents,
        expiresAt: paymentAttempts.expiresAt,
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
    if (now.getTime() >= attempt.expiresAt.getTime()) {
      await tx
        .update(paymentAttempts)
        .set({ status: "expired", resolvedAt: now })
        .where(eq(paymentAttempts.id, attempt.id));
      return {
        kind: "terminal-error",
        error: new PaymentAttemptError("attempt_expired", "Payment attempt has expired"),
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
    };
  });

  if (transactionResult.kind === "terminal-error") {
    throw transactionResult.error;
  }
  return transactionResult.value;
};

export const startPaymentAttempt = createServerFn({ method: "POST" })
  .validator((input) => validateStartPaymentAttemptInput(input))
  .handler(({ data }) => startPaymentAttemptHandler(data));

export const reconcilePaymentAttempt = createServerFn({ method: "POST" })
  .validator((input) => validateReconcilePaymentAttemptInput(input))
  .handler(({ data }) => reconcilePaymentAttemptHandler(data));
