import type { Page } from "@playwright/test";

export const enterStaffPassword = async (page: Page) => {
  const password = process.env.KIOSK_CLAIM_PASSWORD;
  if (!password) {
    throw new Error("KIOSK_CLAIM_PASSWORD is required for kitchen queue browser tests");
  }
  await page.getByLabel("Shared staff password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
};
