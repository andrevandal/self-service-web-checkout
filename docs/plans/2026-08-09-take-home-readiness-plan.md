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
