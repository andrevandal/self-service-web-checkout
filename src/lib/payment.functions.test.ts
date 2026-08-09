import { beforeEach, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createTestDatabase, mockDatabaseModule, withStartContext } from "#/test/db-test-support";
import { kioskOrderCounters, orders, paymentAttempts } from "#/db/schema";
import type { PaymentReceipt, StartPaymentAttemptResult } from "./payment.functions.server";

const db = await createTestDatabase(`file:/tmp/self-service-payment-${randomUUID()}.db`);
await db.run(sql`
  INSERT INTO kiosks (id, name, prefix) VALUES
    ('kiosk-a', 'Alpha kiosk', 'A'),
    ('kiosk-b', 'Beta kiosk', 'B')
`);

let requestCookie = "";
const capturedDomainEvents: Array<{
  event: string;
  distinctId: string;
  properties: Record<string, unknown>;
}> = [];
mockDatabaseModule(db);
mock.module("#/env.server", () => ({
  serverEnv: { KIOSK_COOKIE_SECRET: "cookie-secret", POSTHOG_KEY: "" },
}));
mock.module("./posthog.server", () => ({
  captureDomainEvent: (event: string, distinctId: string, properties: Record<string, unknown>) => {
    capturedDomainEvents.push({ event, distinctId, properties });
  },
}));
mock.module("@tanstack/react-start/server", () => ({
  getRequestHeader: () => requestCookie,
  setResponseHeader: () => {},
}));

const { signKioskCookie } = await import("./kiosk-cookie.server");
const {
  PaymentAttemptError,
  expirePaymentAttemptHandler,
  reconcilePaymentAttemptHandler,
  startPaymentAttemptHandler,
} = await import("./payment.functions.server");

const setKioskCookie = (kioskId: string) => {
  requestCookie = `kiosk_session=${signKioskCookie(
    { kioskId, issuedAt: 1_754_672_000_000 },
    "cookie-secret",
  )}`;
};

const insertPendingOrder = async ({
  id = `order-${randomUUID()}`,
  kioskId = "kiosk-a",
  totalAmountCents = 1_250,
}: {
  id?: string;
  kioskId?: string;
  totalAmountCents?: number;
} = {}) => {
  await db.insert(orders).values({
    id,
    kioskId,
    status: "payment_pending",
    orderNumber: null,
    subtotalCents: totalAmountCents,
    totalAmountCents,
    paidAt: null,
  });
  return id;
};

const approvedReceipt = (
  attempt: StartPaymentAttemptResult,
  overrides: Partial<PaymentReceipt> = {},
): PaymentReceipt => ({
  terminalCommand: attempt.terminalCommand,
  reference: "receipt-reference",
  amountCents: attempt.expectedAmountCents,
  method: attempt.method,
  outcome: "approved",
  ...overrides,
});

const currentServiceDate = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.TZ || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

beforeEach(async () => {
  setKioskCookie("kiosk-a");
  capturedDomainEvents.length = 0;
  await db.delete(paymentAttempts);
  await db.delete(orders);
  await db.delete(kioskOrderCounters);
});

