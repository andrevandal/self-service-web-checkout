import { expect, test, type Page } from "@playwright/test";
import { claimFixtureKiosk } from "./kiosk-claim-helpers";

const addClassicToastie = async (page: Page) => {
  await page.getByRole("button", { name: /Classic cheese toastie.*\$6\.50/ }).click();
  await expect(page.getByRole("contentinfo").getByText("$6.50")).toBeVisible();
};

test("warns about an idle cart and keeps it after interaction", async ({ page }) => {
  await claimFixtureKiosk(page);
  await addClassicToastie(page);

  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 2_000 });
  await expect(page.getByRole("heading", { name: "Are you still ordering?" })).toBeVisible();
  await expect(page.getByText(/Cart clears in \d+s/)).toBeVisible();
  await page.getByRole("button", { name: "Keep ordering" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("contentinfo").getByText("$6.50")).toBeVisible();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 2_000 });
});

test("captures cart abandonment and returns to an empty menu", async ({ page }) => {
  const captured: string[] = [];
  await page.route("http://posthog.test/**", async (route) => {
    captured.push(route.request().postData() ?? "");
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await claimFixtureKiosk(page);
  await addClassicToastie(page);

  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 2_000 });
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 4_000 });
  await expect(page.getByRole("contentinfo").getByText("0 items · $0.00")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay" })).toBeDisabled();
  await expect.poll(() => captured.some((body) => body.includes("cart_abandoned"))).toBe(true);
  const eventBody = captured.find((body) => body.includes("cart_abandoned")) ?? "";
  expect(eventBody).toContain("front-counter");
  expect(eventBody).toContain("product-classic-cheese-toastie");
  expect(eventBody).toContain("subtotal_cents");
});

test("expires a payment-pending attempt before returning to the menu", async ({ page }) => {
  await claimFixtureKiosk(page);
  await addClassicToastie(page);
  await page.getByRole("button", { name: "Pay" }).click();
  await expect(page.getByRole("heading", { name: "Taking payment" })).toBeVisible();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 2_000 });
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 4_000 });
  await expect(page.getByRole("heading", { name: "Menu" })).toBeVisible();
  await expect(page.getByRole("contentinfo").getByText("0 items · $0.00")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay" })).toBeDisabled();
});
