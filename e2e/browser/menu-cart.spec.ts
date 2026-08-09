import { expect, test } from "@playwright/test";
import { claimFixtureKiosk } from "./kiosk-claim-helpers";

test("browses, customizes, and removes menu items", async ({ page }) => {
  await claimFixtureKiosk(page);

  await expect(page.getByRole("heading", { name: "Menu" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Toasties" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search menu" })).toBeVisible();
  await expect(page.getByRole("contentinfo").getByText("$0.00")).toBeVisible();

  await page.getByRole("button", { name: /Classic cheese toastie.*\$6\.50/ }).click();
  await expect(page.getByRole("contentinfo").getByText("$6.50")).toBeVisible();

  await page.getByRole("button", { name: /Melted mushroom toastie.*\$8\.50/ }).click();
  const drawer = page.getByRole("dialog", { name: "Customize melted mushroom toastie" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("radio", { name: /Sourdough/ }).check();
  await drawer.getByRole("checkbox", { name: /Extra cheese/ }).check();
  await drawer.getByRole("button", { name: "Add to order" }).click();
  await expect(page.getByRole("contentinfo").getByText("$16.00")).toBeVisible();
  await expect(page.getByText("2 items")).toBeVisible();

  await page.getByRole("button", { name: "Show order details" }).click();
  await expect(page.getByRole("heading", { name: "Order details" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Cart details" })).toBeVisible();
  await page.getByRole("button", { name: "Remove Classic cheese toastie" }).click();
  await expect(page.getByRole("contentinfo").getByText("$9.50")).toBeVisible();
  await expect(page.getByText("1 item")).toBeVisible();

  await page.getByRole("button", { name: "Hide order details" }).click();
  await expect(page.getByRole("heading", { name: "Menu" })).toBeVisible();
});
