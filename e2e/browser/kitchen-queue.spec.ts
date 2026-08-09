import { expect, test } from "@playwright/test";
import { enterStaffPassword } from "./kitchen-queue-helpers";

test("staff renders a paid order from a mocked kitchen SSE event", async ({ page }) => {
  const orderNumber = "M-4242";
  const orderPaidEvent = {
    type: "order.paid" as const,
    orderId: "mock-order-1",
    orderNumber,
    status: "paid" as const,
    order: {
      id: "mock-order-1",
      orderNumber,
      status: "paid" as const,
      subtotalCents: 350,
      totalAmountCents: 350,
      createdAt: "2026-08-09T12:00:00.000Z",
      paidAt: "2026-08-09T12:00:01.000Z",
      items: [
        {
          id: "mock-item-1",
          productId: "espresso",
          productName: "Espresso",
          quantity: 1,
          unitPriceCents: 350,
          variants: [],
          addons: [],
        },
      ],
    },
  };
  let releaseSse!: () => void;
  const sseResponseReady = new Promise<void>((resolve) => {
    releaseSse = resolve;
  });
  let markSseRequest!: () => void;
  const sseRequestStarted = new Promise<void>((resolve) => {
    markSseRequest = resolve;
  });

  await page.route("**/api/kitchen/events", async (route) => {
    markSseRequest();
    await sseResponseReady;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: {
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
      body: `: connected\n\nevent: order.paid\ndata: ${JSON.stringify(orderPaidEvent)}\n\n`,
    });
  });

  await page.goto("/kitchen");
  await expect(page.getByRole("heading", { name: "Kitchen queue" })).toBeVisible();
  await enterStaffPassword(page);
  await expect(page.getByText("No active orders")).toBeVisible();
  await sseRequestStarted;
  releaseSse();

  const liveCard = page.getByTestId(`kitchen-order-${orderNumber}`);
  await expect(liveCard).toBeVisible();
  await expect(liveCard.getByText("Espresso")).toBeVisible();
  await expect(liveCard.getByText("Paid")).toBeVisible();
});
