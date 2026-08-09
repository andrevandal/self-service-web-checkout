import type { Page } from "@playwright/test";

export const enterSetupPassword = async (page: Page) => {
  await page.getByLabel("Shared setup password").fill("dev-kiosk-claim-2026");
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
