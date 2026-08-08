import { expect, test } from "@playwright/test";
import { claimFixtureKiosk } from "./kiosk-claim-helpers";

test("renders scaffold heading", async ({ page }) => {
  await claimFixtureKiosk(page);
  await expect(page.getByRole("heading", { name: "Self-service web checkout" })).toBeVisible();
});
