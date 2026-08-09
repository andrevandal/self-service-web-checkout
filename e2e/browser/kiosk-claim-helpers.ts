import { expect, type Page } from "@playwright/test";

export const enterSetupPassword = async (page: Page) => {
  await page.getByLabel("Shared setup password").fill("dev-kiosk-claim-2026");
  await page.getByRole("button", { name: "Continue" }).click();
};

export const claimFixtureKiosk = async (page: Page) => {
  await page.goto("/");
  await enterSetupPassword(page);
  await page.getByRole("button", { name: /Claim Front counter/ }).click();
  await page.getByRole("button", { name: /Espresso.*\$3\.50/ }).waitFor({ state: "visible" });
  await page.waitForTimeout(1_000);
};

export const payWithMethod = async (
  page: Page,
  method: "Credit card" | "Debit card" = "Credit card",
) => {
  await page.getByRole("button", { name: "Pay" }).click();
  await expect(page.getByRole("heading", { name: "How would you like to pay?" })).toBeVisible();
  await page.getByRole("button", { name: method }).click();
};
