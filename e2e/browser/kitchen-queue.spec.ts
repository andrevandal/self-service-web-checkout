import { expect, test } from "@playwright/test";
import { enterStaffPassword } from "./kitchen-queue-helpers";

test("staff can work the active queue and receive a paid SSE order", async ({ page }) => {
  await page.goto("/kitchen");

  await expect(page.getByRole("heading", { name: "Kitchen queue" })).toBeVisible();
  await enterStaffPassword(page);

  const fixtureCard = page.getByTestId("kitchen-order-A-101");
  await expect(fixtureCard).toBeVisible();
  await expect(fixtureCard.getByText("A-101")).toBeVisible();
  await expect(fixtureCard.getByText("Melted mushroom toastie")).toBeVisible();
  await expect(fixtureCard.getByText("Sourdough")).toBeVisible();
  await expect(fixtureCard.getByText("Extra cheese")).toBeVisible();
  await expect(fixtureCard.getByText("Paid")).toBeVisible();

  await fixtureCard.getByRole("button", { name: "Start preparing" }).click();
  await expect(fixtureCard.getByText("Preparing")).toBeVisible();
  await expect(fixtureCard.getByRole("button", { name: "Done" })).toBeVisible();

  await fixtureCard.getByRole("button", { name: "Done" }).click();
  await expect(fixtureCard).toBeHidden();

  await page.evaluate(() => {
    window.__kitchenInjectEvent?.({
      type: "order.paid",
      order: {
        id: "order-sse-202",
        orderNumber: "A-202",
        status: "paid",
        subtotalCents: 650,
        totalAmountCents: 650,
        createdAt: "2026-08-08T12:02:00.000Z",
        paidAt: "2026-08-08T12:02:01.000Z",
        items: [
          {
            id: "item-sse-202",
            productId: "product-classic-cheese-toastie",
            productName: "Classic cheese toastie",
            quantity: 1,
            unitPriceCents: 650,
            variants: [],
            addons: [],
          },
        ],
      },
    });
  });

  const liveCard = page.getByTestId("kitchen-order-A-202");
  await expect(liveCard).toBeVisible();
  await expect(liveCard.getByText("Classic cheese toastie")).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
});
