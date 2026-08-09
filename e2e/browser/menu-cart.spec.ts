import { expect, test } from "@playwright/test";
import { claimFixtureKiosk } from "./kiosk-claim-helpers";

test("browses, customizes, and removes menu items", async ({ page }) => {
  await claimFixtureKiosk(page);

  await expect(page.getByRole("heading", { name: "Menu" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Coffee & Espresso" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search menu" })).toBeVisible();
  await expect(page.getByRole("contentinfo").getByText("$0.00")).toBeVisible();

  await page.getByRole("button", { name: /Espresso.*\$3\.50/ }).click();
  await expect(page.getByRole("contentinfo").getByText("$3.50")).toBeVisible();

  await page.getByRole("button", { name: /Latte.*\$5\.25/ }).click();
  const drawer = page.getByRole("dialog", { name: "Customize Latte" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("radio", { name: /Whole Milk/ }).check();
  await drawer.getByRole("checkbox", { name: /Extra Shot/ }).check();
  await drawer.getByRole("button", { name: "Add to order" }).click();
  await expect(page.getByRole("contentinfo").getByText("$9.75")).toBeVisible();
  await expect(page.getByText("2 items")).toBeVisible();

  await page.getByRole("button", { name: "Show order details" }).click();
  await expect(page.getByRole("heading", { name: "Order details" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Cart details" })).toBeVisible();
  await page.getByRole("button", { name: "Remove Espresso" }).click();
  await expect(page.getByRole("contentinfo").getByText("$6.25")).toBeVisible();
  await expect(page.getByText("1 item")).toBeVisible();

  await page.getByRole("button", { name: "Hide order details" }).click();
  await expect(page.getByRole("heading", { name: "Menu" })).toBeVisible();
});
