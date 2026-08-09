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
bun run dev
```

- `.env` is optional: defaults use `DATABASE_URL=file:./.data/local.db` and
`PORT=3000`.
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

See [docs/](docs/) for deployment and contributor
guidance.
