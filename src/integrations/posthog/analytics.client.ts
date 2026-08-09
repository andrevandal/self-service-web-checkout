import "@tanstack/react-start/client-only";
import posthog from "posthog-js";

export const captureCartAbandoned = (properties: Record<string, unknown>): void => {
  posthog.capture("cart_abandoned", properties);
};
