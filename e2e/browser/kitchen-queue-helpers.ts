import type { Page } from "@playwright/test";

export const enterStaffPassword = async (page: Page) => {
  await page.getByLabel("Shared staff password").fill("dev-kiosk-claim-2026");
  await page.getByRole("button", { name: "Continue" }).click();
};
