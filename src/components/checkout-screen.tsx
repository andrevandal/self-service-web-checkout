import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import type { CartState } from "#/lib/cart";
import {
  cartToCreateOrderInput,
  type CreateOrderInput,
  type CreateOrderResult,
} from "#/lib/checkout";
import {
  createOrder,
  reconcilePaymentAttempt,
  startPaymentAttempt,
  type PaymentReceipt,
} from "#/lib/payment";
import { printReceipt } from "#/lib/printer";
import { executeTerminalCommand } from "#/lib/terminal";

export type CheckoutScreenProps = {
  cart: CartState;
  onCancel: () => void;
  onComplete: () => void;
  onPaymentStateChange: (state: {
    phase: CheckoutPhase;
    orderId: string | null;
    attemptId: string | null;
  }) => void;
};

export type CheckoutPhase =
  | "creating_order"
  | "starting_attempt"
  | "taking_payment"
  | "reconciling"
  | "failed"
  | "confirmed";

const PAYMENT_FAILURE_COPY = "Payment didn’t go through. Try again.";
const START_FAILURE_COPY = "We couldn’t start payment. Check your order and try again.";

const isBusy = (phase: CheckoutPhase): boolean =>
  phase === "creating_order" ||
  phase === "starting_attempt" ||
  phase === "taking_payment" ||
  phase === "reconciling";

const busyCopy = (phase: CheckoutPhase): string => {
  switch (phase) {
    case "creating_order":
      return "Preparing your order";
    case "starting_attempt":
      return "Preparing payment";
    case "reconciling":
      return "Confirming payment";
    default:
      return "Taking payment";
  }
};

export const CheckoutScreen = ({
  cart,
  onCancel,
  onComplete,
  onPaymentStateChange,
}: CheckoutScreenProps) => {
  const mountedRef = useRef(true);
  const createPendingOrderRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const [phase, setPhase] = useState<CheckoutPhase>("creating_order");
  const [order, setOrder] = useState<CreateOrderResult | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [failureMessage, setFailureMessage] = useState(START_FAILURE_COPY);

  const createOrderMutation = useMutation({
    mutationFn: (input: CreateOrderInput) => createOrder({ data: input }),
  });
  const startAttemptMutation = useMutation({
    mutationFn: (input: { orderId: string }) => startPaymentAttempt({ data: input }),
  });
  const reconcileMutation = useMutation({
    mutationFn: (input: { attemptId: string; receipt: PaymentReceipt }) =>
      reconcilePaymentAttempt({ data: input }),
  });

  const runAttempt = async (orderId: string) => {
    if (!mountedRef.current) {
      return;
    }
    setFailureMessage(PAYMENT_FAILURE_COPY);
    setAttemptId(null);
    setPhase("starting_attempt");
    try {
      const attempt = await startAttemptMutation.mutateAsync({ orderId });
      if (!mountedRef.current) {
        return;
      }
      setAttemptId(attempt.id);
      setPhase("taking_payment");
      const receipt = await executeTerminalCommand(attempt.terminalCommand, {
        expectedAmountCents: attempt.expectedAmountCents,
      });
      if (!mountedRef.current) {
        return;
      }
      setPhase("reconciling");
      const result = await reconcileMutation.mutateAsync({
        attemptId: attempt.id,
        receipt,
      });
      if (!mountedRef.current) {
        return;
      }
      if (result.attemptStatus !== "approved" || !result.orderNumber) {
        setFailureMessage(PAYMENT_FAILURE_COPY);
        setPhase("failed");
        return;
      }
      await printReceipt(receipt);
      if (!mountedRef.current) {
        return;
      }
      setOrderNumber(result.orderNumber);
      setPhase("confirmed");
    } catch {
      if (mountedRef.current) {
        setFailureMessage(PAYMENT_FAILURE_COPY);
        setPhase("failed");
      }
    }
  };

  const createPendingOrder = async () => {
    setPhase("creating_order");
    setFailureMessage(START_FAILURE_COPY);
    try {
      const createdOrder = await createOrderMutation.mutateAsync(cartToCreateOrderInput(cart));
      if (!mountedRef.current) {
        return;
      }
      setOrder(createdOrder);
      await runAttempt(createdOrder.id);
    } catch {
      if (mountedRef.current) {
        setFailureMessage(START_FAILURE_COPY);
        setPhase("failed");
      }
    }
  };
  createPendingOrderRef.current = createPendingOrder;

  useEffect(() => {
    void createPendingOrderRef.current();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    onPaymentStateChange({
      phase,
      orderId: order?.id ?? null,
      attemptId,
    });
  }, [attemptId, onPaymentStateChange, order?.id, phase]);

  const confirmationPhase = phase === "confirmed";
  useEffect(() => {
    if (!confirmationPhase) {
      return;
    }
    const timeout = window.setTimeout(onComplete, 2_000);
    return () => window.clearTimeout(timeout);
  }, [confirmationPhase, onComplete]);

  if (phase === "confirmed") {
    return (
      <main
        aria-live="polite"
        className="flex h-dvh min-h-dvh items-center justify-center bg-background px-6 py-10 text-center"
      >
        <div className="flex max-w-xl flex-col items-center gap-5">
          <p className="text-body-l font-semibold text-primary">Payment complete</p>
          <h1 className="text-display-xl font-extrabold leading-none">Payment complete</h1>
          <div>
            <p className="text-body-s font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Pickup number
            </p>
            <h2 className="mt-3 text-display-xl font-extrabold leading-none text-primary">
              {orderNumber}
            </h2>
          </div>
          <p className="text-body-l text-muted-foreground">Your receipt is printing</p>
        </div>
      </main>
    );
  }

  if (phase === "failed") {
    return (
      <main
        aria-live="assertive"
        className="flex h-dvh min-h-dvh items-center justify-center bg-background px-6 py-10"
      >
        <div className="flex w-full max-w-xl flex-col items-center gap-6 rounded-lg bg-card p-8 text-center shadow-md">
          <div>
            <p className="text-body-s font-semibold text-primary">Checkout</p>
            <h1 className="mt-2 text-display-m font-extrabold">Payment didn’t go through</h1>
          </div>
          <p className="text-body-l text-muted-foreground">{failureMessage}</p>
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
            <button
              className="inline-flex min-h-12 items-center justify-center rounded-pill bg-primary px-6 py-3 font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              onClick={() => {
                if (order) {
                  void runAttempt(order.id);
                } else {
                  void createPendingOrder();
                }
              }}
              type="button"
            >
              Retry
            </button>
            <button
              className="inline-flex min-h-12 items-center justify-center rounded-pill border border-border px-6 py-3 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              onClick={onCancel}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-dvh min-h-dvh items-center justify-center bg-background px-6 py-10 text-center">
      <div className="flex max-w-xl flex-col items-center gap-5">
        <LoaderCircle aria-hidden className="size-12 animate-spin text-primary" strokeWidth={2} />
        <h1 className="text-display-m font-extrabold">{busyCopy(phase)}</h1>
        <p aria-live="polite" className="text-body-l text-muted-foreground">
          {phase === "taking_payment"
            ? "Follow the instructions on the terminal"
            : "Please wait a moment"}
        </p>
        <button
          className="mt-3 inline-flex min-h-12 items-center justify-center rounded-pill border border-border px-6 py-3 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isBusy(phase)}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
      </div>
    </main>
  );
};
