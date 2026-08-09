# Goal: Kiosk UI/UX polish + structured logging

- Hub: ../GOAL-HUB.md
- Slug/branch: kiosk-polish
- Status: doing
- Opened: 2026-08-09
- Origin: "polishing interaction" backlog from live user feedback on the
  built app, captured during the `integration` goal; branched from
  `integration`'s tip (999f761) rather than `main`, since the integration
  work is being treated as merged for planning purposes even though the
  real PR #5 merge hasn't happened yet.

## Context

Branched from `integration` (not `main`) at commit `999f761` so this goal
starts with the real backend-platform + kiosk-ui wiring, the payment
method feature, the CI parallelization work, and all e2e fixes already
in place. `integration`'s own `GOAL.md` (not tracked, worktree-local) has
the full history of how that work was done if deeper context is ever
needed.

Two independent bodies of work, tracked together here because they were
both queued at the same time — feel free to split into separate goals if
one grows large enough to want its own worktree.

### A. Polish backlog (UI/UX, not started)

User's original numbering, kept for traceability.

**Menu screen**
1. Remove the "Menu" title and subtitle entirely; keep just a centered
   search bar + category pills as the screen's header content.
2. Make the category pill row sticky while scrolling.
3. Remove the header's `border-b`; let the header blend into the page
   background instead of a hard rule.
