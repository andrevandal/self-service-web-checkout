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

## Architecture and production boundaries

TanStack server functions are the typed client/API boundary. Terminal integration
is deliberately simulated: the server creates payment attempts and correlates
and reconciles simulated terminal receipts; it does not perform real capture,
provide PCI compliance, or integrate a payment provider.

One restaurant uses one app container. Kiosk and staff sessions share that
process and its in-process kitchen event dispatcher. Additional kiosks connect
to the same restaurant container; shared pub/sub is needed only when one
restaurant runs multiple app instances.

See the [deployment guide](docs/deployment.md) and [contributor
guidance](AGENTS.md).
