# Take-Home Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the repository clone-and-run ready for a take-home evaluator and make its operational boundaries explicit without expanding application runtime scope.

**Architecture:** Keep the existing application, migration, seed, Docker image, and one-container-per-restaurant topology intact. Provide development-only local defaults and a linear setup path; describe containers as application runtimes against an initialized database; document architectural decisions and go-live responsibilities in the README while synchronizing the deployment guide.

**Tech Stack:** Bun, TanStack Start, Drizzle/libSQL, Docker, Markdown documentation.

## Global Constraints

- Use only the existing dependencies and scripts; do not add a bootstrap framework, entrypoint, or runtime migration/seed automation.
- `.env.example` values are development-only examples, never deployable secrets; README must require replacement for deployment.
- Container guidance assumes the target database is already reachable, migrated, and seeded before app startup.
- Preserve one application container per restaurant. Multiple kiosk/staff sessions use the in-process kitchen dispatcher; do not add pub/sub.
- Keep all evaluator-facing explanation in `README.md`; do not create a separate take-home document.
- Do not mention the Playwright/EventSource harness limitation.

---

### Task 1: Make first-time local setup complete and usable

**Files:**
- Modify: `.env.example:1-11`
- Modify: `README.md:21-41`
- Test: `scripts/seed.test.ts:13-33` (existing repeatable catalog contract)

**Interfaces:**
- Consumes: existing `KIOSK_CLAIM_PASSWORD`, `KIOSK_COOKIE_SECRET`, `STAFF_COOKIE_SECRET`, `DATABASE_URL`, and secure-cookie environment fields from `src/env.ts`.
- Produces: a copied `.env` that permits the existing kiosk claim and staff flows in local development, plus a README command sequence that always populates the menu.

- [ ] **Step 1: Establish the existing catalog seed contract**

Run:

```bash
bun test scripts/seed.test.ts
```

Expected: both seed tests pass, including `seed is repeatable and populates the catalog` with four categories and seven products. This proves the existing seed command is the correct first-run primitive; do not add a test that parses README prose.

- [ ] **Step 2: Add explicitly development-only sample environment values**

Update `.env.example` so its existing local SQLite URL and non-secure cookie flags remain unchanged. Replace the three blank required local-flow values with non-sensitive development examples:

```dotenv
KIOSK_CLAIM_PASSWORD=dev-kiosk-claim-2026
KIOSK_COOKIE_SECRET=dev-kiosk-cookie-secret-2026-rotate
STAFF_COOKIE_SECRET=dev-staff-cookie-secret-2026-rotate
```

Add a short comment immediately above them stating they are local-development values and must be replaced before deployment. Do not put production-looking secrets in the file and do not add analytics credentials.

- [ ] **Step 3: Correct the README first-run sequence**

In `README.md`'s `## First-time setup` code block, insert `bun run db:seed` between `bun run db:migrate` and `bun run dev`:

```bash
bun install
cp .env.example .env
bun run db:migrate
bun run db:seed
bun run dev
```

Immediately after the block, replace the current optional-`.env` note with two concise statements:

1. copied sample values are intentionally development-only and permit the kiosk/staff path locally;
2. deployment must replace passwords, cookie secrets, cookie security settings, and database URL.

Keep the existing localhost and health-check instructions.

- [ ] **Step 4: Exercise the documented empty-database path**

Run the README sequence against an empty local database:

```bash
rm -f .data/local.db .data/local.db-shm .data/local.db-wal
cp .env.example .env
bun run db:migrate
bun run db:seed
```

Then start the app and complete one kiosk claim/menu browse with the documented sample password. Confirm the menu is populated; this is the observable first-run contract the documentation changes introduce.

- [ ] **Step 5: Run focused verification and commit**

Run:

```bash
bun test scripts/seed.test.ts
bun run lint
bun run format
bun run typecheck
```

Expected: all commands exit zero. Commit the coupled configuration and first-run documentation change:

```bash
git add .env.example README.md
git commit -m "docs(readme): document complete local setup"
```

