# Structured logging with consola design

## Contents

- [Goal](#goal)
- [Verified code findings](#verified-code-findings)
- [Verified consola behavior](#verified-consola-behavior)
- [Logger module design](#logger-module-design)
- [Level policy](#level-policy)
- [Backend instrumentation map](#backend-instrumentation-map)
- [Frontend instrumentation map](#frontend-instrumentation-map)
- [Relationship to PostHog domain capture](#relationship-to-posthog-domain-capture)
- [Security and payload rules](#security-and-payload-rules)
- [Test strategy and tier justification](#test-strategy-and-tier-justification)
- [Sequencing note against the polish backlog](#sequencing-note-against-the-polish-backlog)
- [Backlog coverage and explicit non-goals](#backlog-coverage-and-explicit-non-goals)
- [Self-review](#self-review)

## Goal

Add `consola`-based structured logging across the real data/user flow of this
app, using tagged and sub-tagged loggers, so kiosk behavior is readable in a
dev terminal, in CI output, and in the server's stdout without attaching a
debugger. The design intent (setup, level policy, tags, touch points) is
already agreed in `GOAL.md` item 18 and is treated as accepted; this document
verifies that intent against the code as it exists today, resolves the drift
it found, and fixes the contract the implementation plan executes. No
user-visible behavior changes: every log call is additive, sits beside the
control flow already present, and never gates, swallows, or reorders an
existing result.

## Verified code findings

Every item below comes from a direct read of the current worktree, plus direct
execution of the installed `consola` copy. Where `GOAL.md` item 18 or the
task framing disagrees with the code, the drift and its resolution is stated.

**Environment modules — drift.** The env modules are `src/env.ts` and
`src/env.server.ts`, not `src/lib/env.ts` / `src/lib/env.server.ts`.
`src/env.ts:1-47` builds `serverEnvFields`/`clientEnvFields` and exports
`defineStandardEnv({ server, client })` from `@vite-env/core`, plus
`serverEnvSchema`/`parseServerEnv`. `src/env.server.ts:1-4` is a three-line
server-only module that runs `parseServerEnv((await loadEnv(config)).server)`
at import time (top-level `await`). Client values are exposed through the
generated virtual module `virtual:env/client`, typed by the committed,
auto-generated `vite-env.d.ts`, and consumed today only by
`src/integrations/posthog/provider.client.tsx:5-9`. The one other client-side
read that is precedent for this design uses a plain `import.meta.env.VITE_*`
access: `src/lib/use-abandonment.ts:47,53`. `src/lib/terminal.ts:11-17` is
deliberately **not** cited as precedent — it reads
`VITE_TERMINAL_DELAY_MS` through a type cast plus optional chaining
(`(import.meta as ImportMeta & { env?: … }).env?.VITE_TERMINAL_DELAY_MS`),
which defeats Vite's static replacement and is the exact form this design and
its plan forbid.

Consequence for this design: an isomorphic `src/lib/logger.ts` must **not**
import `src/env.server.ts`. That module is server-only (top-level `await` plus
`@vite-env/core/load`), and the 2026-08-09 integration design already recorded
what happens when server-only imports reach the client graph — TanStack
Start's import protection breaks the build. The logger therefore reads its own
level from `process.env.LOG_LEVEL` (guarded) and
`import.meta.env.VITE_LOG_LEVEL`, mirroring `use-abandonment.ts`, while
`src/env.ts` still declares both fields so they are validated at server boot
and typed into `vite-env.d.ts`. This is a deliberate, documented split, not an
accidental second source of truth: `src/env.ts` remains the single place the
variables are declared, and `logger.ts` is the single place they are read.

**Dependency.** `consola@3.4.2` is already resolved in `bun.lock` (line 756)
as a transitive dependency of `nitro@3.0.260610-beta` (line 956). `bun add
consola` promotes it to a direct dependency and is expected to resolve to the
same `3.4.2`, so no version bump or lockfile churn beyond the new direct entry.

**Isomorphic import is real.** `node_modules/consola/package.json:22-54`
declares `"."` with a `node` condition → `dist/index.mjs` (Fancy/Basic
reporters over `process.stdout`) and a `default` condition →
`dist/browser.mjs` (`BrowserReporter` over `console.*`). So a single bare
`import { createConsola, LogLevels } from "consola"` resolves to the terminal
build on the server/Bun and to the browser build in the client bundle. `GOAL.md`'s
"no server/client split needed" claim is confirmed, and there is no secret to
protect, unlike `env.server.ts`.

**Backend touch points all exist as described.**

| GOAL sub-tag | Verified site |
| --- | --- |
| `kiosk:session` | `getKioskSessionHandler` — `src/lib/kiosk.functions.server.ts:40-52` |
| `kiosk:verify-password` | `verifySetupPasswordHandler` — `kiosk.functions.server.ts:62-73` |
| `kiosk:list` | `listKiosksHandler` — `kiosk.functions.server.ts:130-136` |
| `kiosk:claim` | `claimKioskHandler` — `kiosk.functions.server.ts:138-193` (two success returns: existing kiosk `:163`, created kiosk `:186`) |
| `catalog` | `loadMenu` — `src/lib/catalog.functions.server.ts:19-163` |
| `order:create` | `createOrderHandler` — `src/lib/order.functions.server.ts:113-332` |
| `payment:start` | `startPaymentAttemptHandler` — `src/lib/payment.functions.server.ts:217-310` |
| `payment:reconcile` | `reconcilePaymentAttemptHandler` — `payment.functions.server.ts:420-624` |
| `payment:expire` | `expirePaymentAttemptHandler` — `payment.functions.server.ts:312-414` |
| `kitchen:claim` | `claimStaffSessionHandler` — `src/lib/kitchen.functions.server.ts:233-248` |
| `kitchen:list` | `listActiveOrdersHandler` — `kitchen.functions.server.ts:250-267` |
| `kitchen:advance` | `advanceOrderHandler` — `kitchen.functions.server.ts:269-327` |
| `kitchen:sse` | `KitchenEventDispatcher.subscribe`/`emit` — `src/lib/kitchen-events.server.ts:53-62`; route GET — `src/routes/api/kitchen/events.ts:9-58` |

**Drift 1 — `order:create` is one bullet but eleven throw sites.**
`createOrderHandler` rejects through `CreateOrderError`
(`order.functions.server.ts:72-86`) with five codes across eleven sites:
`configuration` (`:117`), `kiosk_identity` (`:122`, `:132`), `invalid_input`
(inside `validateInput`, `:106`), `catalog_unavailable` (`:172`, `:223`), and
`selection_invalid` (`:176`, `:194`, `:203`, `:219`, `:231`). Eleven
near-identical log calls would be noise and would rot the first time a code is
added. Resolution: each server module gets one module-private *rejection
factory* that logs and returns the typed error, and the existing `throw` stays
at each site (`throw orderRejection("selection_invalid", "…")`). One log call
site, complete coverage, no control-flow change, no `try`/`catch` scaffolding,
no reindentation of a 220-line function.

**Drift 2 — payment "3 outcomes" means three sub-tags, not three results.**
`reconcilePaymentAttemptHandler` funnels every result through one
`transactionResult.event` object (`eventBase` at `:485`) with outcomes
`expired` (`:493-499`), `invalid` (`:502-515`), `declined`/`unavailable`
(`:517-539`), and `approved` (`:541-586`), then calls `captureDomainEvent` once
at `:589`. One log site immediately after that capture covers all five
outcomes with the correct level, so no per-branch instrumentation is needed.

**Drift 3 — kitchen needs a fifth sub-tag.** `listActiveOrdersHandler` and
`advanceOrderHandler` both authorize through the shared
`requireKitchenStaffSession` (`kitchen.functions.server.ts:110-122`), which
translates `StaffSessionError` into `KitchenOrderError`. Logging inside that
single guard beats duplicating a warn in both callers, so a
`kitchen:session` sub-tag is added to `GOAL.md`'s four (`claim`, `list`,
`advance`, `sse`) — same semantics as `kiosk:session`: identity resolution.

**Drift 4 — frontend tags were not specified.** `GOAL.md` lists five frontend
files but no tags. Resolution: frontend loggers live under a `ui` root so
browser output is distinguishable from server output during SSR-plus-hydration
development, giving `ui:setup`, `ui:menu`, `ui:checkout`, `ui:kitchen`,
`ui:idle` and nested scopes such as `ui:menu:cart` and `ui:checkout:phase`.

**Drift 5 — `catalog` needs more than "menu fetch".** `loadMenu` returns early
with an empty menu when no active category exists (`:26-28`) and when no
available product exists (`:37-47`). An empty catalog is exactly the condition
that makes the kiosk look broken while every check passes, so those two
returns get a `warn`; the normal path gets a `debug` with category/product
counts rather than an `info`, because a menu query is a read that runs on every
load and refetch, not a business milestone.

**Frontend touch points verified, with the sites that matter.**

- `src/components/kiosk-claim-screen.tsx` — `continueSetup:71-79`,
  `claimExisting:81-84`, `createKiosk:86-104`, `claimMutation.onSuccess:54-57`
  (which calls `window.location.reload()`, so its log must be emitted before
  the reload), `verifyPasswordMutation.onSuccess/onError:62-68`.
  `claimMutation` currently has no `onError`; adding one that only logs is
  additive — the error copy at `:106-108` keeps reading
  `claimMutation.error`.
- `src/components/menu-screen.tsx` — `handleProductClick:69-77` (adds directly
  when a product has no options, otherwise opens the drawer),
  `handleCustomizedAdd:79-81`, `clearCartAndCheckout:83-88`,
  `startCheckout:103-106`, and the cart-line removal dispatched inline in JSX
  at `:265`. **These five line pointers describe today's code and are not
  where Track B instruments them**: all five move or disappear before Track B
  Task 8 runs — see the Track A relocation substitutions below the frontend
  instrumentation map for each site's real destination.
- `src/components/checkout-screen.tsx` — `handleSelectMethod:152-155`, the
  phase-reporting effect at `:163-169` (the one place every phase transition
  passes through), the confirmation effect at `:172-178`, and two silent
  `catch {}` blocks at `:125-130` and `:144-149` that today drop the real
  error before setting failure copy. Those two are the highest-value `error`
  sites in the frontend.
- `src/components/kitchen-screen.tsx` — `claimMutation:308-317`,
  `advanceMutation:319-346`, the SSE effect's `onOpen:358`, `onError:359`, and
  parse `catch:368-370`, `submitPassword:401-409`, `refresh:423-425`.
- `src/lib/use-abandonment.ts` — the warning-transition effect at `:138-153`
  (fires once per warning, deps `[config, state.phase]`), the expiry effect at
  `:155-203` with its pending-payment branch (`:162-182`, silent catch at
  `:171-173`) and its cart branch (`:184-202`, silent analytics catch at
  `:198-200`).

**PostHog pipeline verified.** `src/lib/posthog.server.ts:26-40` is
best-effort and silent: no key means no-op, and capture failures are swallowed
so "analytics must never change the checkout or kitchen result". The client
side is `src/integrations/posthog/analytics.client.ts` (`captureCartAbandoned`),
loaded lazily via `createClientOnlyFn` in `use-abandonment.ts:4-6`. Server
capture sites are `payment.functions.server.ts:297`, `:397`, `:402`, `:589`,
`:600` and `kitchen.functions.server.ts:318`.

## Verified consola behavior

Confirmed by reading `node_modules/consola/dist/*` and by executing the
installed copy directly:

- `withTag` nests as `parent + ":" + child` (`dist/core.mjs:262-266`);
  observed `payment` → `payment:reconcile` and `kitchen` → `kitchen:sse`.
- `LogLevels` (`dist/core.mjs:1-16`): `fatal`/`error` 0, `warn` 1, `log` 2,
  `info`/`success`/`fail`/`ready`/`start` 3, `debug` 4, `trace` 5, `silent`
  `-Infinity`, `verbose` `+Infinity`. The five business levels therefore map
  onto four numeric thresholds — `success` prints exactly when `info` does,
  which is intended: both are "normal operation" output.
- Gating compares the **per-type** level against the instance level
  (`dist/core.mjs:172-177` and `:411-413`), so the `defaults: { level }` that
  consola's Node factory injects (`dist/index.mjs:627-637`) does not override
  type levels. Observed at level `info`: `info`/`success`/`warn` emitted,
  `debug` suppressed; at level `debug`, `debug` emitted with `level: 4`.
- An explicit `level` passed to `createConsola` wins over `CONSOLA_LEVEL` and
  over consola's env-derived default, because `...options` is spread last
  (`dist/index.mjs:636`). That default is `warn` in test-like environments
  (`_getDefaultLogLevel`, `dist/index.mjs:640-648`), so always passing the
  level explicitly is required, not cosmetic.
- Reporters and level are inherited by `withTag` children **at creation
  time**; installing a reporter on the base logger after a child already
  exists does not reach that child (observed: zero records). This dictates the
  test design — a collecting reporter must be installed before the module
  under test is imported.
- Identical repeated messages are throttled (`throttle: 1000`,
  `throttleMin: 5`): eight identical rapid `debug` calls produced six reporter
  records, and the deferred flush kept the process alive about a second.
  Consequence: hot-path logs must carry a distinguishing field (order id,
  event type), and no test may assert a call count for repeated identical
  messages.
- `import.meta.env` is a plain object under Bun (verified), so the client-side
  read also works in `bun test` without Vite's static replacement.

## Logger module design

One isomorphic module, `src/lib/logger.ts`:

```ts
import { createConsola, LogLevels } from "consola";

export type LogLevelName = "silent" | "error" | "warn" | "info" | "debug" | "trace" | "verbose";

const DEFAULT_LOG_LEVEL: LogLevelName = "info";

export const resolveLogLevel = (name: string | undefined): number =>
  name && name in LogLevels ? LogLevels[name as LogLevelName] : LogLevels[DEFAULT_LOG_LEVEL];

const configuredLogLevelName = (): string | undefined =>
  (typeof process === "undefined" ? undefined : process.env.LOG_LEVEL) ||
  import.meta.env.VITE_LOG_LEVEL;

export const createLogger = (levelName?: string) =>
  createConsola({ level: resolveLogLevel(levelName) });

export const logger = createLogger(configuredLogLevelName());
```

Decisions:

- **`LOG_LEVEL` wins on the server, `VITE_LOG_LEVEL` is the client's only
  input.** `process` is undefined in the browser, so the guard resolves to the
  Vite-inlined client value there; on the server both may exist and the
  runtime-changeable `LOG_LEVEL` takes precedence over a build-time constant.
  `import.meta.env.VITE_LOG_LEVEL` is written as a plain member access — not
  optional-chained — so Vite's static replacement applies, exactly as in
  `use-abandonment.ts`.
- **`createLogger` is exported for the level/gating unit test.** It is one
  named factory, not an abstraction layer: no wrapper types, no log facade, no
  per-module registry.
- **`resolveLogLevel` never throws.** An unrecognized name falls back to
  `info` so a mistyped `VITE_LOG_LEVEL`, which has no boot validation in the
  browser, cannot silence or crash the kiosk.
- **`src/env.ts` still declares both variables** —
  `LOG_LEVEL: v.optional(v.picklist([...names]), "info")` in
  `serverEnvFields` and `VITE_LOG_LEVEL: v.optional(v.picklist([...names]))`
  in `clientEnvFields` — so a typo on the server fails fast at boot the way a
  bad `DATABASE_URL` scheme already does (`src/env.ts:7-10`), and
  `vite-env.d.ts` regenerates with the new keys. That regenerated file is
  committed, as it is today.
- **Per-module scopes are hoisted.** Each module creates its tag once at
  module scope (`const log = logger.withTag("payment")`) plus one hoisted
  sub-scope per sub-tag (`const reconcileLog = log.withTag("reconcile")`).
  `withTag` allocates a full Consola instance, so calling it inside a request
  handler would allocate per request for no gain.
- **Rejection factories.** Each server module that throws typed errors gets
  one module-private factory that logs, then returns the error to be thrown:

  ```ts
  const orderRejection = (code: CreateOrderErrorCode, detail: string) => {
    const message = `order rejected: ${code}`;
    if (code === "configuration") {
      createLog.error(message, { detail });
    } else {
      createLog.warn(message, { detail });
    }
    return new CreateOrderError(code, detail);
  };
  ```

  Call sites keep their visible `throw`, control-flow analysis is unchanged,
  and a newly added error code is instrumented for free.
- **No reporter customization, no transports, no file sinks.** consola picks
  Fancy in an interactive terminal, Basic in CI/non-interactive stdout, and
  Browser in the client; that is the whole reason this dependency was chosen.

## Level policy

`GOAL.md`'s business-meaning policy, plus the one rule it left implicit: a
typed error the UI renders as recoverable copy is a `warn`; a `configuration`
code or an otherwise-unhandled exception is an `error`.

| Level | Meaning | Numeric threshold |
| --- | --- | --- |
| `success` | User/business action completed: kiosk claimed, order paid, order marked done, item added to cart | 3 (prints at `info`) |
| `info` | Lifecycle milestone: order created, payment attempt started, SSE client connected, checkout phase change | 3 |
| `warn` | Recoverable or expected-but-notable: payment declined, idle warning shown, attempt expired, wrong setup password, empty catalog, rejected input | 1 |
| `error` | Exception or configuration/consistency failure: missing secret, receipt mismatch, otherwise-silent catch block | 0 |
| `debug` | Verbose payload/state, off by default: request shapes, computed amounts, SSE listener counts, row counts | 4 |

Accepted `LOG_LEVEL`/`VITE_LOG_LEVEL` values: `silent`, `error`, `warn`,
`info` (default), `debug`, `trace`, `verbose`.

## Backend instrumentation map

Tag roots are created per module; sub-scopes are hoisted alongside.

**`kiosk` — `src/lib/kiosk.functions.server.ts`**

| Sub-tag | Site | Level | Payload |
| --- | --- | --- | --- |
| `kiosk:session` | `:40-52`, cookie missing/invalid, or row not found | `debug` | resolved kiosk id or `null` reason |
| `kiosk:verify-password` | `:72` success | `info` | none |
| `kiosk:verify-password` | `:67` / `:70` via rejection factory | `error` / `warn` | code + detail |
| `kiosk:list` | `:135` | `debug` | kiosk count |
| `kiosk:claim` | `:163` existing, `:186` created | `success` | kiosk id, prefix, `created: boolean` |
| `kiosk:claim` | `:141`, `:144`, `:155`, `:168`, `:189`, plus `selectPrefix` `:106`/`:114`/`:127` via rejection factory | `error` for `configuration`, `warn` otherwise | code + detail |

**`catalog` — `src/lib/catalog.functions.server.ts`**

| Sub-tag | Site | Level | Payload |
| --- | --- | --- | --- |
| `catalog` | `:26-28` no active category, `:37-47` no available product | `warn` | which stage was empty |
| `catalog` | `:154-162` normal return | `debug` | category count, product count |

**`order` — `src/lib/order.functions.server.ts`**

| Sub-tag | Site | Level | Payload |
| --- | --- | --- | --- |
| `order:create` | `:114` after `validateInput` | `debug` | line count, total quantity |
| `order:create` | `:322-330` return | `info` | order id, kiosk id, item count, `subtotalCents` |
| `order:create` | all eleven `CreateOrderError` sites via `orderRejection` | `error` for `configuration`, `warn` otherwise | code + detail |

**`payment` — `src/lib/payment.functions.server.ts`**

| Sub-tag | Site | Level | Payload |
| --- | --- | --- | --- |
| `payment:start` | after `captureDomainEvent` at `:297-307` | `info` | attempt id, order id, method, `amountCents`, `attemptCount` |
| `payment:start` | input validator `validateStartPaymentAttemptInput` `:168` (`invalid_input`, "Order id is required"), pre-transaction guards `:223`, `:228`, and in-transaction `:238`, `:253` via `paymentRejection` | `error` for `configuration`, `warn` otherwise | code + detail |
| `payment:reconcile` | single site after `captureDomainEvent` at `:589-593`, switching on `transactionResult.event.outcome` | `success` for `approved`; `warn` for `declined`/`unavailable`/`expired`; `error` for `invalid` (receipt mismatch) | attempt id, order id, order number when present, `amountCents`, `attemptCount`, `elapsedMs`, `failureReason` |
| `payment:reconcile` | input validator `validateReconcilePaymentAttemptInput` `:176` (`invalid_input`, "Attempt receipt is invalid"), guards `:426`, `:431`, `:441`, `:465`, `:468`, `:474`, `:477`, `:567` via `paymentRejection` | `error` for `configuration`, `warn` otherwise | code + detail |
| `payment:expire` | after `captureDomainEvent` at `:397-411` | `warn` | attempt id, order id, `amountCents`, `elapsedMs`, `failureReason: "client_idle_timeout"` |
| `payment:expire` | input validator `validateExpirePaymentAttemptInput` `:184` (`invalid_input`, "Attempt id is required"), guards `:318`, `:323`, `:333`, `:353`, `:356`, `:362`, `:365` and `expireAttemptInTransaction` `:203`/`:213` via `paymentRejection` | `error` for `configuration`, `warn` otherwise | code + detail |

**`kitchen` — `src/lib/kitchen.functions.server.ts`, `src/lib/kitchen-events.server.ts`, `src/routes/api/kitchen/events.ts`**

| Sub-tag | Site | Level | Payload |
| --- | --- | --- | --- |
| `kitchen:claim` | `:245-247` success | `info` | `issuedAt` |
| `kitchen:claim` | `:239`, `:242` via rejection factory | `error` / `warn` | code + detail |
| `kitchen:session` | `requireKitchenStaffSession` catch `:113-121` | `error` for `configuration`, `warn` for `staff_identity` | translated code |
| `kitchen:list` | `:258-266` return | `debug` | active order count |
| `kitchen:list` | `:260-263` `order_not_found` (incomplete active order snapshot) via rejection factory | `warn` | code + detail |
| `kitchen:advance` | `:325-326` after `captureDomainEvent`, `preparing` | `info` | order id, order number |
| `kitchen:advance` | same site, `done` | `success` | order id, order number, `elapsedMs` |
| `kitchen:advance` | `:286`, `:291`, `:300` via rejection factory | `warn` | code + detail |
| `kitchen:sse` | `KitchenEventDispatcher.emit` `:58-62` | `debug` | event type, order id, listener count |
| `kitchen:sse` | `KitchenEventDispatcher.subscribe` `:53-56` and its returned unsubscribe | `debug` | listener count after change |
| `kitchen:sse` | route `:11-13` unauthorized | `warn` | reason (`missing_secret` or `missing_cookie`) |
| `kitchen:sse` | route `:36` after `": connected"` | `info` | none |
| `kitchen:sse` | route `:28-34` enqueue failure and `:42-48` `cancel()` | `debug` | close reason |

Heartbeat enqueues (`:40`) are deliberately not logged: a five-second
identical message would be throttled into a misleading "repeated N times"
line and would drown real events.

## Frontend instrumentation map

| Tag | Site | Level | Payload |
| --- | --- | --- | --- |
| `ui:setup` | `continueSetup:73-76` empty password | `warn` | none |
| `ui:setup` | `verifyPasswordMutation.onSuccess:62-65` | `info` | none |
| `ui:setup` | `verifyPasswordMutation.onError:66-68` | `warn` | the caught error's `.message` (see the resolver note below) |
| `ui:setup` | `claimExisting:81-84` and `createKiosk:99-103` submit | `info` | kiosk id or name/prefix presence |
| `ui:setup` | `createKiosk:90-97` local validation failure | `warn` | which field failed |
| `ui:setup` | `claimMutation.onSuccess:54-57`, before `window.location.reload()` | `success` | kiosk id |
| `ui:setup` | new `claimMutation.onError` (log-only) | `warn` | the caught error's `.message` (see the resolver note below) |
| `ui:menu:cart` | one-tap add for a product with no options — the `ProductCard` activation callback that calls `addCartLine` (post-Track-A: `menu-screen.tsx`) | `success` | product id, name |
| `ui:menu` | product activation that navigates to `/details?id=` for a configurable product (post-Track-A: `menu-screen.tsx`) | `debug` | product id |
| `ui:menu:cart` | customized add — `ProductDetailsScreen`'s add-to-order calling `addCartLine` (post-Track-A: `product-details-screen.tsx`) | `success` | product id, variant count, addon count |
| `ui:menu:cart` | cart-line removal calling `removeCartLine` (post-Track-A: `cart-screen.tsx`) | `info` | line id, product name |
| `ui:menu:cart` | cart clear — `completeCheckout` and the idle cart-expiry path (post-Track-A: `kiosk-customer-layout.tsx`) | `info` | a `reason` discriminator only (`checkout_complete` / `idle_expiry`) — required because both paths share the tag and message and consola throttles identical repeats. No line count: these callbacks feed `useAbandonment` and the memoized flow context, so their identity must stay stable and `cart` is deliberately not closed over |
| `ui:menu:checkout` | `beginCheckout` (post-Track-A: `kiosk-customer-layout.tsx`) | `info` | line count, `subtotalCents` |
| `ui:checkout:phase` | phase-reporting effect `:163-169` | `info` | phase, order id, attempt id |
| `ui:checkout` | `handleSelectMethod:152-155` | `info` | method |
| `ui:checkout` | the effect that owns the confirmed transition — post-Track-A Task 6 this is the countdown effect that replaces the 2-second `setTimeout`; log once on entering `confirmed`, never per countdown tick | `success` | order number |
| `ui:checkout` | `runAttempt:114-118` non-approved result | `warn` | attempt status |
| `ui:checkout` | catch blocks `:125-130` and `:144-149` | `error` | the caught error |
| `ui:kitchen` | `submitPassword:403-406` empty password | `warn` | none |
| `ui:kitchen` | `claimMutation.onSuccess:310-313` | `info` | none |
| `ui:kitchen` | `claimMutation.onError:314-316` | `warn` | resolved error code |
| `ui:kitchen` | `advanceMutation.onSuccess:329-333` | `success` for `done`, `info` for `preparing` | order id, target status |
| `ui:kitchen` | `advanceMutation.onError:334-345` | `warn` | order id, resolved code |
| `ui:kitchen:sse` | `onOpen:358` | `info` | none |
| `ui:kitchen:sse` | `onError:359` | `warn` | none |
| `ui:kitchen:sse` | parse catch `:368-370` | `error` | the caught error |
| `ui:kitchen` | `refresh:423-425` | `debug` | none |
| `ui:idle` | warning effect `:138-141` | `warn` | `secondsRemaining`, cart line count |
| `ui:idle` | pending-payment expiry `:162-166` | `warn` | order id, attempt id |
| `ui:idle` | `expirePaymentAttempt` catch `:171-173` | `error` | the caught error |
| `ui:idle` | cart-cleared branch `:184-202` | `warn` | line count, `subtotalCents`, `idleDurationMs` |
| `ui:idle` | analytics catch `:198-200` | `debug` | the caught error |

**Error-code resolver note.** `kitchen-screen.tsx` has a real code resolver
(`getKitchenErrorCode`, `:47-58`), so its `warn` records carry the resolved
`KitchenErrorCode`. `kiosk-claim-screen.tsx` has no equivalent: its
module-private `errorCopy` (`:24-35`) resolves straight to display copy and
returns no code, and adding a code-resolver export purely to enrich a log
would be a behavior change in a component this track is only annotating. The
two `ui:setup` warn records therefore carry `String((error as Error).message)`
— which, per `PaymentAttemptError`/`KioskClaimError`'s deliberate
`super(code)` convention, is the error code string after RPC deserialization
anyway.

**Track A relocation substitutions.** Track A moves every `menu-screen.tsx`
site above before Track B instruments them (see the Sequencing note): cart
lifecycle moves into `kiosk-customer-layout.tsx`, cart-line removal into
`cart-screen.tsx`, and customized add into `product-details-screen.tsx`. One
site does not survive in any form: Track A deletes
`customization-drawer.tsx`, so the drawer-open record that was the sole
carrier of the bare `ui:menu` tag has no successor. That tag is reassigned to
the closest surviving analog — the product activation that navigates to
`/details?id=` for a configurable product, which is now what "the customer
opened customization" means. `ui:menu` therefore stays in the tag vocabulary
with unchanged level (`debug`) and payload (product id).

## Relationship to PostHog domain capture

consola is local console/stdout output for reading real-time behavior in dev,
CI, and server logs. PostHog `captureDomainEvent` is external product
analytics. This design is strictly additive, enforced by four rules the plan
repeats as constraints:

1. A log call sits **beside** a `captureDomainEvent` call, never inside it and
   never replacing it. No existing capture call, event name, or property is
   removed, renamed, or reordered.
2. No log call is conditional on PostHog being configured, and no capture call
   becomes conditional on a log level. `posthog.server.ts:13-15` (no
   `POSTHOG_KEY` means the client is `null`) and `:31-33` (`captureDomainEvent`
   returning early when there is no client) must both remain invisible to
   logging.
3. Where a capture already builds a property object, the log reuses that
   object's fields under their **camelCase** source names, so a PostHog event
   and a log line for the same moment are directly comparable during
   debugging. The camelCase form is the source of truth: `PaymentOutcomeEvent`
   (`payment.functions.server.ts:112-122`) and `transactionResult.event` are
   camelCase (`amountCents`, `attemptCount`, `elapsedMs`, `failureReason`),
   and `toPaymentEventProperties` (`:124-142`) is the single boundary that
   converts to snake_case **for PostHog only**. Log records therefore carry
   `amountCents`, `attemptCount`, `elapsedMs`, `failureReason`,
   `subtotalCents`, `issuedAt`, `secondsRemaining`, and `idleDurationMs` —
   never their snake_case wire names — and no log call passes through
   `toPaymentEventProperties`.
4. consola never becomes an analytics transport: no custom reporter forwards
   logs to PostHog, and the browser logger stays independent of the lazily
   loaded `analytics.client.ts` path in `use-abandonment.ts`.

## Security and payload rules

- Never log the setup or staff password value — not from
  `verifySetupPasswordHandler`/`claimKioskHandler` inputs, not from
  `claimStaffSessionHandler`, and not from the `password` state in
  `kiosk-claim-screen.tsx` or `kitchen-screen.tsx`. Log only the outcome.
- Never log cookie secrets, signed cookie strings, or `serverEnv` contents.
  `configuration` rejections log the code and the existing human-readable
  detail, both of which are already safe (`"Kiosk cookie secret is not
  configured"`).
- Log ids, counts, amounts, and statuses. Full cart contents and full request
  payloads belong at `debug` only, and even there as counts/ids rather than
  the whole line array.
- Simulated terminal receipts (`sim-reference-*` from `terminal.ts:31`) are
  not payment instruments; logging the reference is safe and is what makes a
  receipt mismatch diagnosable.

## Test strategy and tier justification

This is cross-cutting instrumentation with no new screen, no new route, and no
changed user-visible behavior, so the `GOAL-HUB.md` default of opening with a
failing `e2e/browser/*.spec.ts` would prove nothing about the change: it would
either assert existing behavior that already passes, or assert on consola's
`%c` badge formatting and log copy, binding the browser suite to presentation
detail. The tier that actually proves this contract is a colocated `bun test`
tier, in two parts.

**Tier 1 — logger configuration unit test, `src/lib/logger.test.ts`.** Written
first and red before `logger.ts` exists:

- `resolveLogLevel` returns `LogLevels.info` for `undefined`, `""`, and an
  unrecognized name, and the matching numeric value for each accepted name.
- Tag composition: a collecting reporter installed on
  `createLogger("debug")` observes `tag: "payment:reconcile"` for
  `base.withTag("payment").withTag("reconcile")`, and `"kitchen:sse"` for the
  dispatcher's nesting.
- Level mapping/gating: at `info`, `success`/`info`/`warn`/`error` records
  appear and `debug` does not; at `debug` the `debug` record appears with
  `level: 4`; at `silent` nothing is recorded.

**Tier 2 — spy-based assertions at a representative subset of call sites.** A
shared helper, `src/test/logger-test-support.ts`, mirrors the existing
`src/test/db-test-support.ts` convention: it sets `logger.level` to
`LogLevels.debug`, installs a collecting reporter on the exported `logger`,
and returns `{ records, reset }`. Because reporters and level are inherited by
`withTag` children **at creation time** (verified above), the helper must run
before the module under test is imported — the same
`mock.module(...)`-then-`await import(...)` ordering the repo already uses in
`posthog.server.test.ts`, `-health.test.ts`, and `-events.test.ts`.

Representative sites, chosen to cover one tag per subsystem and both a success
and a rejection path, added to the existing colocated suites:

- `src/lib/kiosk.functions.test.ts`: claim with a wrong password records
  `kiosk:claim` at `warn`; a successful claim records `kiosk:claim` at
  `success`.
- `src/lib/order.functions.test.ts`: a successful create records
  `order:create` at `info`; a `selection_invalid` rejection records
  `order:create` at `warn` with the code.
- `src/lib/payment.functions.test.ts`: an approved reconcile records
  `payment:reconcile` at `success`; a declined receipt records it at `warn`; a
  mismatched receipt records it at `error`.
- `src/lib/kitchen.functions.test.ts`: advancing to `done` records
  `kitchen:advance` at `success`.
- `src/routes/api/kitchen/-events.test.ts`: the 401 path records
  `kitchen:sse` at `warn`; the streaming path records `kitchen:sse` at `info`.

Assertions match on `{ tag, type }` and on a stable substring/id in the
payload — never on full formatted output, and never on a call count for a
repeated identical message (consola throttles those, verified). Tests must not
assert that unrelated modules logged nothing, since records accumulate across
imports; `reset()` is called per test.

**Frontend tier — explicitly no automated assertion.** The repo has no DOM
test renderer: colocated tests cover pure logic only (`cart.test.ts`,
`idle-timer.test.ts`, and `kitchen-screen.test.ts`, which tests
`applyKitchenEvent` and nothing rendered). Installing a renderer to assert log
calls would be disproportionate to the change. Frontend proof is therefore:
the existing `bun run test:e2e` suite passing unchanged (no behavioral
regression from the added calls), plus a documented manual walkthrough in
`bun run dev` with `VITE_LOG_LEVEL=debug`, observing the browser console for
`ui:setup`, `ui:menu:cart`, `ui:checkout:phase`, `ui:kitchen:sse`, and
`ui:idle` records along the real user journey.

**Tooling note.** `scripts/affected-tests.ts:11-19` maps `foo.ts` →
`foo.test.ts`, so the dash-prefixed `src/routes/api/kitchen/-events.test.ts`
is never selected by the `pre-push` hook, and `.tsx` files map to nothing. The
plan runs those suites explicitly instead of relying on the hook.

## Sequencing note against the polish backlog

Track A (`GOAL.md` items 1–17) restructures several of the same files this
track annotates: item 8 moves search, item details, and checkout onto real
routes (`/search?q=`, `/details?id=`, `/pay?step=`) behind a shell layout
route, which relocates or deletes the very call sites listed above:
`handleProductClick`'s one-tap add stays in `menu-screen.tsx` behind
`ProductCard`'s activation callback, its customization branch becomes a
`/details?id=` navigation, `handleCustomizedAdd` moves to
`product-details-screen.tsx`, the inline cart-remove dispatch moves to
`cart-screen.tsx`, `clearCartAndCheckout`/`startCheckout` become
`completeCheckout`/`beginCheckout` in `kiosk-customer-layout.tsx`, and
`customization-drawer.tsx` is deleted outright. Items 5, 6, 7, 10, 11, and 13
further rewrite `menu-screen.tsx` and the payment screens — item 6 in
particular replaces `checkout-screen.tsx`'s 2-second confirmation
`setTimeout` with a per-second countdown.

Therefore:

- Track B's **backend** tasks (`kiosk`, `catalog`, `order`, `payment`,
  `kitchen`, plus `logger.ts`, `src/env.ts`, and docs) touch no file Track A
  edits and can land at any time, in parallel with Track A.
- Track B's **kiosk-setup** and **kitchen-staff** frontend tasks
  (`src/components/kiosk-claim-screen.tsx` → Task 7,
  `src/components/kitchen-screen.tsx` → Task 10) have **no Track A
  dependency**: Track A never edits either file — its constraints keep
  `KioskClaimScreen` claim behavior and `KitchenScreen`/staff-cookie/SSE behavior
  unchanged. They run in Track B's backend wave, alongside Tasks 1–6.
- Track B's **customer-journey** frontend tasks (Task 8 menu/cart/details,
  Task 9 checkout plus `use-abandonment.ts`) must land **after Track A's
  Task 11 (final integration and reconciliation) completes** — not merely
  after Track A's item 8 nav split. Task 11 is where Track A removes dead
  local state, deletes drawer code, drops stale exports and selectors, and
  re-runs route generation, so instrumenting before it risks targeting call
  sites Task 11 then deletes or moves again. Log calls are written once,
  against the final component boundaries.
- The only non-UI overlap risk is `src/env.ts` plus its generated
  `vite-env.d.ts`: if Track A adds any `VITE_*` variable, both tracks touch
  that file and the regenerated declaration. Track A has confirmed it plans no
  env change; if that changes, the two additions are independent keys and the
  declaration file is regenerated by any `bun run dev`/`bun run build`.

## Backlog coverage and explicit non-goals

`GOAL.md` item 18 is covered in full: dependency promotion, the isomorphic
`src/lib/logger.ts` with `createConsola`, `LOG_LEVEL`/`VITE_LOG_LEVEL` through
`LogLevels`, per-module `withTag` with nested sub-scopes, the five-level
business policy, all five backend tag groups with every named sub-tag (plus
the `kitchen:session` addition justified above), all five frontend touch
points named in item 18 — after Track A's route split, the menu/cart touch
point spans `menu-screen.tsx`, `product-details-screen.tsx`,
`cart-screen.tsx`, and `kiosk-customer-layout.tsx` rather than
`menu-screen.tsx` alone, with the `ui:menu` tag reassigned as recorded above —
and the additive relationship to `captureDomainEvent`.

Items 1–17 belong to Track A and are out of scope here.

Deliberate non-goals, each with a reason rather than a deferral note:

- `scripts/seed.ts`, `scripts/reset-db.ts`, and `src/db/client.ts` are not
  instrumented: they are one-shot developer scripts whose output is already
  their result, and `item 16` will rewrite the seed entirely.
- `src/routes/index.tsx` is not instrumented: its only action is calling
  `getKioskSession`, which is already logged server-side as `kiosk:session`.
- `posthog.server.ts` internals stay silent; logging a swallowed analytics
  failure there would fire on every capture in any environment without a
  PostHog key, which is the default local and CI state.
- No log shipping, file transport, request-id/correlation-id propagation, or
  custom reporter. Those are a different design; this one is console output.

## Self-review

- **Coverage:** Every `GOAL.md` item-18 requirement maps to a section here and
  to a numbered task in `docs/plans/2026-08-21-structured-logging-plan.md`:
  setup, level policy, backend tags/sub-tags, frontend touch points, PostHog
  additivity, and the test tiers. Non-goals are named with reasons.
- **Contract consistency:** Tag strings are fixed here and reused verbatim by
  the plan (`kiosk:*`, `catalog`, `order:create`, `payment:{start,reconcile,expire}`,
  `kitchen:{claim,session,list,advance,sse}`, `ui:{setup,menu,checkout,kitchen,idle}`);
  `resolveLogLevel`/`createLogger`/`logger` are the only exported names; every
  cited file/function/line was read directly, and the five drifts found are
  resolved in the design rather than left for the implementer. Three further
  contracts are stated once here and repeated verbatim in the plan's Global
  Constraints: log payload fields are **camelCase** (`toPaymentEventProperties`
  is the PostHog-only snake_case boundary and no log call passes through it);
  the `ui:menu` tag is reassigned to the `/details?id=` navigation because
  Track A deletes `customization-drawer.tsx`; and the Track A gate is Tasks 7
  and 10 free of any Track A dependency with Tasks 8 and 9 gated on Track A's
  Task 11.
- **Scope:** No new route, endpoint, schema, migration, fixture, or UI change.
  One new runtime dependency already present transitively at the same version.
  Two new env keys with defaults, so no deployment breaks by omission. No
  existing assertion weakened; existing tests gain assertions only.
- **Security:** Passwords, cookie secrets, and signed cookies are never
  logged; cart/request payloads are `debug`-only and reduced to counts and
  ids; the default level is `info`, so debug payloads are off unless a
  developer opts in.
- **Documentation:** `.env.example`, `README.md` first-time setup, and
  `docs/deployment.md`'s compose environment paragraph are updated in the same
  task that introduces the variables, per `AGENTS.md` docs-first. `CHANGELOG.md`
  is release-please-generated and is not hand-edited. The `src/env.ts` change
  regenerates the committed `vite-env.d.ts`.