test("approved reconciliation marks the order paid and allocates a kiosk-prefixed number", async () => {
  await db.insert(kioskOrderCounters).values({
    kioskId: "kiosk-a",
    serviceDate: "2000-01-01",
    nextNumber: 41,
  });
  const orderId = await insertPendingOrder({ id: "order-1" });

  const attempt = await withStartContext(() =>
    startPaymentAttemptHandler({ orderId, method: "credit" }),
  );
  expect(attempt).toMatchObject({
    orderId,
    status: "pending",
    expectedAmountCents: 1_250,
  });
  expect(attempt.terminalCommand).toStartWith("fake-terminal:");
  expect(Number.isNaN(Date.parse(attempt.expiresAt))).toBe(false);

  const result = await withStartContext(() =>
    reconcilePaymentAttemptHandler({
      attemptId: attempt.id,
      receipt: approvedReceipt(attempt, { reference: "receipt-1" }),
    }),
  );

  expect(result).toEqual({
    attemptId: attempt.id,
    orderId,
    attemptStatus: "approved",
    orderStatus: "paid",
    orderNumber: "A-1",
    amountCents: 1_250,
    reference: "receipt-1",
  });
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  expect(order).toMatchObject({
    id: orderId,
    kioskId: "kiosk-a",
    status: "paid",
    orderNumber: "A-1",
    totalAmountCents: 1_250,
  });
  expect(order.paidAt).toBeInstanceOf(Date);
  const [storedAttempt] = await db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.id, attempt.id));
  expect(storedAttempt).toMatchObject({
    id: attempt.id,
    orderId,
    status: "approved",
    terminalCommand: attempt.terminalCommand,
    receipt: "receipt-1",
    expectedAmountCents: 1_250,
  });
  expect(storedAttempt.resolvedAt).toBeInstanceOf(Date);

  const [todayCounter] = await db
    .select()
    .from(kioskOrderCounters)
    .where(
      sql`${kioskOrderCounters.kioskId} = 'kiosk-a' AND ${kioskOrderCounters.serviceDate} = ${currentServiceDate()}`,
    );
  expect(todayCounter).toMatchObject({ kioskId: "kiosk-a", nextNumber: 2 });

  const secondOrderId = await insertPendingOrder({ id: "order-2" });
  const secondAttempt = await withStartContext(() =>
    startPaymentAttemptHandler({ orderId: secondOrderId, method: "credit" }),
  );
  const secondResult = await withStartContext(() =>
    reconcilePaymentAttemptHandler({
      attemptId: secondAttempt.id,
      receipt: approvedReceipt(secondAttempt, { reference: "receipt-2" }),
    }),
  );
  expect(secondResult.orderNumber).toBe("A-2");
  const [updatedCounter] = await db
    .select()
    .from(kioskOrderCounters)
    .where(
      sql`${kioskOrderCounters.kioskId} = 'kiosk-a' AND ${kioskOrderCounters.serviceDate} = ${currentServiceDate()}`,
    );
  expect(updatedCounter.nextNumber).toBe(3);
  const [oldCounter] = await db
    .select()
    .from(kioskOrderCounters)
    .where(
      sql`${kioskOrderCounters.kioskId} = 'kiosk-a' AND ${kioskOrderCounters.serviceDate} = '2000-01-01'`,
    );
  expect(oldCounter.nextNumber).toBe(41);
});

test("reconciliation rejects a receipt from a different kiosk without changing the attempt", async () => {
  const orderId = await insertPendingOrder({ id: "order-owner" });
  const attempt = await withStartContext(() =>
    startPaymentAttemptHandler({ orderId, method: "credit" }),
  );
  setKioskCookie("kiosk-b");

  await expect(
    withStartContext(() =>
      reconcilePaymentAttemptHandler({
        attemptId: attempt.id,
        receipt: approvedReceipt(attempt),
      }),
    ),
  ).rejects.toMatchObject({ code: "attempt_ownership" });

  const [storedAttempt] = await db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.id, attempt.id));
  expect(storedAttempt).toMatchObject({ status: "pending", receipt: null, resolvedAt: null });
});

test("reconciliation records an expired attempt and rejects it", async () => {
  const orderId = await insertPendingOrder({ id: "order-expired" });
  const attempt = await withStartContext(() =>
    startPaymentAttemptHandler({ orderId, method: "credit" }),
  );
  await db
    .update(paymentAttempts)
    .set({ expiresAt: new Date(0) })
    .where(eq(paymentAttempts.id, attempt.id));

  await expect(
    withStartContext(() =>
      reconcilePaymentAttemptHandler({
        attemptId: attempt.id,
        receipt: approvedReceipt(attempt),
      }),
    ),
  ).rejects.toMatchObject({ code: "attempt_expired" });

  const [storedAttempt] = await db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.id, attempt.id));
  expect(storedAttempt.status).toBe("expired");
  expect(storedAttempt.resolvedAt).toBeInstanceOf(Date);
});

test("reconciliation rejects an already-resolved attempt without allocating twice", async () => {
  const orderId = await insertPendingOrder({ id: "order-resolved" });
  const attempt = await withStartContext(() =>
    startPaymentAttemptHandler({ orderId, method: "credit" }),
  );
  const firstResult = await withStartContext(() =>
    reconcilePaymentAttemptHandler({
      attemptId: attempt.id,
      receipt: approvedReceipt(attempt),
    }),
  );

  await expect(
    withStartContext(() =>
      reconcilePaymentAttemptHandler({
        attemptId: attempt.id,
        receipt: approvedReceipt(attempt, { reference: "second-receipt" }),
      }),
    ),
  ).rejects.toMatchObject({ code: "attempt_resolved" });

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  expect(order.orderNumber).toBe(firstResult.orderNumber);
  const [counter] = await db
    .select()
    .from(kioskOrderCounters)
    .where(
      sql`${kioskOrderCounters.kioskId} = 'kiosk-a' AND ${kioskOrderCounters.serviceDate} = ${currentServiceDate()}`,
    );
  expect(counter.nextNumber).toBe(2);
});

