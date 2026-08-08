# Kiosk claim/setup screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a root-route kiosk session gate that lets staff claim an existing kiosk or create a new one, then returns the tablet to kiosk mode across reloads.

**Architecture:** Keep `/` as the only route. The route loader/query reads a typed `getKioskSession()` adapter and renders `KioskClaimScreen` when it returns `null`, otherwise the existing `KioskShell` placeholder. `KioskClaimScreen` uses TanStack Query for `listKiosks()` and `claimKiosk({ data })`; a local `createServerFn` adapter provides deterministic in-memory behavior and cookie persistence until BackendPlatform-2 is merged, after which only the adapter handlers change.

**Tech Stack:** TanStack Start `createServerFn`, TanStack Router, TanStack Query, React, Lucide, Playwright, existing Tailwind v4 design tokens.

## Global Constraints

- Use the existing `KioskShell`; do not add a `/setup` route.
- Use Inter as the sole typeface, including kiosk prefixes and all numbers; do not add a mono face.
- Every cross-layer read/write is a named `createServerFn` called through TanStack Query; do not add raw `/api/*` calls.
- Match BackendPlatform-2's approved contract: `Kiosk = { id: string; name: string; prefix: string }`; `listKiosks()` is a GET server function with no input; `claimKiosk({ data: { password, kioskId? or name+optional prefix } })` is a POST server function returning `Kiosk` and setting `kiosk_session`.
- Map claim errors `invalid_password`, `configuration`, `invalid_input`, `kiosk_not_found`, and `prefix_taken` to concise inline copy without exposing the password.
- Keep controls touch-first (minimum 48px), keyboard-submittable, visibly focusable, and use `aria-live` for loading/error feedback.

---

### Task 1: Add the red browser contract test

**Files:**
- Create: `e2e/browser/kiosk-claim-helpers.ts`
- Create: `e2e/browser/kiosk-claim.spec.ts`
- Modify: `e2e/browser/design-system-shell.spec.ts`
- Modify: `e2e/browser/home.spec.ts`

**Interfaces:**
- Consumes: The root route's visible setup flow and the deterministic fixture password `warm-melted` used by the local adapter.
- Produces: A browser-level contract for setup, existing claim, new kiosk creation, and cookie-backed kiosk mode; existing shell tests continue to reach kiosk mode by claiming a fixture kiosk first.

- [ ] **Step 1: Write the failing claim flow test before implementation.**

```ts
import { expect, test } from "@playwright/test";
import { enterSetupPassword } from "./kiosk-claim-helpers";

test("claims an existing kiosk, creates a kiosk, and persists kiosk mode", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Set up this kiosk" })).toBeVisible();

  await enterSetupPassword(page);
  await expect(page.getByRole("heading", { name: "Choose a kiosk" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Claim Front counter/ })).toBeVisible();

  await page.getByRole("button", { name: /Claim Front counter/ }).click();
  await expect(page.getByRole("heading", { name: "Self-service web checkout" })).toBeVisible();
  await expect(page.getByText("Front counter")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Self-service web checkout" })).toBeVisible();
  await expect(page.getByText("Front counter")).toBeVisible();

  await page.context().clearCookies();
  await page.reload();
  await enterSetupPassword(page);
  await page.getByRole("textbox", { name: "Kiosk name" }).fill("Patio kiosk");
  await page.getByRole("textbox", { name: "Order prefix" }).fill("P");
  await page.getByRole("button", { name: "Create kiosk" }).click();
  await expect(page.getByRole("heading", { name: "Self-service web checkout" })).toBeVisible();
  await expect(page.getByText("Patio kiosk")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Self-service web checkout" })).toBeVisible();
  await expect(page.getByText("Patio kiosk")).toBeVisible();

  await page.context().clearCookies();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Set up this kiosk" })).toBeVisible();
});

```

`kiosk-claim-helpers.ts` exports the exact reusable setup helper:

