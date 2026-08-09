import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChefHat, CircleCheck, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import {
  advanceOrder,
  claimStaffSession,
  type KitchenErrorCode,
  type KitchenEvent,
  type KitchenOrder,
  listActiveOrders,
} from "#/lib/kitchen";

const KITCHEN_QUERY_KEY = ["kitchen", "orders"] as const;
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const kitchenErrorCopy: Record<KitchenErrorCode, string> = {
  configuration: "Kitchen setup is temporarily unavailable. Try again.",
  invalid_password: "That staff password is not correct.",
  invalid_input: "Enter the staff password to continue.",
  staff_identity: "Your staff session has expired. Enter the password again.",
  order_not_found: "That order is no longer active. Refresh the queue.",
  invalid_transition: "That order changed on another screen. Refresh the queue.",
};

const formatCents = (cents: number): string => currency.format(cents / 100);

const formatCreatedAt = (createdAt: string): string =>
  new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(createdAt));

const formatDelta = (cents: number): string => {
  if (cents === 0) {
    return "";
  }
  return ` (${cents > 0 ? "+" : "−"}${formatCents(Math.abs(cents))})`;
};

const getKitchenErrorCode = (error: unknown): KitchenErrorCode | null => {
  if (error && typeof error === "object" && "code" in error) {
    const code = error.code;
    if (typeof code === "string" && code in kitchenErrorCopy) {
      return code as KitchenErrorCode;
    }
  }
  if (error instanceof Error && error.message in kitchenErrorCopy) {
    return error.message as KitchenErrorCode;
  }
  return null;
};

const errorCopy = (error: unknown, fallback: string): string => {
  const code = getKitchenErrorCode(error);
  return code ? kitchenErrorCopy[code] : fallback;
};

export const applyKitchenEvent = (
  orders: KitchenOrder[] | undefined,
  event: KitchenEvent,
): KitchenOrder[] => {
  const current = orders ?? [];
  if (event.type === "order.paid") {
    const next = current.filter((order) => order.id !== event.order.id);
    return [...next, event.order].sort((first, second) =>
      first.createdAt.localeCompare(second.createdAt),
    );
  }
  if (event.status === "done") {
    return current.filter((order) => order.id !== event.orderId);
  }
  return current.map((order) =>
    order.id === event.orderId ? { ...order, status: "preparing" } : order,
  );
};

declare global {
  interface Window {
    __kitchenInjectEvent?: (event: KitchenEvent) => void;
  }
}

const StaffHeader = ({
  live,
  onRefresh,
  refreshing,
}: {
  live: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}) => (
  <header className="border-b border-border bg-card">
    <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-5 px-5 py-4 sm:px-8">
      <div className="flex items-center gap-3">
        <ChefHat aria-hidden className="size-6 text-primary" strokeWidth={2} />
        <div>
          <p className="text-caption font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Staff tool
          </p>
          <h1 className="text-heading-s font-bold">Kitchen queue</h1>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span
          className="inline-flex items-center gap-1.5 text-body-s text-muted-foreground"
          data-testid="kitchen-live-status"
        >
          {live ? (
            <Wifi aria-hidden className="size-4 text-primary" strokeWidth={2} />
          ) : (
            <WifiOff aria-hidden className="size-4" strokeWidth={2} />
          )}
          {live ? "Live updates on" : "Live updates off"}
        </span>
        <button
          aria-label="Refresh"
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-body-s font-semibold transition-colors hover:border-primary focus-visible:outline-none focus-visible:shadow-focus disabled:opacity-60"
          disabled={refreshing}
          onClick={onRefresh}
          type="button"
        >
          <RefreshCw aria-hidden className={refreshing ? "size-4 animate-spin" : "size-4"} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>
    </div>
  </header>
);