### Task 1A: Align active claim gates with documented runtime configuration

**Files:**
- Modify: `src/lib/kiosk-session.ts`
- Modify: `src/lib/kitchen.ts`
- Modify: `src/lib/kiosk-session.test.ts`
- Modify: `src/lib/kitchen.test.ts`
- Modify: `e2e/browser/kiosk-claim-helpers.ts`
- Modify: `e2e/browser/kitchen-queue-helpers.ts`

**Why this is required:** Task 1’s real browser smoke test established that the active kiosk and staff claim modules ignore `KIOSK_CLAIM_PASSWORD` and instead hardcode `warm-melted`. That makes the copied `.env.example` unable to perform the documented flows. The user approved this root-cause repair on 2026-08-09.

**Interfaces:**
- Consumes: existing validated `serverEnv.KIOSK_CLAIM_PASSWORD`.
- Produces: kiosk and staff claim gates that accept the configured password and reject an unset configuration or other values using their existing error code contracts.
- Preserves: existing in-memory session lifecycle, validation/error-copy contracts, browser interactions, and all existing production dependencies.

- [ ] **Step 1: Add focused red tests for configured claim credentials**

Before production edits, add focused unit coverage that loads each active claim module with a mocked `serverEnv` value and proves:

1. the configured password succeeds;
2. `warm-melted` fails when it is not configured;
3. an empty configured password produces the module’s existing `configuration` error.

Run the focused test files and confirm these assertions fail because the modules still use their hardcoded constants.

- [ ] **Step 2: Make the active handlers read validated configuration**

Replace only `SETUP_PASSWORD` and `STAFF_PASSWORD` comparisons with the existing `serverEnv.KIOSK_CLAIM_PASSWORD` value. Preserve `invalid_input` precedence for empty submitted values. If the configured value is absent, use the existing `configuration` error code; otherwise preserve the current `invalid_password` behavior for a mismatch.

Do not migrate components to separate DB-backed handlers, rewrite session storage, change cookie semantics, or add a second configuration mechanism. This task restores the explicit configuration contract to the already-active flows.

- [ ] **Step 3: Synchronize browser fixtures with the configured test environment**

Replace the hardcoded browser-helper password with `process.env.KIOSK_CLAIM_PASSWORD`. Fail fast with a clear test setup error if it is absent. The current CI workflow already injects that value; local runs use the copied `.env` or an explicit shell value. Keep all claim clicks and navigation assertions real.

- [ ] **Step 4: Verify red-green and real flows**

Run the focused unit tests after production changes and confirm they pass. Then run both browser flows with `KIOSK_CLAIM_PASSWORD=dev-kiosk-claim-2026`:

```bash
bun run test:e2e:core -- e2e/browser/kiosk-claim.spec.ts
bun run test:e2e:core -- e2e/browser/kitchen-queue.spec.ts
```

Confirm a copied `.env.example` can claim both kiosk and staff sessions using the documented value and reach their normal screens.

- [ ] **Step 5: Run quality checks and commit**

Run:

```bash
bun run lint
bun run format
bun run typecheck
bun test src/lib/kiosk-session.test.ts src/lib/kitchen.test.ts
```

Expected: all commands exit zero. Commit the atomic runtime/configuration repair:

```bash
git add src/lib/kiosk-session.ts src/lib/kitchen.ts src/lib/kiosk-session.test.ts src/lib/kitchen.test.ts e2e/browser/kiosk-claim-helpers.ts e2e/browser/kitchen-queue-helpers.ts
git commit -m "fix(kiosk): honor configured claim password"
```

### Task 2: Document the container runtime contract and deployment prerequisite

**Files:**
- Modify: `README.md:43-64`
- Modify: `docs/deployment.md:1-53`
- Test: `Dockerfile:1-27` and `docker-compose.yml:1-16` (existing runtime contract; no source-code test)

