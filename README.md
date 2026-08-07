# Self-service web checkout

[![Checks](https://github.com/andrevandal/self-service-web-checkout/actions/workflows/checks.yml/badge.svg)](https://github.com/andrevandal/self-service-web-checkout/actions/workflows/checks.yml)
[![Codecov](https://codecov.io/gh/andrevandal/self-service-web-checkout/graph/badge.svg)](https://app.codecov.io/gh/andrevandal/self-service-web-checkout)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE.md)
[![Release](https://img.shields.io/github/v/release/andrevandal/self-service-web-checkout)](https://github.com/andrevandal/self-service-web-checkout/releases)

## Concept

This repository currently provides scaffold proof only: a TanStack Start page and
`/api/health` endpoint that writes and reads a `pings` record through
Drizzle/libSQL. It does **not** implement product checkout behavior yet.

## Tech stack

- Bun and TypeScript
- TanStack Start, React, and Vite
- Drizzle ORM and libSQL
- Valibot and `@vite-env/core`
- oxlint and oxfmt
- Playwright
- Docker Compose
- GitHub Actions

## Prerequisites

- Bun, at version pinned by `.prototools`
- Docker and Docker Compose for container validation or deployment
- Chromium for browser end-to-end tests: `bunx playwright install chromium`

## Quick start

```bash
bun install
cp .env.example .env
bun run db:migrate
bun run dev
```

`.env` is optional: safe defaults use `DATABASE_URL=file:./.data/local.db` and
`PORT=3000`. Open <http://localhost:3000/> or run:

```bash
curl http://localhost:3000/api/health
```

The migration is required once before the health endpoint can persist its ping.

## Development

- `bun run dev` — start Vite development server on port 3000.
- `bun run build` — produce client and server production artifacts.
- `bun run start` — run the built server from `dist/server/server.js`.
- `bun run db:generate` — generate Drizzle migrations from the schema.
- `bun run db:migrate` — apply migrations to the configured database.
- `bun run db:seed` — add one sample ping after migrations have run.
- `bun run agents:setup` — configure supported agent harnesses or print their interactive instructions.
- `bun run agents:update` — update supported agent tooling and vendored skills.

## Database

`DATABASE_URL` accepts `file:` and `libsql:` URLs. Unset or empty values default
to `file:./.data/local.db`; `.data/` is ignored. `DATABASE_AUTH_TOKEN` is
optional at application runtime for remote libSQL/Turso connections.

Run `bun run db:migrate` before `bun run db:seed` or serving the health route.
The seed command intentionally does not run migrations itself.

## Testing and quality checks

```bash
bun run lint
bun run format
bun run typecheck
bun run test
bun run test:e2e:api
bun run test:e2e:browser
bun run build
```

- `bun run test` runs unit tests under `src/` and `scripts/`.
- `bun run test:e2e:api` builds, migrates, and owns a separate HTTP server.
- `bun run test:e2e:browser` builds and drives Chromium through Playwright.
- `bun run test:e2e` runs both end-to-end layers sequentially.

Lefthook runs staged-file linting/formatting, Conventional Commit validation,
and affected colocated tests before push.

## Deployment topologies

| Compose file | Use case |
| --- | --- |
| `docker-compose.yml` | One app with a named local libSQL file volume. |
| `docker-compose.sqld.yml` | One app and an internal healthchecked sqld database. |
| `docker-compose.sqld-ha.yml` | Scalable app replicas with one sqld database single point of failure. |
| `docker-compose.turso-ha.yml` | Scalable app replicas with externally provisioned Turso credentials. |

See [deployment guidance](docs/deployment.md) for availability boundaries,
required secrets, and migration-runner constraints. No topology supplies a
reverse proxy or migration-on-boot orchestration.

## Agent tooling

[Agent tooling guidance](docs/agent-tooling.md) defines the four tiers,
vendored OpenCode skills, setup/update behavior, and harness-specific manual
steps. OMP is the recommended harness.

```bash
bun run agents:setup
bun run agents:update
```

## CI and releases

GitHub Actions runs lint, format, typecheck, unit coverage, API/browser e2e,
build, and Docker build checks on every push and pull request. Configure the
repository `CODECOV_TOKEN` Actions secret before relying on Codecov uploads.

Use Conventional Commits for commit and pull-request titles. On Conventional
Commits merged to `main`, release-please opens or updates a Release PR and owns
`CHANGELOG.md` generation.

## Documentation

- [Scaffold design](docs/specs/2026-08-06-boilerplate-design.md)
- [Implementation plan](docs/plans/2026-08-06-boilerplate-plan.md)
- [Deployment guidance](docs/deployment.md)
- [Agent tooling guidance](docs/agent-tooling.md)
- [MIT license](LICENSE.md)
