import { expect, test, type Page } from "@playwright/test";
import { claimFixtureKiosk } from "./kiosk-claim-helpers";

const addClassicToastie = async (page: Page) => {
  await page.getByRole("button", { name: /Classic cheese toastie.*\$6\.50/ }).click();
  await expect(page.getByRole("contentinfo").getByText("$6.50")).toBeVisible();
};
test.setTimeout(120_000);

test("warns about an idle cart and keeps it after interaction", async ({ page }) => {
  await claimFixtureKiosk(page);
  await addClassicToastie(page);

  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 18_000 });
  await expect(page.getByRole("heading", { name: "Are you still ordering?" })).toBeVisible();
  await expect(page.getByText(/Cart clears in \d+s/)).toBeVisible();
  await page.getByRole("button", { name: "Keep ordering" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("contentinfo").getByText("$6.50")).toBeVisible();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 18_000 });
});

test("captures cart abandonment and returns to an empty menu", async ({ page }) => {
  const captured: string[] = [];
  const capturedUrls: string[] = [];
  await page.route("http://posthog.test/**", async (route) => {
    capturedUrls.push(route.request().url());
    captured.push(route.request().postData() ?? "");
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await claimFixtureKiosk(page);
  await addClassicToastie(page);

  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 18_000 });
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 20_000 });
  await expect(page.getByRole("contentinfo").getByText("0 items · $0.00")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay" })).toBeDisabled();
  expect(capturedUrls.join("\n")).toContain("/e/");
  const parseCapture = (body: string) => {
    try {
      type CaptureEvent = { event?: string; properties?: Record<string, unknown> };
      const parsed = body.startsWith("{")
        ? (JSON.parse(body) as CaptureEvent & { batch?: CaptureEvent[] })
        : (() => {
            const encoded = new URLSearchParams(body).get("data");
            return encoded
              ? (JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as CaptureEvent)
              : null;
          })();
      return parsed?.batch?.[0] ?? parsed;
    } catch {
      return null;
    }
  };
  await expect
    .poll(() => captured.some((body) => parseCapture(body)?.event === "cart_abandoned"), {
      timeout: 5_000,
    })
    .toBe(true);
  const eventBody = captured.map(parseCapture).find((event) => event?.event === "cart_abandoned");
  expect(eventBody?.properties?.kiosk_id).toBe("front-counter");
  expect(eventBody?.properties?.cart_lines).toBeTruthy();
  expect(eventBody?.properties?.subtotal_cents).toBe(650);
});

test("expires a payment-pending attempt before returning to the menu", async ({ page }) => {
  await claimFixtureKiosk(page);
  await addClassicToastie(page);
  await page.getByRole("button", { name: /Classic cheese toastie.*\$6\.50/ }).click();
  await page.getByRole("button", { name: "Pay" }).click();
  await expect(page.getByRole("heading", { name: "Taking payment" })).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByRole("heading", { name: "Menu" })).toBeVisible({ timeout: 25_000 });
  await expect(page.getByRole("contentinfo").getByText("0 items · $0.00")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay" })).toBeDisabled();
});
