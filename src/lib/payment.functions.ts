import { createServerFn } from "@tanstack/react-start";
import type {
  ExpirePaymentAttemptInput,
  ReconcilePaymentAttemptInput,
  StartPaymentAttemptInput,
} from "./payment.functions.server";
import {
  expirePaymentAttemptServerHandler,
  reconcilePaymentAttemptServerHandler,
  startPaymentAttemptServerHandler,
} from "./payment.functions.server";

export type {
  ExpirePaymentAttemptInput,
  ExpirePaymentAttemptResult,
  PaymentAttemptErrorCode,
  PaymentAttemptStatus,
  PaymentReceipt,
  ReconcilePaymentAttemptInput,
  ReconcilePaymentAttemptResult,
  StartPaymentAttemptInput,
  StartPaymentAttemptResult,
} from "./payment.functions.server";

export const startPaymentAttempt = createServerFn({ method: "POST" })
  .validator((input: StartPaymentAttemptInput) => input)
  .handler(startPaymentAttemptServerHandler);

export const reconcilePaymentAttempt = createServerFn({ method: "POST" })
  .validator((input: ReconcilePaymentAttemptInput) => input)
  .handler(reconcilePaymentAttemptServerHandler);

export const expirePaymentAttempt = createServerFn({ method: "POST" })
  .validator((input: ExpirePaymentAttemptInput) => input)
  .handler(expirePaymentAttemptServerHandler);
