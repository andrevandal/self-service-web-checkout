import type { Page } from "@playwright/test";

export const enterStaffPassword = async (page: Page) => {
  await page.getByLabel("Shared staff password").fill("warm-melted");
  await page.getByRole("button", { name: "Continue" }).click();
};
