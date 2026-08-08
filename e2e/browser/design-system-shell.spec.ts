import { expect, test } from "@playwright/test";
import { claimFixtureKiosk } from "./kiosk-claim-helpers";

test("renders the fixed kiosk shell with its design tokens", async ({ page }) => {
  await claimFixtureKiosk(page);

  await expect(page.getByTestId("kiosk-header")).toBeVisible();
  await expect(page.getByRole("banner")).toContainText("Warm & Melted");
  await expect(page.getByTestId("kiosk-bottom-bar")).toBeVisible();
  await expect(page.getByRole("button", { name: "View cart" })).toBeVisible();

  const shell = page.getByTestId("kiosk-shell");
  await expect(shell).toHaveCSS("background-color", "rgb(247, 245, 240)");

  const content = page.getByTestId("kiosk-content");
  await expect(content).toHaveCSS("overflow-y", "auto");
  await expect(content).toHaveCSS("flex-grow", "1");
  await expect(content).toHaveCSS("min-height", "0px");

  await expect(page.getByTestId("kiosk-primary-action")).toHaveCSS(
    "background-color",
    "rgb(47, 110, 79)",
  );
  await expect(page.getByTestId("kiosk-price")).toHaveText("$12.50");

  const sansFamily = await page
    .getByTestId("kiosk-ui-copy")
    .evaluate((element) => getComputedStyle(element).fontFamily);
  const priceFamily = await page
    .getByTestId("kiosk-price")
    .evaluate((element) => getComputedStyle(element).fontFamily);
  expect(sansFamily).toContain("Inter");
  expect(priceFamily).toContain("Inter");

  const contentBox = await content.boundingBox();
  const bottomBarBox = await page.getByTestId("kiosk-bottom-bar").boundingBox();
  const viewport = page.viewportSize();
  expect(contentBox).not.toBeNull();
  expect(bottomBarBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(bottomBarBox!.y).toBeGreaterThan(contentBox!.y);
  expect(bottomBarBox!.y + bottomBarBox!.height).toBeGreaterThanOrEqual(viewport!.height - 1);
});
