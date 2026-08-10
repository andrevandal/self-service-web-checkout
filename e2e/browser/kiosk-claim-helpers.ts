import { expect, type Page } from "@playwright/test";

export const enterSetupPassword = async (page: Page) => {
  const password = process.env.KIOSK_CLAIM_PASSWORD;
  if (!password) {
    throw new Error("KIOSK_CLAIM_PASSWORD is required for kiosk claim browser tests");
  }
  await page.getByLabel("Shared setup password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
};

export const claimFixtureKiosk = async (page: Page) => {
  await page.goto("/");
  await enterSetupPassword(page);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.getByRole("button", { name: /Claim Front counter/ }).click(),
  ]);
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