const StaffGate = ({
  password,
  error,
  pending,
  onPasswordChange,
  onSubmit,
}: {
  password: string;
  error: string | null;
  pending: boolean;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) => (
  <div className="flex min-h-dvh flex-col bg-background text-foreground">
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-5 py-4 sm:px-8">
        <ChefHat aria-hidden className="size-6 text-primary" strokeWidth={2} />
        <div>
          <p className="text-caption font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Staff tool
          </p>
          <h1 className="text-heading-s font-bold">Kitchen queue</h1>
        </div>
      </div>
    </header>
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-5 py-10 sm:px-8">
      <div className="rounded-lg bg-card p-6 shadow-md sm:p-8">
        <p className="text-body-s font-semibold text-primary">Staff access</p>
        <h2 className="mt-2 text-heading-l font-bold">View active orders</h2>
        <p className="mt-3 text-body-m text-muted-foreground">
          Enter the shared staff password to view active orders.
        </p>
        <form className="mt-6 flex flex-col gap-4" onSubmit={onSubmit}>
          <div className="flex flex-col gap-2">
            <label className="text-body-m font-semibold" htmlFor="staff-password">
              Shared staff password
            </label>
            <input
              autoComplete="current-password"
              className="min-h-11 rounded-md border border-input bg-background px-4 py-2.5 text-body-l outline-none transition-shadow focus-visible:shadow-focus"
              id="staff-password"
              onChange={(event) => onPasswordChange(event.target.value)}
              type="password"
              value={password}
            />
          </div>
          {error ? (
            <p aria-live="polite" className="text-body-s text-destructive">
              {error}
            </p>
          ) : null}
          <button
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-5 py-2.5 font-semibold text-primary-foreground transition-transform duration-150 active:scale-[0.98] disabled:opacity-60"
            disabled={pending}
            type="submit"
          >
            {pending ? "Checking…" : "Continue"}
          </button>
        </form>
      </div>
    </main>
  </div>
);

const OrderCard = ({
  order,
  actionError,
  actionPending,
  onAdvance,
}: {
  order: KitchenOrder;
  actionError: string | null;
  actionPending: boolean;
  onAdvance: (order: KitchenOrder) => void;
}) => (
  <article
    className="flex flex-col gap-5 rounded-lg border border-border bg-card p-5 shadow-sm"
    data-testid={`kitchen-order-${order.orderNumber}`}
  >
    <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
      <div>
        <p className="text-caption font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Order
        </p>
        <p className="mt-1 text-display-m font-extrabold leading-none tracking-tight">
          {order.orderNumber}
        </p>
      </div>
      <span
        className={
          order.status === "paid"
            ? "rounded-pill bg-warning-subtle px-3 py-1 text-body-s font-semibold text-foreground"
            : "rounded-pill bg-accent-subtle px-3 py-1 text-body-s font-semibold text-primary"
        }
      >
        {order.status === "paid" ? "Paid" : "Preparing"}
      </span>
    </div>

    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-body-s text-muted-foreground">
      <span>{formatCreatedAt(order.createdAt)}</span>
      <span className="font-semibold text-foreground">
        {formatCents(order.subtotalCents)} subtotal · {formatCents(order.totalAmountCents)} total
      </span>
    </div>

    <ul className="flex flex-col gap-4" aria-label={`Items in order ${order.orderNumber}`}>
      {order.items.map((item) => (
        <li className="flex flex-col gap-2" key={item.id}>
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-body-m font-semibold">
              {item.quantity} × {item.productName}
            </span>
            <span className="text-body-s text-muted-foreground">
              {formatCents(item.unitPriceCents)}
            </span>
          </div>
          {item.variants.length > 0 || item.addons.length > 0 ? (
            <ul className="flex flex-wrap gap-x-3 gap-y-1 pl-5 text-body-s text-muted-foreground">
              {item.variants.map((variant) => (
                <li key={variant.id}>
                  {variant.optionName}
                  {formatDelta(variant.priceDeltaCents)}
                </li>
              ))}
              {item.addons.map((addon) => (
                <li key={addon.id}>
                  {addon.addonName}
                  {formatDelta(addon.priceDeltaCents)}
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>

    {actionError ? (
      <p
        aria-live="polite"
        className="rounded-md bg-danger-subtle px-3 py-2 text-body-s text-destructive"
      >
        {actionError}
      </p>
    ) : null}
    <button
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 font-semibold text-primary-foreground transition-transform duration-150 active:scale-[0.98] disabled:opacity-60"
      disabled={actionPending}
      onClick={() => onAdvance(order)}
      type="button"
    >
      {order.status === "paid" ? <CircleCheck aria-hidden className="size-4" /> : null}
      {actionPending ? "Saving…" : order.status === "paid" ? "Start preparing" : "Done"}
    </button>
  </article>
);

export const KitchenScreen = () => {
  const queryClient = useQueryClient();
  const [staffReady, setStaffReady] = useState(false);
  const [password, setPassword] = useState("");
  const [gateError, setGateError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});

  const ordersQuery = useQuery({
    queryKey: KITCHEN_QUERY_KEY,
    queryFn: () => listActiveOrders(),
    enabled: staffReady,
  });

  const claimMutation = useMutation({
    mutationFn: (value: string) => claimStaffSession({ data: { password: value } }),
    onSuccess: () => {
      setGateError(null);
      setStaffReady(true);
    },
    onError: (error) => {
      setGateError(errorCopy(error, "We could not verify that password. Try again."));
    },
  });

  const advanceMutation = useMutation({
    mutationFn: ({ orderId, toStatus }: { orderId: string; toStatus: "preparing" | "done" }) =>
      advanceOrder({ data: { orderId, toStatus } }),
    onMutate: ({ orderId }) => {
      setActionErrors((current) => {
        const next = { ...current };
        delete next[orderId];
        return next;
      });
    },
    onSuccess: (event) => {
      queryClient.setQueryData<KitchenOrder[]>(KITCHEN_QUERY_KEY, (orders) =>
        applyKitchenEvent(orders, event),
      );
    },
    onError: (error, { orderId }) => {
      const code = getKitchenErrorCode(error);
      if (code === "staff_identity") {
        setStaffReady(false);
        setGateError(kitchenErrorCopy.staff_identity);
        return;
      }
      setActionErrors((current) => ({
        ...current,
        [orderId]: errorCopy(error, "We could not update that order. Try again."),
      }));
    },
  });

  useEffect(() => {
    if (!staffReady) {
      return;
    }

    const source = new EventSource("/api/kitchen/events");
    const apply = (event: KitchenEvent) => {
      queryClient.setQueryData<KitchenOrder[]>(KITCHEN_QUERY_KEY, (orders) =>
        applyKitchenEvent(orders, event),
      );
    };
    const onOpen = () => setLive(true);
    const onError = () => setLive(false);
    const eventTypes: KitchenEvent["type"][] = ["order.paid", "order.preparing", "order.done"];
    const handlers = eventTypes.map((eventType) => {
      const handler = (message: Event) => {
        try {
          const event = JSON.parse((message as MessageEvent<string>).data) as KitchenEvent;
          if (event.type === eventType) {
            apply(event);
          }
        } catch {
          setLive(false);
        }
      };
      source.addEventListener(eventType, handler);
      return { eventType, handler };
    });

    source.onopen = onOpen;
    source.onerror = onError;
    window.__kitchenInjectEvent = apply;

    return () => {
      source.onopen = null;
      source.onerror = null;
      for (const { eventType, handler } of handlers) {
        source.removeEventListener(eventType, handler);
      }
      source.close();
      delete window.__kitchenInjectEvent;
    };
  }, [queryClient, staffReady]);

  useEffect(() => {
    if (!staffReady || !ordersQuery.error) {
      return;
    }
    if (getKitchenErrorCode(ordersQuery.error) === "staff_identity") {
      setStaffReady(false);
      setGateError(kitchenErrorCopy.staff_identity);
    }
  }, [ordersQuery.error, staffReady]);

  const submitPassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!password.trim()) {
      setGateError(kitchenErrorCopy.invalid_input);
      return;
    }
    setGateError(null);
    claimMutation.mutate(password);
  };

  if (!staffReady) {
    return (
      <StaffGate
        error={gateError}
        onPasswordChange={setPassword}
        onSubmit={submitPassword}
        password={password}
        pending={claimMutation.isPending}
      />
    );
  }

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: KITCHEN_QUERY_KEY });
  };

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <StaffHeader live={live} onRefresh={refresh} refreshing={ordersQuery.isFetching} />
      <main className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-8 sm:py-8">
        {ordersQuery.isLoading ? (
          <p className="rounded-md bg-card p-5 text-body-m text-muted-foreground">
            Loading active orders…
          </p>
        ) : null}
        {ordersQuery.isError ? (
          <p
            aria-live="polite"
            className="rounded-md bg-danger-subtle p-5 text-body-m text-destructive"
          >
            {errorCopy(
              ordersQuery.error,
              "We could not load active orders. Refresh and try again.",
            )}
          </p>
        ) : null}
        {!ordersQuery.isLoading && !ordersQuery.isError && ordersQuery.data?.length === 0 ? (
          <div className="rounded-md bg-card p-8 text-center shadow-sm">
            <h2 className="text-heading-m font-bold">No active orders</h2>
            <p className="mt-2 text-body-m text-muted-foreground">
              New paid orders will appear here.
            </p>
          </div>
        ) : null}
        {ordersQuery.data && ordersQuery.data.length > 0 ? (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {ordersQuery.data.map((order) => (
              <OrderCard
                actionError={actionErrors[order.id] ?? null}
                actionPending={
                  advanceMutation.isPending && advanceMutation.variables?.orderId === order.id
                }
                key={order.id}
                onAdvance={(selectedOrder) => {
                  advanceMutation.mutate({
                    orderId: selectedOrder.id,
                    toStatus: selectedOrder.status === "paid" ? "preparing" : "done",
                  });
                }}
                order={order}
              />
            ))}
          </div>
        ) : null}
      </main>
    </div>
  );
};