test("reconciliation records a wrong amount as invalid", async () => {
  const orderId = await insertPendingOrder({ id: "order-wrong-amount" });
  const attempt = await withStartContext(() =>
    startPaymentAttemptHandler({ orderId, method: "credit" }),
  );

  await expect(
    withStartContext(() =>
      reconcilePaymentAttemptHandler({
        attemptId: attempt.id,
        receipt: approvedReceipt(attempt, { amountCents: attempt.expectedAmountCents + 1 }),
      }),
    ),
  ).rejects.toMatchObject({ code: "receipt_invalid" });

  const [storedAttempt] = await db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.id, attempt.id));
  expect(storedAttempt).toMatchObject({ status: "invalid", receipt: "receipt-reference" });
  expect(storedAttempt.resolvedAt).toBeInstanceOf(Date);
});

test("reconciliation records a command mismatch as invalid", async () => {
  const orderId = await insertPendingOrder({ id: "order-wrong-command" });
  const attempt = await withStartContext(() =>
    startPaymentAttemptHandler({ orderId, method: "credit" }),
  );

  await expect(
    withStartContext(() =>
      reconcilePaymentAttemptHandler({
        attemptId: attempt.id,
        receipt: approvedReceipt(attempt, { terminalCommand: "fake-terminal:wrong" }),
      }),
    ),
  ).rejects.toMatchObject({ code: "receipt_invalid" });

  const [storedAttempt] = await db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.id, attempt.id));
  expect(storedAttempt.status).toBe("invalid");
});

test("declined and unavailable attempts stay pending and can be retried with new attempts", async () => {
  const orderId = await insertPendingOrder({ id: "order-retry" });
  const declinedAttempt = await withStartContext(() =>
    startPaymentAttemptHandler({ orderId, method: "credit" }),
  );
  const declinedResult = await withStartContext(() =>
    reconcilePaymentAttemptHandler({
      attemptId: declinedAttempt.id,
      receipt: approvedReceipt(declinedAttempt, {
        reference: "declined-reference",
        outcome: "declined",
      }),
    }),
  );
  expect(declinedResult).toMatchObject({
    attemptStatus: "declined",
    orderStatus: "payment_pending",
    orderNumber: null,
  });

  const unavailableAttempt = await withStartContext(() =>
    startPaymentAttemptHandler({ orderId, method: "credit" }),
  );
  const unavailableResult = await withStartContext(() =>
    reconcilePaymentAttemptHandler({
      attemptId: unavailableAttempt.id,
      receipt: approvedReceipt(unavailableAttempt, {
        reference: "unavailable-reference",
        outcome: "unavailable",
      }),
    }),
  );
  expect(unavailableResult).toMatchObject({
    attemptStatus: "unavailable",
    orderStatus: "payment_pending",
    orderNumber: null,
  });
  expect(unavailableAttempt.id).not.toBe(declinedAttempt.id);
  expect(unavailableAttempt.terminalCommand).not.toBe(declinedAttempt.terminalCommand);

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  expect(order).toMatchObject({ status: "payment_pending", orderNumber: null, paidAt: null });
  const attempts = await db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.orderId, orderId));
  expect(attempts.map(({ status }) => status)).toEqual(["declined", "unavailable"]);
});

test("input validation rejects malformed attempt and receipt data", async () => {
  await expect(
    withStartContext(() => startPaymentAttemptHandler({ orderId: "", method: "credit" })),
  ).rejects.toMatchObject({ code: "invalid_input" });
  await expect(
    withStartContext(() =>
      reconcilePaymentAttemptHandler({
        attemptId: "",
        receipt: {
          terminalCommand: "command",
          reference: "reference",
          amountCents: 1_250,
          method: "credit",
          outcome: "approved",
        },
      }),
    ),
  ).rejects.toBeInstanceOf(PaymentAttemptError);
  await expect(
    withStartContext(() =>
      reconcilePaymentAttemptHandler({
        attemptId: "attempt",
        receipt: {
          terminalCommand: "command",
          reference: "",
          amountCents: 1_250,
          method: "credit",
          outcome: "approved",
        },
      }),
    ),
  ).rejects.toMatchObject({ code: "invalid_input" });
});

