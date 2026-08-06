import { expect, test } from "@playwright/test";

test("renders scaffold heading", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Self-service web checkout" })).toBeVisible();
});