```ts
import type { Page } from "@playwright/test";

export const enterSetupPassword = async (page: Page) => {
  await page.getByLabel("Shared setup password").fill("warm-melted");
  await page.getByRole("button", { name: "Continue" }).click();
};

export const claimFixtureKiosk = async (page: Page) => {
  await page.goto("/");
  await enterSetupPassword(page);
  await page.getByRole("button", { name: /Claim Front counter/ }).click();
};
```


Update the existing shell and home specs to call the same password/claim helper before assertions so their current kiosk-mode assertions remain meaningful under the new root gate. Keep assertions about the shell, paper background, green action, and Inter prices unchanged.

- [ ] **Step 2: Run the new browser spec and confirm it is red.**

Run: `bun run db:migrate && bun run build && bunx playwright test e2e/browser/kiosk-claim.spec.ts`
Expected: FAIL because the setup heading and claim controls do not exist yet.

- [ ] **Step 3: Commit only the red test changes.**

```bash
git add e2e/browser/kiosk-claim-helpers.ts e2e/browser/kiosk-claim.spec.ts e2e/browser/design-system-shell.spec.ts e2e/browser/home.spec.ts
git commit -m "test(kiosk-claim): define setup browser flow"
```

### Task 2: Implement the typed local session adapter

**Files:**
- Create: `src/lib/kiosk-session.ts`
- Create: `src/lib/kiosk-session.test.ts`

**Interfaces:**
- Consumes: `createServerFn` and `@tanstack/react-start/server` request/response header helpers.
- Produces: `Kiosk`, `KioskClaimInput`, `KioskSession`, `KioskClaimError`, `getKioskSession()`, `listKiosks()`, and `claimKiosk({ data })` exports for the route.

- [ ] **Step 1: Add pure adapter tests for prefix and claim input boundaries.**

```ts
import { describe, expect, test } from "bun:test";
import { normalizePrefix } from "./kiosk-session";

describe("normalizePrefix", () => {
  test("trims and uppercases a one-to-four character prefix", () => {
    expect(normalizePrefix(" ab ")).toBe("AB");
  });

  test("rejects empty and non-letter prefixes", () => {
    expect(normalizePrefix(" ")).toBeNull();
    expect(normalizePrefix("A1")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the focused unit test and confirm it is red.**

Run: `bun test src/lib/kiosk-session.test.ts`
Expected: FAIL because `normalizePrefix` is not defined.

- [ ] **Step 3: Implement the local server functions.**

Use this interface and behavior:

```ts
export type Kiosk = { id: string; name: string; prefix: string };
export type KioskSession = Kiosk | null;
export type KioskClaimInput =
  | { password: string; kioskId: string }
  | { password: string; name: string; prefix?: string };
export type KioskClaimErrorCode =
  | "invalid_password"
  | "configuration"
  | "invalid_input"
  | "kiosk_not_found"
  | "prefix_taken";

export const getKioskSession = createServerFn({ method: "GET" }).handler(...);
export const listKiosks = createServerFn({ method: "GET" }).handler(...);
export const claimKiosk = createServerFn({ method: "POST" })
  .validator((input: KioskClaimInput) => input)
  .handler(...);
```

Seed the local adapter with deterministic `Front counter` (`A`) and `Drive through` (`D`) fixtures and the `warm-melted` setup password. Keep the kiosk store module-local. `claimKiosk` validates the discriminated input, rejects duplicate prefixes, claims an existing kiosk by id or creates a named kiosk with the requested/next available prefix, sets `kiosk_session=<opaque token>; HttpOnly; SameSite=Lax; Path=/`, and returns the `Kiosk`. `getKioskSession` reads the request cookie and resolves the token to the claimed kiosk. Throw an error carrying `code` from `KioskClaimErrorCode`; the UI maps that code to copy. `normalizePrefix` returns an uppercase 1–4 letter prefix or `null`.

- [ ] **Step 4: Run the focused unit test and verify it passes.**

Run: `bun test src/lib/kiosk-session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the adapter.**

```bash
git add src/lib/kiosk-session.ts src/lib/kiosk-session.test.ts
git commit -m "feat(kiosk-claim): add session adapter"
```

### Task 3: Build the query-backed setup screen and root gate

**Files:**
- Create: `src/components/kiosk-claim-screen.tsx`
- Modify: `src/routes/index.tsx`