test("explicit expiry resolves the attempt and order and blocks reconciliation", async () => {
  const orderId = await insertPendingOrder({ id: "order-expire" });
  const attempt = await withStartContext(() =>
    startPaymentAttemptHandler({ orderId, method: "credit" }),
  );

  const result = await withStartContext(() =>
    expirePaymentAttemptHandler({ attemptId: attempt.id }),
  );

  expect(result).toEqual({
    attemptId: attempt.id,
    orderId,
    attemptStatus: "expired",
    orderStatus: "expired",
    amountCents: 1_250,
  });
  expect(
    await db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)),
  ).toEqual([{ status: "expired" }]);
  expect(
    await db

      .select({ status: paymentAttempts.status })
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, attempt.id)),
  ).toEqual([{ status: "expired" }]);

  await expect(
    withStartContext(() =>
      reconcilePaymentAttemptHandler({
        attemptId: attempt.id,
        receipt: approvedReceipt(attempt),
      }),
    ),
  ).rejects.toMatchObject({ code: "attempt_resolved" });
});
test("captures payment domain outcomes without exposing terminal data", async () => {
  const startedOrderId = await insertPendingOrder({ id: "order-started-event" });
  await withStartContext(() =>
    startPaymentAttemptHandler({ orderId: startedOrderId, method: "credit" }),
  );
  expect(capturedDomainEvents.map(({ event }) => event)).toEqual(["payment_attempt_started"]);

  const declinedOrderId = await insertPendingOrder({ id: "order-declined-event" });
  const declinedAttempt = await withStartContext(() =>
    startPaymentAttemptHandler({ orderId: declinedOrderId, method: "credit" }),
  );
  await withStartContext(() =>
    reconcilePaymentAttemptHandler({
      attemptId: declinedAttempt.id,
      receipt: {
        ...approvedReceipt(declinedAttempt),
        outcome: "declined",
        reference: "declined-reference",
      },
    }),
  );

  const approvedOrderId = await insertPendingOrder({ id: "order-approved-event" });
  const approvedAttempt = await withStartContext(() =>
    startPaymentAttemptHandler({ orderId: approvedOrderId, method: "credit" }),
  );
  await withStartContext(() =>
    reconcilePaymentAttemptHandler({
      attemptId: approvedAttempt.id,
      receipt: approvedReceipt(approvedAttempt, { reference: "approved-reference" }),
    }),
  );

  const expiredOrderId = await insertPendingOrder({ id: "order-safety-expired-event" });
  const expiredAttempt = await withStartContext(() =>
    startPaymentAttemptHandler({ orderId: expiredOrderId, method: "credit" }),
  );
  await db
    .update(paymentAttempts)
    .set({ expiresAt: new Date(0) })
    .where(eq(paymentAttempts.id, expiredAttempt.id));
  await expect(
    withStartContext(() =>
      reconcilePaymentAttemptHandler({
        attemptId: expiredAttempt.id,
        receipt: approvedReceipt(expiredAttempt),
      }),
    ),
  ).rejects.toMatchObject({ code: "attempt_expired" });

  const explicitOrderId = await insertPendingOrder({ id: "order-explicit-expired-event" });
  const explicitAttempt = await withStartContext(() =>
    startPaymentAttemptHandler({ orderId: explicitOrderId, method: "credit" }),
  );
  await withStartContext(() => expirePaymentAttemptHandler({ attemptId: explicitAttempt.id }));

  expect(capturedDomainEvents.map(({ event }) => event)).toEqual([
    "payment_attempt_started",
    "payment_attempt_started",
    "payment_attempt_result",
    "payment_attempt_started",
    "payment_attempt_result",
    "order_paid",
    "payment_attempt_started",
    "payment_attempt_result",
    "payment_attempt_started",
    "payment_attempt_result",
    "order_expired",
  ]);
  expect(capturedDomainEvents.every(({ distinctId }) => distinctId === "kiosk-a")).toBe(true);
  expect(capturedDomainEvents.every(({ properties }) => !("receipt" in properties))).toBe(true);
});