**Interfaces:**
- Consumes: the existing runtime image command (`bun run start`), port `3000`, `/app/data` directory, and `DATABASE_URL` configuration.
- Produces: a runnable container example that requires an initialized database and does not imply that startup provisions one.

- [ ] **Step 1: Record the existing image limitation before documenting it**

Inspect `Dockerfile` and `docs/deployment.md`. Confirm the runtime stage copies only `package.json` and `.output`, while the deployment guide already states that Compose does not run migrations. This anchors the new guidance in the actual image rather than inventing startup behavior.

- [ ] **Step 2: Add a README container section**

After `## Development`, add `## Container runtime` with:

```bash
docker build -t self-service-web-checkout .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL=file:/app/data/local.db \
  -e KIOSK_CLAIM_PASSWORD=replace-for-your-environment \
  -e KIOSK_COOKIE_SECRET=replace-for-your-environment \
  -e STAFF_COOKIE_SECRET=replace-for-your-environment \
  -e KIOSK_COOKIE_SECURE=false \
  -e STAFF_COOKIE_SECURE=false \
  -v kiosk-data:/app/data \
  self-service-web-checkout
```

State directly beneath it that `kiosk-data` must already contain a database that is reachable, migrated, and seeded. The command demonstrates runtime configuration only; it is not a provisioning command. Link to `docs/deployment.md` for topology detail.

- [ ] **Step 3: Synchronize deployment guide language**

Update the topology table’s “Persistent state and secrets” column to say that persistent volumes hold the database and application secrets are supplied at runtime, rather than “no secrets.” Add one sentence to `## Starting a topology` that the compose examples likewise require an initialized database and runtime application secrets; they are topology references, not zero-configuration first-run commands.

Retain the existing migration-boundary explanation. Do not add an entrypoint, a migration service, Docker Compose secrets, or a database bootstrap script.

- [ ] **Step 4: Run the container against an initialized local database**

After Task 1 has created and seeded `.data/local.db`, build and start the image with an initialized data mount and the same development-only values:

```bash
docker build -t self-service-web-checkout .
docker run --rm -d --name self-service-web-checkout-check -p 3000:3000 \
  -e DATABASE_URL=file:/app/data/local.db \
  -e KIOSK_CLAIM_PASSWORD=dev-kiosk-claim-2026 \
  -e KIOSK_COOKIE_SECRET=dev-kiosk-cookie-secret-2026-rotate \
  -e STAFF_COOKIE_SECRET=dev-staff-cookie-secret-2026-rotate \
  -e KIOSK_COOKIE_SECURE=false \
  -e STAFF_COOKIE_SECURE=false \
  -v "$(pwd)/.data:/app/data" \
  self-service-web-checkout
curl --fail http://127.0.0.1:3000/api/health
docker stop self-service-web-checkout-check
```

Expected: health endpoint returns success. Do not claim this validates provisioning; it validates the documented runtime contract against a prepared database.

- [ ] **Step 5: Run documentation-adjacent checks and commit**

Run:

```bash
bun run lint
bun run format
bun run typecheck
bun run build
```

Expected: all commands exit zero. Commit only the synchronized container/deployment documentation:

```bash
git add README.md docs/deployment.md
git commit -m "docs(deploy): clarify container database boundary"
```

### Task 2A: Pass existing runtime configuration through Compose

**Files:**
- Modify: `docker-compose.yml`
- Modify: `docker-compose.sqld.yml`
- Modify: `docs/deployment.md`

**Why this is required:** Whole-branch review found both Compose examples start `app` with only `PORT` and `DATABASE_URL`. Since `KIOSK_CLAIM_PASSWORD` and cookie secrets are required at runtime, the documented Compose commands otherwise start an app that cannot serve kiosk or staff claim flows.

**Interfaces:**
- Consumes: existing host or `.env` values for `KIOSK_CLAIM_PASSWORD`, `KIOSK_COOKIE_SECRET`, `STAFF_COOKIE_SECRET`, `KIOSK_COOKIE_SECURE`, and `STAFF_COOKIE_SECURE`.
- Produces: the same existing values in the `app` container environment for both topologies.

