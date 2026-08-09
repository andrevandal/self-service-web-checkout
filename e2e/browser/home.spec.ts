import { expect, test } from "@playwright/test";
import { claimFixtureKiosk } from "./kiosk-claim-helpers";

test("renders the menu resting state", async ({ page }) => {
  await claimFixtureKiosk(page);
  await expect(page.getByRole("heading", { name: "Menu" })).toBeVisible();
});
