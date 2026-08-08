# Design system and kiosk shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the starter visual theme with the approved kiosk tokens and ship a reusable fixed-height shell whose header and action bar stay visible while content scrolls.

**Architecture:** CSS custom properties in `src/styles.css` are the only token source of truth. Tailwind v4's `@theme inline` exposes those properties as semantic utilities, while `components.json` remains CSS-variable based and Lucide-backed. A `KioskShell` component owns the flex column and scroll boundaries; the index route supplies header/content/bottom-bar slots and serves as the browser-test fixture.

**Tech Stack:** TanStack Start, React 19, Tailwind CSS v4, shadcn/ui configuration, Lucide React, `@fontsource/inter`, `@fontsource/jetbrains-mono`, Playwright.

## Global Constraints

- Use the PRD's touch-first, high-contrast, calm visual language: warm paper `#f7f5f0`, charcoal ink, and forest green `#2f6e4f` as the single primary/selected accent.
- Use sentence case and no emoji or promotional copy; use JetBrains Mono for glanceable prices and numbers.
- Keep token primitives and semantic shadcn aliases in `src/styles.css`; do not add a JavaScript Tailwind config or duplicate token values in component classes.
- Convert reference pixel values to rem where CSS values are required; use the 4px spacing scale through 96px, approved radii, and soft ambient shadows.
- Every screen shell is `h-dvh min-h-dvh flex flex-col overflow-hidden`; only its middle region scrolls (`min-h-0 flex-1 overflow-y-auto`).
- Bundle Inter and JetBrains Mono through `@fontsource` packages; do not add runtime Google Fonts requests or hand-written font files.
- Use Lucide outline icons with a 2px stroke and large touch targets.
- Follow TDD: add and run the browser test before the shell exists, observe the expected failure, then implement and rerun it green.
- Do not add backend calls, client state, kitchen SSE, timers, analytics, or feature-specific flows in this spec.

## File map

- Create: `e2e/browser/design-system-shell.spec.ts` — browser contract for shell landmarks, scroll boundary, colors, and fonts.
- Create: `src/components/kiosk-shell.tsx` — slot-based semantic shell with stable test IDs and safe-area-aware action bar.
- Modify: `src/routes/index.tsx` — representative shell content and Lucide affordances; preserve the existing scaffold heading contract.
- Modify: `src/styles.css` — bundled font imports, palette/semantic/type/spacing/radius/shadow variables, Tailwind v4 theme mappings, global viewport defaults.
- Modify: `components.json` — make the existing CSS-variable and neutral/ink shadcn alignment explicit while keeping Lucide.
- Modify: `package.json` and `bun.lock` — add the two self-hosted font packages.
- Create: `docs/plans/2026-08-08-design-system-shell-plan.md` — this implementation plan.

### Task 1: Add the red browser contract

**Files:**
- Create: `e2e/browser/design-system-shell.spec.ts`

**Interfaces:**
- Consumes the public `/` route only.
- Produces the selectors and observable assertions that the shell implementation must satisfy: `data-testid="kiosk-shell"`, `data-testid="kiosk-header"`, `data-testid="kiosk-content"`, `data-testid="kiosk-bottom-bar"`, `data-testid="kiosk-price"`, and `data-testid="kiosk-primary-action"`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "@playwright/test";

