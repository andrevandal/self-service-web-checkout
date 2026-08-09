import { expect, test } from "@playwright/test";
import { claimFixtureKiosk } from "./kiosk-claim-helpers";

test("pays for an order, confirms pickup, and resets the menu", async ({ page }) => {
  await claimFixtureKiosk(page);

  await page.getByRole("button", { name: /Espresso.*\$3\.50/ }).click();
  await expect(page.getByRole("contentinfo").getByText("$3.50")).toBeVisible();

  await page.getByRole("button", { name: "Pay" }).click();
  await expect(page.getByRole("heading", { name: "Taking payment" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Follow the instructions on the terminal")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Payment complete" })).toBeVisible();
  await expect(page.getByText(/^[A-Z]-\d+$/)).toBeVisible();
  await expect(page.getByText("Your receipt is printing")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Menu" })).toBeVisible({ timeout: 4_000 });
  await expect(page.getByRole("contentinfo").getByText("0 items · $0.00")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay" })).toBeDisabled();
});
