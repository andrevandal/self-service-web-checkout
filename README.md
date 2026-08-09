# Self-service web checkout

[![Checks](https://github.com/andrevandal/self-service-web-checkout/actions/workflows/checks.yml/badge.svg)](https://github.com/andrevandal/self-service-web-checkout/actions/workflows/checks.yml)
[![Codecov](https://codecov.io/gh/andrevandal/self-service-web-checkout/graph/badge.svg?token=XA67SVXCDW)](https://codecov.io/gh/andrevandal/self-service-web-checkout)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE.md)
[![Release](https://img.shields.io/github/v/release/andrevandal/self-service-web-checkout)](https://github.com/andrevandal/self-service-web-checkout/releases)

## Purpose

Self-service web checkout is a showcase project for a frictionless kiosk
checkout experience. It uses Bun, TanStack Start, Drizzle/libSQL, and
Playwright to explore a reliable, maintainable web foundation for that concept.

## Kiosk scenario

A customer approaches a kiosk and independently completes a checkout with a
clear, low-friction interface. The project uses that scenario to guide product
and technical decisions without presenting unimplemented checkout capabilities
as available today.

## First-time setup

Prerequisites:

- Bun, at the version pinned by `.prototools`
- Chromium for browser end-to-end tests: `bunx playwright install chromium`

```bash
bun install
cp .env.example .env
bun run db:migrate
bun run db:seed
bun run dev
```

- Copied sample values are development-only and enable kiosk/staff flows locally.
- Before deployment, replace the password, cookie secrets, cookie security settings, and database URL.
- Open <http://localhost:3000/> or verify the running app:

```bash
curl http://localhost:3000/api/health
```

## Development

```bash
# Database
bun run db:generate
bun run db:migrate
bun run db:seed

# Quality
bun run lint
bun run format
bun run typecheck
bun run test
bun run test:e2e

# Production build
bun run build
bun run start
```

## Container runtime

Build and run the runtime-only image with:

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

The `kiosk-data` volume must already contain a reachable, migrated, seeded
database. This command demonstrates runtime configuration only; it does not
provision, migrate, or seed the database. See the [deployment
guide](docs/deployment.md) for the database and migration boundary.

## Architecture and production boundaries

TanStack server functions are the typed client/API boundary. Terminal integration
is deliberately simulated: the server creates payment attempts and correlates
and reconciles simulated terminal receipts; it does not perform real capture,
provide PCI compliance, or integrate a payment provider.

One restaurant uses one app container. Kiosk and staff sessions share that
process and its in-process kitchen event dispatcher. Additional kiosks connect
to the same restaurant container; shared pub/sub is needed only when one
restaurant runs multiple app instances. The kitchen workflow, PostHog analytics,
and Docker packaging extend the required menu/order/payment exercise, but are
not prerequisites for that core flow.

### Before go-live

These are deployment responsibilities, not supplied take-home features:

- Provide a durable database and a pre-release migration procedure.
- Define catalog ownership and the process for publishing catalog changes.
- Supply unique, rotated secrets through the deployment environment.
- Enforce secure cookies, TLS, and a correctly configured trusted proxy.
- Provide persistent storage, backups, and exercised restore procedures.
- Operate health monitoring, alerts, and operational logs.
- If payments leave the simulation, integrate a real payment provider and
  complete the applicable PCI and compliance work.
- Add shared transport only for a multi-instance deployment of one restaurant.

See [docs/](docs/) for deployment and contributor
guidance.