test("renders the fixed kiosk shell with its design tokens", async ({ page }) => {
  await page.goto("/");

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

  const sansFamily = await page.getByTestId("kiosk-ui-copy").evaluate(
    (element) => getComputedStyle(element).fontFamily,
  );
  const monoFamily = await page.getByTestId("kiosk-price").evaluate(
    (element) => getComputedStyle(element).fontFamily,
  );
  expect(sansFamily).toContain("Inter");
  expect(monoFamily).toContain("JetBrains Mono");

  const contentBox = await content.boundingBox();
  const bottomBarBox = await page.getByTestId("kiosk-bottom-bar").boundingBox();
  const viewport = page.viewportSize();
  expect(contentBox).not.toBeNull();
  expect(bottomBarBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(bottomBarBox!.y).toBeGreaterThan(contentBox!.y);
  expect(bottomBarBox!.y + bottomBarBox!.height).toBeGreaterThanOrEqual(
    viewport!.height - 1,
  );
});
```

- [ ] **Step 2: Run the red check**

Run: `bun run test:e2e`

Expected: the build completes, then `design-system-shell.spec.ts` fails because the current scaffold has no kiosk header/bottom-bar test IDs and still uses the starter page. Do not change the test to make this failure pass.

- [ ] **Step 3: Commit the red contract**

```bash
git add e2e/browser/design-system-shell.spec.ts
git commit -m "test(design-system): define shell browser contract"
```

### Task 2: Install fonts and wire the token system

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `src/styles.css`
- Modify: `components.json`

**Interfaces:**
- Produces CSS variables and Tailwind utilities consumed by `KioskShell` and routes: `bg-background`, `text-foreground`, `bg-primary`, `text-primary-foreground`, `font-sans`, `font-mono`, `rounded-md`, `rounded-lg`, `shadow-sm`, and the spacing utilities generated from the approved scale.
- Produces bundled `Inter` and `JetBrains Mono` font faces available to the browser without a network request.

- [ ] **Step 1: Add self-hosted font packages**

Run:

```bash
bun add @fontsource/inter@^5 @fontsource/jetbrains-mono@^5
```

Expected: `package.json` gains both dependencies and `bun.lock` records their resolved packages. Keep the lockfile changes from this command; do not manually edit dependency versions.

- [ ] **Step 2: Replace starter CSS variables with the approved tokens**

In `src/styles.css`, keep the Tailwind and animation imports, then import these bundled font faces before the token declarations:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "@fontsource/inter/400.css";
@import "@fontsource/inter/500.css";
@import "@fontsource/inter/600.css";
@import "@fontsource/inter/700.css";
@import "@fontsource/inter/800.css";
@import "@fontsource/jetbrains-mono/400.css";
@import "@fontsource/jetbrains-mono/500.css";

@custom-variant dark (&:is(.dark *));

:root {
  --font-family-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-family-mono: "JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  --font-sans: var(--font-family-sans);
  --font-mono: var(--font-family-mono);

  --color-paper: #f7f5f0;
  --color-cream: #fbfaf7;
  --color-white: #ffffff;
  --color-ink-900: #1a1a1a;
  --color-ink-700: #3f3f3d;
  --color-ink-500: #6b6b66;
  --color-ink-300: #b0aea6;
  --color-ink-150: #dedcd3;
  --color-ink-100: #e9e7df;
  --color-forest-700: #1c4531;
  --color-forest-600: #2f6e4f;
  --color-forest-500: #3f8462;
  --color-forest-100: #e3ede7;
  --color-amber-600: #b3791f;
  --color-amber-500: #e0a530;
  --color-amber-100: #faeed2;
  --color-red-600: #9c352c;
  --color-red-500: #c1443a;
  --color-red-100: #f6e0de;

  --surface-page: var(--color-paper);
  --surface-card: var(--color-white);
  --surface-sunken: var(--color-cream);
  --surface-inverse: var(--color-ink-900);
  --surface-accent: var(--color-forest-600);
  --surface-accent-subtle: var(--color-forest-100);
  --text-primary: var(--color-ink-900);
  --text-secondary: var(--color-ink-500);
  --text-tertiary: var(--color-ink-300);
  --text-inverse: var(--color-paper);
  --text-on-accent: var(--color-paper);
  --text-accent: var(--color-forest-600);
  --border-subtle: var(--color-ink-100);
  --border-strong: var(--color-ink-300);
  --border-accent: var(--color-forest-600);
  --accent: var(--color-forest-600);
  --accent-hover: var(--color-forest-700);
  --accent-active: var(--color-forest-700);
  --accent-subtle: var(--color-forest-100);
  --danger: var(--color-red-500);
  --danger-subtle: var(--color-red-100);
  --warning: var(--color-amber-500);
  --warning-subtle: var(--color-amber-100);
  --success: var(--color-forest-600);

  --text-display-xl-value: 3.5rem;
  --text-display-l-value: 2.5rem;
  --text-display-m-value: 2rem;
  --text-heading-l-value: 1.625rem;
  --text-heading-m-value: 1.375rem;
  --text-heading-s-value: 1.125rem;
  --text-body-l-value: 1.0625rem;
  --text-body-m-value: 0.9375rem;
  --text-body-s-value: 0.8125rem;
  --text-caption-value: 0.75rem;
  --text-display-xl: var(--text-display-xl-value);
  --text-display-l: var(--text-display-l-value);
  --text-display-m: var(--text-display-m-value);
  --text-heading-l: var(--text-heading-l-value);
  --text-heading-m: var(--text-heading-m-value);
  --text-heading-s: var(--text-heading-s-value);
  --text-body-l: var(--text-body-l-value);
  --text-body-m: var(--text-body-m-value);
  --text-body-s: var(--text-body-s-value);
  --text-caption: var(--text-caption-value);
  --lh-tight: 1.1;
  --lh-snug: 1.25;
  --lh-normal: 1.45;
  --lh-relaxed: 1.6;
  --weight-regular: 400;
  --weight-medium: 500;
  --weight-semibold: 600;
  --weight-bold: 700;
  --weight-extrabold: 800;

  --shadow-sm-value: 0 0.0625rem 0.125rem rgb(26 26 26 / 6%);
  --shadow-md-value: 0 0.25rem 1rem rgb(26 26 26 / 8%);
  --shadow-lg-value: 0 0.75rem 2rem rgb(26 26 26 / 12%);
  --shadow-focus-value: 0 0 0 0.1875rem rgb(47 110 79 / 28%);
  --shadow-sm: var(--shadow-sm-value);
  --shadow-md: var(--shadow-md-value);
  --shadow-lg: var(--shadow-lg-value);
  --shadow-focus: var(--shadow-focus-value);
  --radius-sm-value: 0.5rem;
  --radius-md-value: 0.75rem;
  --radius-lg-value: 1.25rem;
  --radius-xl-value: 1.75rem;
  --radius-sm: var(--radius-sm-value);
  --radius-md: var(--radius-md-value);
  --radius-lg: var(--radius-lg-value);
  --radius-xl: var(--radius-xl-value);
  --radius-pill: 999px;
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.25rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-10: 2.5rem;
  --space-12: 3rem;
  --space-16: 4rem;
  --space-20: 5rem;
  --space-24: 6rem;

  --background: var(--surface-page);
  --foreground: var(--text-primary);
  --card: var(--surface-card);
  --card-foreground: var(--text-primary);
  --popover: var(--surface-card);
  --popover-foreground: var(--text-primary);
  --primary: var(--surface-accent);
  --primary-foreground: var(--text-on-accent);
  --secondary: var(--surface-sunken);
  --secondary-foreground: var(--text-primary);
  --muted: var(--surface-sunken);
  --muted-foreground: var(--text-secondary);
  --accent-foreground: var(--text-primary);
  --destructive: var(--danger);
  --destructive-foreground: var(--text-on-accent);
  --border: var(--border-subtle);
  --input: var(--border-strong);
  --ring: var(--accent);
}
```

Keep the existing box-sizing reset, then map semantic aliases in `@theme inline`. Do not map a theme variable to itself: use the primitive names above when a Tailwind theme key has the same name as a CSS variable. The mapping must include these exact utilities:

```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --font-sans: var(--font-family-sans);
  --font-mono: var(--font-family-mono);
  --radius-sm: var(--radius-sm-value);
  --radius-md: var(--radius-md-value);
  --radius-lg: var(--radius-lg-value);
  --radius-xl: var(--radius-xl-value);
  --shadow-sm: var(--shadow-sm-value);
  --shadow-md: var(--shadow-md-value);
  --shadow-lg: var(--shadow-lg-value);
  --text-display-xl: var(--text-display-xl-value);
  --text-display-l: var(--text-display-l-value);
  --text-display-m: var(--text-display-m-value);
  --text-heading-l: var(--text-heading-l-value);
  --text-heading-m: var(--text-heading-m-value);
  --text-heading-s: var(--text-heading-s-value);
  --text-body-l: var(--text-body-l-value);
  --text-body-m: var(--text-body-m-value);
  --text-body-s: var(--text-body-s-value);
  --text-caption: var(--text-caption-value);
}
```

Add this spacing scale to the same `@theme inline` block (or a second adjacent block) so both the primitive names and standard Tailwind spacing utilities are available without hardcoded component values:

```css
@theme inline {
  --spacing-1: var(--space-1);
  --spacing-2: var(--space-2);
  --spacing-3: var(--space-3);
  --spacing-4: var(--space-4);
  --spacing-5: var(--space-5);
  --spacing-6: var(--space-6);
  --spacing-8: var(--space-8);
  --spacing-10: var(--space-10);
  --spacing-12: var(--space-12);
  --spacing-16: var(--space-16);
  --spacing-20: var(--space-20);
  --spacing-24: var(--space-24);
}
```

Use explicit `--spacing-*` mappings for the 4px scale (`--spacing-1` through `--spacing-24`) and explicit typography mappings (`--text-display-xl` through `--text-caption`) so direct Tailwind utilities remain available. Apply `font-family: var(--font-family-sans)` to `body`, `background-color: var(--background)`, `color: var(--foreground)`, and `min-height: 100%` to `html`, `body`, and `#app`. Remove the starter `.dark` block so no unsupported theme switch remains.

- [ ] **Step 3: Align shadcn metadata**

Keep `tailwind.config` empty, `css` at `src/styles.css`, `cssVariables: true`, empty prefix, and `iconLibrary: "lucide"`. Change only `baseColor` from `zinc` to `neutral`, matching the ink/paper neutral system; preserve all aliases under `#/components`, `#/components/ui`, `#/lib`, and `#/hooks`.

### Task 3: Implement the shell and representative route

**Files:**
- Create: `src/components/kiosk-shell.tsx`
- Modify: `src/routes/index.tsx`

**Interfaces:**
- `KioskShellProps` is `{ header: React.ReactNode; children: React.ReactNode; bottomBar: React.ReactNode }`.
- `KioskShell` returns the semantic shell with `data-testid` hooks required by Task 1. It does not know about carts, server functions, or route-specific copy.

- [ ] **Step 1: Create the slot-based shell**

Create `src/components/kiosk-shell.tsx` with this structure:

```tsx
import type { ReactNode } from "react";

type KioskShellProps = {
  header: ReactNode;
  children: ReactNode;
  bottomBar: ReactNode;
};

export function KioskShell({ header, children, bottomBar }: KioskShellProps) {
  return (
    <div
      className="flex h-dvh min-h-dvh flex-col overflow-hidden bg-background text-foreground"
      data-testid="kiosk-shell"
    >
      <header
        className="flex-none border-b border-border bg-background"
        data-testid="kiosk-header"
      >
        {header}
      </header>
      <main
        className="min-h-0 flex-1 overflow-y-auto"
        data-testid="kiosk-content"
      >
        {children}
      </main>
      <footer
        className="flex-none border-t border-border bg-card px-5 py-4 shadow-md [padding-bottom:calc(1rem+env(safe-area-inset-bottom))]"
        data-testid="kiosk-bottom-bar"
      >
        {bottomBar}
      </footer>
    </div>
  );
}
```

- [ ] **Step 2: Compose the index route around the shell**

Replace the starter `Home` output with this route shape. Keep the existing route export so TanStack Router's generated tree stays valid:

```tsx
import { ArrowRight, Store } from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";
import { KioskShell } from "#/components/kiosk-shell";

const Home = () => {
  return (
    <KioskShell
      header={
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <Store aria-hidden className="size-6" strokeWidth={2} />
            <span className="text-heading-s font-semibold">Warm & Melted</span>
          </div>
          <span className="text-body-s text-muted-foreground">Kiosk 01</span>
        </div>
      }
      bottomBar={
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
          <div>
            <p className="text-body-s text-muted-foreground">Current order</p>
            <p className="font-mono text-heading-m font-medium" data-testid="kiosk-price">
              $12.50
            </p>
          </div>
          <button
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-pill bg-primary px-6 py-3 font-semibold text-primary-foreground transition-transform duration-150 active:scale-[0.97]"
            data-testid="kiosk-primary-action"
            type="button"
          >
            View cart
            <ArrowRight aria-hidden size={20} strokeWidth={2} />
          </button>
        </div>
      }
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-8">
        <div className="max-w-2xl">
          <p className="text-body-s font-medium text-primary" data-testid="kiosk-ui-copy">
            Ready when you are
          </p>
          <h1 className="mt-3 text-display-m font-extrabold leading-tight">
            Self-service web checkout
          </h1>
          <p className="mt-4 max-w-xl text-body-l text-muted-foreground">
            Browse the menu and build your order at your own pace.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Menu preview">
          {Array.from({ length: 9 }, (_, index) => (
            <article className="rounded-md bg-card p-5 shadow-sm" key={index}>
              <div className="mb-5 aspect-[4/3] rounded-md bg-secondary" />
              <h2 className="text-heading-s font-semibold">House special {index + 1}</h2>
              <p className="mt-2 text-body-s text-muted-foreground">Made fresh for you.</p>
            </article>
          ))}
        </div>
      </div>
    </KioskShell>
  );
};

export const Route = createFileRoute("/")({ component: Home });
```

- [ ] **Step 3: Run the focused browser contract**

Run: `bun run test:e2e -- e2e/browser/design-system-shell.spec.ts`

Expected: the new shell test and the existing scaffold-heading test both pass. The generated build must include the bundled font CSS and no network font request is required.

- [ ] **Step 4: Commit the implementation**

```bash
git add package.json bun.lock src/styles.css components.json src/components/kiosk-shell.tsx src/routes/index.tsx
git commit -m "feat(design-system): add kiosk shell and tokens"
```

### Task 4: Run the complete repository checks

**Files:**
- Modify only files surfaced by the checks; preserve the design spec, plan, test contract, and shell boundaries.

**Interfaces:**
- Produces a repository state with all configured static, unit, build, and browser checks green.

- [ ] **Step 1: Run the requested full checks exactly once at the end**

Run:

```bash
bun run lint && bun run format && bun run typecheck && bun run test && bun run test:e2e
```

Expected: each command exits 0; `test:e2e` runs the built app and reports both `home.spec.ts` and `design-system-shell.spec.ts` passing.

- [ ] **Step 2: Fix only surfaced issues and rerun the narrowest relevant command**

If a check fails, correct the source of that failure in the files listed above, then rerun the failed command (and its dependent later commands if the change affects them). Do not add unrelated refactors, disable checks, weaken assertions, bypass hooks, or commit generated build output.

- [ ] **Step 3: Confirm committed artifacts**

Run: `git status --short`

Expected: clean working tree after any required fix commit. The branch contains the committed design spec, committed implementation plan, the red-first browser contract commit, and the green implementation commit.