4. While scrolling, keep the category pills visible (implies #2) and
   update the active/selected pill to track the category currently in
   view (scrollspy behavior) — the pill row becomes primarily a status
   indicator, not just a jump-to-section control.
5. Product card CTA should read as a real button, not inline text — a
   bottom-right circular icon button (e.g. a `+`) instead of the current
   "Add to order" / "Choose options" text link.
6. Square product images, 280x280, consistent across every breakpoint
   (currently `h-40 w-full` on the card, non-square).
7. Item list becomes a single row per category using shadcn/ui
   `Carousel` (same pattern as the category pills), with overflow
   handled the same way as the carousel-clipping fix already shipped in
   `integration` — watch for the same px-5 bleed issue (bleed the
   carousel full-width, pad the inner scroll track to match).

**Navigation architecture (bigger, sequence-sensitive)**
8. Move search and item-details from in-page state/drawers to real
   client-side navigation: `/search?q=`, `/details?id=`, and a
   `/pay?step=(choosing_method|creating_order|...)` route for checkout —
   using TanStack Router so the footer/bottom bar stays mounted and
   functional across navigations (shell layout route). Largest item
   here; do this before #12/#13 since it changes where loading states
   and page metadata attach.
9. Add a global `notFoundComponent` (root-level default) to stop
   TanStack Router's generic `<p>Not Found</p>` fallback warning.
10. In the "How would you like to pay?" screen, give Cancel a distinct,
    lower-emphasis style — not the same bordered-button variant as
    Debit card (e.g. a borderless/ghost/text-only treatment).
11. On payment complete: add a confetti effect and a visible countdown
    to the automatic redirect (currently a silent 2s `setTimeout` in
    `checkout-screen.tsx`).
12. More screens/pages in general as part of the web-navigation shift
    (depends on #8 landing first).

**Global/system polish**
13. Skeleton loading state for first load (menu query pending state is
    currently just a text line — replace with skeleton cards).
14. Custom scrollbar styling, CSS-only (no JS lib).
15. Disable text selection on user-facing kiosk pages (`user-select:
    none`), scoped to avoid breaking staff/kitchen screens if those
    should stay selectable.
16. Refactor the seed into relationship-aware, natural-key data: insert
    parents and use returned IDs rather than hard-coded UUIDs in seed
    records. Then adopt the supplied reference catalog in full: four
    six-item categories, its variant groups/options, and its add-on
    groups/items — including `Green Apple` Italian Soda and `Chamomile`
    Organic Tea. Preserve only seed-relevant fields (name, slug, price,
    description, availability, and option configuration); do not validate
    supplied photo URLs.
17. Favicon + per-route `<title>`/meta description. Low SEO priority
    (in-house tablet software) but should look intentional — short,
    on-brand titles/descriptions per route, plus a real favicon.

### B. Structured logging with consola (design agreed, not started)

18. Add `consola`-based logging across frontend and backend, following
    the real data/user flow, using **tagged and sub-tagged loggers** so
    log output stays navigable (consola's `withTag()` nests: calling it
    on an already-tagged instance produces `parent:child`, e.g.
    `payment:reconcile`).

    **Setup**
    - `bun add consola` (currently only a transitive dep via `nitro`,
      not safe to import directly without pinning it as a direct dep).
    - One isomorphic module, `src/lib/logger.ts` — consola auto-switches
      reporters (Fancy/TTY in dev, Basic in CI/non-interactive stdout,
      Browser in the client), so no server/client split is needed here
      (unlike `env.server.ts`, there's no secret to protect). Export a
      base `logger` from `createConsola`; each module does
      `const log = logger.withTag("payment")` at the top, and functions
      that want a sub-scope do `log.withTag("reconcile")` locally.
    - Level controlled by env, matching the existing `env.ts` pattern:
      `LOG_LEVEL` (server, default `info`) and `VITE_LOG_LEVEL` (client,
      default `info`), mapped through consola's `LogLevels` export.

    **Level policy** (business meaning -> consola level)
    - `success` — a user/business action completed: kiosk claimed,
      order paid, order marked done, item added to cart.
    - `info` — lifecycle milestone, "this happened": order created,
      payment attempt started, SSE client connected, checkout phase
      change.
    - `warn` — recoverable/expected-but-notable: payment declined,
      idle-cart warning shown, payment attempt expired, wrong setup
      password.
    - `error` — exception/validation failure: configuration errors,
      unhandled catch blocks, receipt mismatch.
    - `debug` — verbose payload/state, noisy, off by default: request
      payloads, computed amounts, SSE listener counts.

    This is additive to (not a replacement for) the existing PostHog
    `captureDomainEvent` pipeline in `posthog.server.ts` /
    `analytics.client.ts` — that's external product analytics; consola
    is local console/stdout for reading real-time behavior during dev
    and in CI/server logs. Add log calls alongside existing
    `captureDomainEvent` calls where they overlap, don't replace them.

    **Backend touch points** (tag : sub-tags), following the data flow:
    - `kiosk` — `kiosk:verify-password`, `kiosk:claim`, `kiosk:list`,
      `kiosk:session` in `kiosk.functions.server.ts`.
    - `catalog` — menu fetch in `catalog.functions.server.ts`.
    - `order` — `order:create` in `order.functions.server.ts`.
    - `payment` — richest one, 3 outcomes: `payment:start`,
      `payment:reconcile`, `payment:expire` in
      `payment.functions.server.ts`.
    - `kitchen` — `kitchen:claim`, `kitchen:list`, `kitchen:advance` in
      `kitchen.functions.server.ts`; `kitchen:sse` (subscribe/emit) in
      `kitchen-events.server.ts` and the `/api/kitchen/events` route
      (connection open/close).

    **Frontend touch points**, following the user journey:
    - `kiosk-claim-screen.tsx` — setup password submit, claim/create
      kiosk.
    - `menu-screen.tsx` — cart add/remove/customize, checkout start.
    - `checkout-screen.tsx` — payment method choice, phase transitions,
      outcome.
    - `kitchen-screen.tsx` — staff login, SSE connection status, advance
      clicks.
    - `use-abandonment.ts` — idle warning shown, cart cleared due to
      idle, payment expired due to idle.

## Plan

Not planned yet — run the `writing-plans` skill from this worktree when
ready to sequence A and B (likely A#8 first within the UI backlog since
several other items depend on it, then the rest of A, with B able to run
independently/in parallel since it touches different files).

## Log

- 2026-08-09: promoted from the `integration` goal's captured backlog,
  worktree created at `../kiosk-polish` branched from `integration`
  (999f761), not `main` — `main` doesn't have the integration work yet
  and the real PR merge hasn't happened, but the branch is being treated
  as the effective baseline for planning purposes. Deps installed,
  baseline verified clean (lint/typecheck/test all pass, 74 tests).
