import { describe, expect, test } from "bun:test";
import {
  createOrderHandler,
  expirePaymentAttemptHandler,
  PaymentAttemptError,
  startPaymentAttemptHandler,
} from "#/lib/payment";

describe("expirePaymentAttemptHandler", () => {
  test("rejects an unknown attempt", () => {
    expect(() => expirePaymentAttemptHandler({ attemptId: "missing" })).toThrow(
      PaymentAttemptError,
    );
  });

  test("marks a pending attempt expired for its owning order", () => {
    const order = createOrderHandler({
      lines: [
        {
          productId: "product-classic-cheese-toastie",
          quantity: 1,
          variantOptionIds: [],
          addonIds: [],
        },
      ],
    });
    const attempt = startPaymentAttemptHandler({ orderId: order.id });

    expect(expirePaymentAttemptHandler({ attemptId: attempt.id })).toEqual({
      attemptId: attempt.id,
      orderId: order.id,
      attemptStatus: "expired",
      orderStatus: "expired",
      amountCents: order.totalAmountCents,
    });
  });
});
