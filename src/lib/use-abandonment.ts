import { usePostHog } from "@posthog/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  initialIdleTimerState,
  transitionIdleTimer,
  type IdleTimerConfig,
  type IdleTimerState,
} from "#/lib/idle-timer";
import { subtotalCents, type CartState } from "#/lib/cart";
import { expirePaymentAttempt } from "#/lib/payment";

export type PaymentContext = {
  phase:
    | "creating_order"
    | "starting_attempt"
    | "taking_payment"
    | "reconciling"
    | "failed"
    | "confirmed";
  orderId: string | null;
  attemptId: string | null;
};

export type UseAbandonmentInput = {
  cart: CartState;
  kioskId: string;
  payment: PaymentContext | null;
  onClearCart: () => void;
  onCancelPayment: () => void;
};

const DEFAULT_IDLE_TIMEOUT_MS = 45_000;
const DEFAULT_COUNTDOWN_SECONDS = 15;

const readNonNegativeInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

const readConfig = (): IdleTimerConfig => ({
  idleTimeoutMs: readNonNegativeInteger(
    import.meta.env.VITE_CART_IDLE_TIMEOUT_MS,
    DEFAULT_IDLE_TIMEOUT_MS,
  ),
  countdownSeconds: Math.max(
    1,
    readNonNegativeInteger(
      import.meta.env.VITE_CART_IDLE_COUNTDOWN_SECONDS,
      DEFAULT_COUNTDOWN_SECONDS,
    ),
  ),
});

const cloneCart = (cart: CartState): CartState =>
  cart.map((line) => ({
    ...line,
    variants: line.variants.map((variant) => ({ ...variant })),
    addons: line.addons.map((addon) => ({ ...addon })),
  }));

const isPendingPayment = (payment: PaymentContext | null): payment is PaymentContext =>
  payment !== null && payment.phase !== "confirmed";

export const useAbandonment = ({
  cart,
  kioskId,
  payment,
  onClearCart,
  onCancelPayment,
}: UseAbandonmentInput) => {
  const posthog = usePostHog();
  const configRef = useRef<IdleTimerConfig | null>(null);
  if (configRef.current === null) {
    configRef.current = readConfig();
  }
  const config = configRef.current;
  const paymentSession = payment !== null;
  const active = cart.length > 0 && payment?.phase !== "confirmed";
  const [state, setState] = useState<IdleTimerState>(() =>
    initialIdleTimerState(active, Date.now(), config),
  );
  const [expiryPending, setExpiryPending] = useState(false);
  const idleTimeoutRef = useRef<number | null>(null);
  const countdownIntervalRef = useRef<number | null>(null);
  const cartRef = useRef(cart);
  const kioskIdRef = useRef(kioskId);
  const paymentRef = useRef(payment);
  const onClearCartRef = useRef(onClearCart);
  const onCancelPaymentRef = useRef(onCancelPayment);
  const snapshotRef = useRef<CartState>([]);
  const mountedRef = useRef(true);
  const expiryHandledRef = useRef(false);

  useEffect(() => {
    cartRef.current = cart;
    kioskIdRef.current = kioskId;
    paymentRef.current = payment;
    onClearCartRef.current = onClearCart;
    onCancelPaymentRef.current = onCancelPayment;
  }, [cart, kioskId, onCancelPayment, onClearCart, payment]);

  const clearTimers = useCallback(() => {
    if (idleTimeoutRef.current !== null) {
      window.clearTimeout(idleTimeoutRef.current);
      idleTimeoutRef.current = null;
    }
    if (countdownIntervalRef.current !== null) {
      window.clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearTimers();
    expiryHandledRef.current = false;
    setExpiryPending(false);
    if (!cartRef.current.length || paymentRef.current?.phase === "confirmed") {
      setState({ phase: "inactive" });
      return;
    }
    setState(initialIdleTimerState(true, Date.now(), config));
    idleTimeoutRef.current = window.setTimeout(() => {
      const now = Date.now();
      snapshotRef.current = cloneCart(cartRef.current);
      setState((current) => transitionIdleTimer(current, { type: "idle_timeout", now }, config));
    }, config.idleTimeoutMs);
  }, [clearTimers, config]);

  useEffect(() => {
    reset();
    return clearTimers;
  }, [active, clearTimers, paymentSession, reset]);

  useEffect(() => {
    if (state.phase !== "warning") {
      return;
    }
    countdownIntervalRef.current = window.setInterval(() => {
      setState((current) =>
        transitionIdleTimer(current, { type: "countdown_tick", now: Date.now() }, config),
      );
    }, 1_000);
    return () => {
      if (countdownIntervalRef.current !== null) {
        window.clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };
  }, [config, state.phase]);

  useEffect(() => {
    if (state.phase !== "expired" || expiryHandledRef.current) {
      return;
    }
    expiryHandledRef.current = true;
    const expiredAt = state.expiredAt;
    const pendingPayment = paymentRef.current;
    if (isPendingPayment(pendingPayment)) {
      setExpiryPending(true);
      void (async () => {
        try {
          if (pendingPayment.attemptId) {
            await expirePaymentAttempt({
              data: { attemptId: pendingPayment.attemptId },
            });
          }
        } catch {
          // Release the kiosk even if the local seam rejects; the backend owns expiry.
        }
        if (!mountedRef.current) {
          return;
        }
        onCancelPaymentRef.current();
        onClearCartRef.current();
        setExpiryPending(false);
      })();
      return;
    }

    const abandonedCart = snapshotRef.current;
    try {
      if (abandonedCart.length > 0) {
        posthog.capture("cart_abandoned", {
          kiosk_id: kioskIdRef.current,
          cart_lines: abandonedCart,
          item_count: abandonedCart.length,
          subtotal_cents: subtotalCents(abandonedCart),
          currency: "USD",
          idle_duration_ms: Math.max(0, expiredAt - state.startedAt),
          abandoned_at: new Date(expiredAt).toISOString(),
        });
      }
    } catch {
      // Analytics failure must not strand the cart.
    }
    onClearCartRef.current();
  }, [posthog, state]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimers();
    };
  }, [clearTimers]);

  return {
    warningOpen: state.phase === "warning" || expiryPending,
    secondsRemaining: state.phase === "warning" ? state.secondsRemaining : 0,
    reset,
  };
};
