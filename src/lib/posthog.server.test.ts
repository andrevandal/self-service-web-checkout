import { expect, mock, test } from "bun:test";

mock.module("#/env.server", () => ({
  serverEnv: { POSTHOG_KEY: "", POSTHOG_HOST: "" },
}));

const { captureDomainEvent } = await import("./posthog.server");

test("missing PostHog API key makes domain capture a no-op", () => {
  expect(() =>
    captureDomainEvent("order_expired", "kiosk-a", {
      kiosk_id: "kiosk-a",
      order_id: "order-1",
      attempt_id: "attempt-1",
      amount_cents: 1_250,
      outcome: "expired",
    }),
  ).not.toThrow();
});
