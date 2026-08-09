import { expect, test } from "@playwright/test";
import { enterSetupPassword } from "./kiosk-claim-helpers";

test("claims an existing kiosk, creates a kiosk, and persists kiosk mode", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Set up this kiosk" })).toBeVisible();

  await enterSetupPassword(page);
  await expect(page.getByRole("heading", { name: "Choose a kiosk" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Claim Front counter/ })).toBeVisible();

  await page.getByRole("button", { name: /Claim Front counter/ }).click();
  await expect(page.getByRole("heading", { name: "Menu" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Menu" })).toBeVisible();

  await page.context().clearCookies();
  await page.reload();
  await enterSetupPassword(page);
  await page.getByRole("textbox", { name: "Kiosk name" }).fill("Patio kiosk");
  await page.getByRole("textbox", { name: "Order prefix" }).fill("P");
  await page.getByRole("button", { name: "Create kiosk" }).click();
  await expect(page.getByRole("heading", { name: "Menu" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Menu" })).toBeVisible();

  await page.context().clearCookies();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Set up this kiosk" })).toBeVisible();
});

test("rejects an incorrect setup password before revealing the kiosk chooser", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Set up this kiosk" })).toBeVisible();

  await page.getByLabel("Shared setup password").fill("wrong-password");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("That setup password is not correct.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Choose a kiosk" })).toBeHidden();

  await enterSetupPassword(page);
  await expect(page.getByRole("heading", { name: "Choose a kiosk" })).toBeVisible();
});