**Interfaces:**
- Consumes: `Kiosk`, `KioskClaimInput`, `getKioskSession`, `listKiosks`, and `claimKiosk` from `src/lib/kiosk-session.ts`; `KioskShell` from spec 1.
- Produces: Root `/` rendering that starts with setup when anonymous, exposes existing-kiosk claim and create-new actions, and renders kiosk mode after a successful claim.

- [ ] **Step 1: Implement `KioskClaimScreen` with local form state and query/mutation state.**

Use `useQuery({ queryKey: ["kiosks"], queryFn: () => listKiosks(), enabled: setupReady })` after Continue sets `setupReady`; keep the password only in component state. Use `useMutation({ mutationFn: (data: KioskClaimInput) => claimKiosk({ data }) })` for both claim buttons. Render the following stable labels and test ids:

- `Set up this kiosk`, `Shared setup password`, `Continue`.
- `Choose a kiosk`, each card button named `Claim {name}, prefix {prefix}`.
- `Create a new kiosk`, `Kiosk name`, `Order prefix`, `Create kiosk`.
- `aria-live="polite"` status for list loading and errors; inline error text for claim failures.

Use `KioskShell` with Warm & Melted setup header, centered card content, and a bottom bar reading `Staff setup · This tablet is not claimed`. Use only existing token classes, 48px controls, `type="password"` for the password, and client-side required/prefix validation. On mutation success, invalidate `['kiosk-session']`, then call `window.location.reload()` so the HttpOnly cookie is observed by the root loader.

- [ ] **Step 2: Gate the root route through the session query.**

Add a root loader that obtains `getKioskSession()` and returns it as loader data. In the route component, call `useQuery({ queryKey: ["kiosk-session"], queryFn: () => getKioskSession(), initialData: session })` using that loader data so SSR starts with the correct branch without a setup flash. Render `KioskClaimScreen` when the session is `null`; otherwise preserve the existing kiosk-mode shell and use the session's name in the header instead of the hard-coded `Kiosk 01`. Keep the existing placeholder menu and bottom action until spec 3.

- [ ] **Step 3: Run the focused browser spec.**

Run: `bun run db:migrate && bun run build && bunx playwright test e2e/browser/kiosk-claim.spec.ts`
Expected: PASS, including existing claim, create-new, and anonymous reload returning to setup.

- [ ] **Step 4: Run focused static checks for changed source.**

Run: `bunx oxlint src/components/kiosk-claim-screen.tsx src/lib/kiosk-session.ts src/routes/index.tsx`
Expected: no diagnostics.

- [ ] **Step 5: Commit the screen and gate.**

```bash
git add src/components/kiosk-claim-screen.tsx src/routes/index.tsx
git commit -m "feat(kiosk-claim): add setup screen and root gate"
```

### Task 4: Full verification and contract handoff

**Files:**
- Modify: `src/lib/kiosk-session.ts` only if needed to align with the merged BackendPlatform-2 signature.
- Modify: `docs/specs/2026-08-08-kiosk-claim-screen-design.md` and this plan only if observed behavior changes.

**Interfaces:**
- Consumes: BackendPlatform-2's landed `listKiosks()`/`claimKiosk({ data })` behavior and cookie name.
- Produces: A green repository with no local adapter contract drift.

- [ ] **Step 1: Replace only the adapter handler internals with the real backend implementation if the sibling branch has landed.**

Preserve the exported UI types and function call shapes. Keep the cookie opaque and HttpOnly; do not add raw fetch calls or client cookie reads.

- [ ] **Step 2: Run all required checks.**

Run, in order:

```bash
bun run lint
bun run format
bun run typecheck
bun run test
bun run test:e2e
```

Expected: each command exits 0; the final e2e run includes the setup flow and the existing shell tests.

- [ ] **Step 3: Commit any verified contract/doc adjustment.**

```bash
git add src docs/specs/2026-08-08-kiosk-claim-screen-design.md docs/plans/2026-08-08-kiosk-claim-screen-plan.md
git commit -m "chore(kiosk-claim): verify setup contract"
```
