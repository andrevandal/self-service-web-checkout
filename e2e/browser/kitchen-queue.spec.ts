import { expect, test } from "@playwright/test";
import { claimFixtureKiosk } from "./kiosk-claim-helpers";
import { enterStaffPassword } from "./kitchen-queue-helpers";

test("staff can receive a paid SSE order and advance it through the real queue", async ({
  page,
}) => {
  const kitchenPage = await page.context().newPage();
  await kitchenPage.goto("/kitchen");
  await expect(kitchenPage.getByRole("heading", { name: "Kitchen queue" })).toBeVisible();
  await enterStaffPassword(kitchenPage);
  await expect(kitchenPage.getByTestId("kitchen-live-status")).toHaveText("Live updates on");
  await page.waitForTimeout(1_000);

  await claimFixtureKiosk(page);
  await page.getByRole("button", { name: /Espresso.*\$3\.50/ }).click();
  await page.getByRole("button", { name: "Pay" }).click();
  await expect(page.getByRole("heading", { name: "Payment complete" })).toBeVisible();

  const orderNumber = await page.getByText(/^[A-Z]-\d+$/).textContent();
  expect(orderNumber).toMatch(/^[A-Z]-\d+$/);
  const liveCard = kitchenPage.getByTestId(`kitchen-order-${orderNumber}`);
  await expect(liveCard).toBeVisible({ timeout: 30_000 });
  await expect(liveCard.getByText("Espresso")).toBeVisible();
  await expect(liveCard.getByText("Paid")).toBeVisible();

  await liveCard.getByRole("button", { name: "Start preparing" }).click();
  await expect(liveCard.getByText("Preparing")).toBeVisible();
  await liveCard.getByRole("button", { name: "Done" }).click();
  await expect(liveCard).toBeHidden();

  await kitchenPage.close();
});