- [ ] **Step 1: Add environment interpolation to both app services**

In both Compose files, pass the five existing runtime variables from Compose interpolation into `app.environment`. Use required-variable interpolation for the three secret/password values so `docker compose up` fails before startup when they are absent. Pass cookie-security flags with their existing local default of `false`.

Do not add a Compose `secrets` object, files containing secrets, an entrypoint, migration orchestration, or database provisioning.

- [ ] **Step 2: Make the deployment guide executable**

Amend `docs/deployment.md` to state that the Compose commands read the five application values from the invoking environment or `.env`; deployment must supply unique values, while `.env.example` is only a local-development starting point. Retain the database initialization prerequisite and migration boundary.

- [ ] **Step 3: Validate resolved configuration and commit**

With development-only values exported, run `docker compose config` and `docker compose -f docker-compose.sqld.yml config`; confirm each rendered `app` environment contains all five values. Run `bun run lint`, `bun run format`, and `bun run typecheck`.

Commit this atomic repair:

```bash
git add docker-compose.yml docker-compose.sqld.yml docs/deployment.md docs/plans/2026-08-09-take-home-readiness-plan.md
git commit -m "fix(deploy): pass claim configuration to compose"
```

### Task 3: Make architecture choices and go-live work legible to evaluators

**Files:**
- Modify: `README.md:after Container runtime`
- Test: `README.md` reviewed against `docs/PRD.md:58-66,176-183` (documentation consistency, no source-text test)

**Interfaces:**
- Consumes: existing typed server functions, fake terminal/reconciliation implementation, in-process kitchen event dispatcher, PostHog integration, and one-container deployment model.
- Produces: an evaluator-facing explanation of current guarantees, scale boundary, and production responsibilities without claiming unimplemented infrastructure.

- [ ] **Step 1: Add `## Architecture and production boundaries` to README**

Place it after `## Container runtime`. Use concise prose with these exact decisions:

- TanStack server functions are the typed client/API boundary.
- Terminal integration is intentionally simulated; it models payment-attempt correlation and reconciliation, not real card capture, PCI compliance, or a provider integration.
- One restaurant runs one application container. Its kiosk and staff sessions share that process and its in-process kitchen event dispatcher.
- More kiosks connect to the same restaurant container. Shared pub/sub becomes necessary only when one restaurant is deployed as multiple application instances.
- Kitchen workflow, PostHog, and Docker support extend the required menu/order/payment exercise rather than becoming prerequisites for it.

Do not mention test harness behavior.

- [ ] **Step 2: Add `### Before go-live` below the boundary section**

Use an unambiguous bullet list requiring: durable database plus pre-release migration procedure; catalog ownership; unique/rotated secrets; secure cookies/TLS/trusted proxy; persistent storage/backups/restore exercises; health monitoring/alerts/operational logs; real payment-provider and PCI/compliance design if payments leave simulation; and shared transport only for multi-instance restaurant deployment.

Introductory sentence: these are deployment responsibilities, not features supplied by this take-home repository.

- [ ] **Step 3: Cross-check claims against source and PRD**

Read `src/lib/payment.functions.server.ts`, `src/lib/kitchen-events.server.ts`, `docs/PRD.md`, and the updated container docs. Confirm every README claim reflects current code and that no sentence promises automatic migration, seed, payment processing, or high availability.

- [ ] **Step 4: Run final quality and smoke verification**

Run:

```bash
bun run lint
bun run format
bun run typecheck
bun run test
bun run build
```

Then run the application with the documented local setup and verify:

```bash
curl --fail http://127.0.0.1:3000/api/health
```

Expected: static checks,  unit tests, and build pass; health endpoint responds successfully.

- [ ] **Step 5: Commit and update the existing PR**

```bash
git add README.md
git commit -m "docs(readme): explain architecture and go-live boundaries"
git push
```

Update PR #8 description to summarize the delivered clone-and-run setup, container contract, and explicitly bounded production topology.
