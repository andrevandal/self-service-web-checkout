import { PostHog } from "posthog-node";
import { serverEnv } from "#/env.server";

export type DomainEventName =
  | "payment_attempt_started"
  | "payment_attempt_result"
  | "order_paid"
  | "order_expired"
  | "kitchen_order_started"
  | "kitchen_order_done";

const posthog = (() => {
  if (!serverEnv.POSTHOG_KEY) {
    return null;
  }

  try {
    return new PostHog(serverEnv.POSTHOG_KEY, {
      host: serverEnv.POSTHOG_HOST || "https://us.i.posthog.com",
    });
  } catch {
    return null;
  }
})();

export const captureDomainEvent = (
  event: DomainEventName,
  distinctId: string,
  properties: Record<string, unknown>,
): void => {
  if (!posthog) {
    return;
  }

  try {
    posthog.capture({ distinctId, event, properties });
  } catch {
    // Analytics must never change the checkout or kitchen result.
  }
};
