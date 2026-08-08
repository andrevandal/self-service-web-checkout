import type { Page } from "@playwright/test";

export const enterSetupPassword = async (page: Page) => {
  await page.getByLabel("Shared setup password").fill("warm-melted");
  await page.getByRole("button", { name: "Continue" }).click();
};

export const claimFixtureKiosk = async (page: Page) => {
  await page.goto("/");
  await enterSetupPassword(page);
  await page.getByRole("button", { name: /Claim Front counter/ }).click();
};
