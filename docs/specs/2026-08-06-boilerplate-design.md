# Boilerplate Design — Project Scaffolding

Date: 2026-08-06
Status: Approved for planning

## Contents

- [Purpose](#purpose)
- [Runtime & tooling baseline](#runtime--tooling-baseline)
- [Editor & repo hygiene](#editor--repo-hygiene)
- [Application framework](#application-framework)
- [Data layer](#data-layer)
- [Typed environment (`src/env.ts` and `src/env.server.ts`)](#typed-environment-srcenvts-and-srcenvserverts)
- [Deployment topologies (Docker Compose)](#deployment-topologies-docker-compose)
- [Testing](#testing)
- [Coverage & badges](#coverage--badges)
- [Agent tooling setup (harness-agnostic, standardized)](#agent-tooling-setup-harness-agnostic-standardized)
- [Keeping agent tooling current (`bun run agents:update`)](#keeping-agent-tooling-current-bun-run-agentsupdate)
- [Git hooks (lefthook) + commit convention](#git-hooks-lefthook--commit-convention)
- [CI (GitHub Actions)](#ci-github-actions)
- [Release automation](#release-automation)
- [Documentation](#documentation)
- [Development workflow](#development-workflow)
- [Execution decisions](#execution-decisions)
- [Non-goals](#non-goals)

## Purpose

Scaffold the toolchain, application skeleton, and agent-tooling setup for
this repository, independent of whatever domain feature gets built on top of
it. This spec defines **wiring only**: a working "hello world" app, proven
end-to-end tooling (lint, format, test, build, DB, deploy topology), and a
standardized multi-harness AI-agent setup. No product/domain code, schema,
or UI is defined here — see "Non-goals."

## Runtime & tooling baseline

- **Bun** is the sole JS runtime and package manager for the app itself —
  dev server, test runner (`bun test`), and the Docker base image
  (`oven/bun`). All one-off tool invocations use `bunx` (Bun's `npx`
  equivalent), not `npx`. Tooling still shells out to Node where the
  ecosystem leaves no choice (`commitlint`'s TS config loader, the
  JS-based GitHub Actions used in CI) — "Bun-only" describes the app
  runtime and every command this repo's own scripts run, not every
  process a GitHub Action happens to execute internally.
- **`.prototools`** (proto/moonrepo tool pin) pins the Bun version used
  across local dev and CI.
- **`.editorconfig`**: UTF-8, LF line endings, 2-space indent, trim trailing
  whitespace, final newline.
- **oxlint** (`.oxlintrc.json`): linting for TypeScript + React, with
  sensible category defaults (func-style-as-expression, `curly`, no
  Astro-specific overrides since this is a pure React/TS app).
- **oxfmt** (`.oxfmtrc.jsonc`): formatting for `.ts/.tsx/.json/.md`,
  Prettier-compatible config (print width, semicolons, quote style).
  Chosen over Prettier to stay in the single oxc/rust toolchain family.
- **`.dockerignore`**: excludes `node_modules`, `.git`, `*.db*` (local
  libSQL files), `.data/`, `.env*`, `dist`, `.output`, `coverage`,
  `test-results` from the Docker build context.
- **`package.json` scripts**: `dev`, `build`, `start`, `lint`, `lint:fix`,
  `format`, `format:fix`, `typecheck`, `test`, `test:e2e`,
  `test:e2e:api`, `test:e2e:browser`, `db:generate`, `db:migrate`,
  `db:seed`, `agents:setup`, `agents:update` (see
  [Agent tooling setup](#agent-tooling-setup-harness-agnostic-standardized)).
  `typecheck` runs `tsc --noEmit` — Vite/TanStack Start's build does not
  fail on type errors by default, so this is a separate, explicit gate.
  The Vite-native runtime commands are `vite dev`, `vite build`, and
  `bun dist/server/server.js`; the latter is the production server emitted
  by the configured TanStack Start Vite plugin.

## Editor & repo hygiene

- **`.vscode/settings.json`**: `oxc.oxc-vscode` as the default formatter,
  format-on-save, JSON formatting enabled.
- **`.vscode/extensions.json`**: recommends `oxc.oxc-vscode`; explicitly
  lists Prettier's and ESLint's VS Code extensions under
  `unwantedRecommendations`, so editors don't silently fight the
  oxlint/oxfmt setup.
- **`.github/PULL_REQUEST_TEMPLATE.md`**: minimal `Summary` +
  `Test plan` sections.

## Application framework

- **TanStack Start** (React variant) as the single full-stack app: file-based
  routing serves both UI pages and API endpoints as TanStack Start server
  routes, sharing types end-to-end. Single deployable unit, no separate
  backend service.
- **Structure** (flat TanStack Start convention):

  ```
  src/
    routes/
      index.tsx              # hello-world landing page (scaffold-only)
      api/health.ts           # example API route (scaffold-only)
    lib/
      example.ts               # example domain-shaped function, DB-backed
    db/
      schema.ts                # one trivial example table (proves Drizzle wiring)
      client.ts                # virtual-import-free Drizzle factory
      client.server.ts         # server-only application DB singleton
    env.ts                     # valibot schema and testable parser
    env.server.ts              # server-only virtual-env adapter with typed output
  scripts/
    seed.ts                    # example seed script for the example table
    setup-agent-plugins.ts     # bun run agents:setup
    update-agent-plugins.ts    # bun run agents:update
    affected-tests.ts          # pre-push hook helper
  e2e/
    api/                       # fetch-based API smoke test (no browser)
    browser/                   # Playwright browser smoke test
  drizzle/                     # generated migrations
  drizzle.config.ts
  .env                         # local copy of .env.example, ignored
  .env.example
  lefthook.yml
  Dockerfile
  ```

  **`Dockerfile`** is a real deliverable, not an afterthought — it's what
  all four compose files and the CI build-check step reference. This spec
  commits to: `oven/bun` base image, non-root user, listens on `PORT`
  (matching `src/env.ts`). It deliberately does **not** commit to a
  migration-on-boot strategy (who runs `db:migrate` in a container, and
  how concurrent replicas under `--scale app=N` avoid racing the same
  migration) — that's real design work, explicitly deferred; see
  [Non-goals](#non-goals).

  Server routes call `src/lib/*` functions, which call `src/db/*`. Nothing
  here encodes real product/domain concepts — `index.tsx`, `health.ts`,
  `example.ts`, and `schema.ts` are scaffold-only proofs that the stack is
  wired correctly end-to-end, meant to be deleted once real feature work
  starts.

## Data layer

- **Drizzle ORM** with the `drizzle-orm/libsql` driver, `drizzle-kit` for
  schema/migrations. `drizzle-kit`'s `dialect: "sqlite"` credentials type
  accepts only `url`, not an auth token — `dbCredentials` in
  `drizzle.config.ts` therefore carries `DATABASE_URL` alone; the
  application factory's separate `createDatabase(url, authToken?)` still
  accepts a token for runtime libSQL/Turso connections (see
  [Deployment topologies](#deployment-topologies-docker-compose) for the
  Turso migration-runner boundary this implies).
- **Local dev**: libSQL's embedded **file mode**, defaulted in `env.ts` to
  `file:./.data/local.db` when unset or empty — no `.env` required to start.
  `.data/` is gitignored. No server process or Docker required. `bun run dev`
  is the dev loop; one `bun run db:migrate` (once, to create `pings`) is a
  prerequisite, not part of the "no setup" claim.
- **Example schema**: a single `pings` table (`id`, `createdAt`) — exists
  purely so the health route and example unit/e2e tests can prove a real
  read/write round-trips through Drizzle + libSQL.
- **Deployment**: Docker-based (see [Deployment topologies](#deployment-topologies-docker-compose)).
  No CI/CD automation triggers deployment — an external service clones the
  repo, builds, and runs it via one of the compose files. This spec ships
  the compose files only; wiring them into that external service is out of
  scope.

## Typed environment (`src/env.ts` and `src/env.server.ts`)

- **[`@vite-env/core`](https://github.com/pyyupsk/vite-env)** (`vite-env`)
  is the env layer: `defineStandardEnv()` with **valibot** schemas (the
  library is Standard-Schema-based, so valibot — already the project's
  choice — plugs in directly, no Zod dependency needed), exposed through
  its typed virtual modules (`virtual:env/server`, `virtual:env/client`)
  plus its Vite plugin for build-time validation and build-time leak
  detection (fails the build if a server value shows up in a client
  chunk — a stronger guarantee than a naming convention).
- **Schema**: everything this scaffold needs is server-only for now —
  `DATABASE_URL` (string, defaults to `file:./.data/local.db` when unset or
  empty, so local dev and CI work with zero configuration),
  `DATABASE_AUTH_TOKEN` (optional; required in practice only for the
  `turso-ha` topology — a missing token there surfaces as a libSQL auth error
  at connection time, not a startup-time env error), and `PORT` (a string or
  number input coerced to a valid port number, defaults to `3000`). No
  `client` block is defined because nothing in this scaffold is exposed to the
  browser.
- **Naming caveat**: `@vite-env/core` hardcodes its client-var prefix to
  `VITE_` (enforced at `defineEnv`/`defineStandardEnv` call time, not
  configurable) — it does **not** support a `PUBLIC_` prefix. Since this
  scaffold has no client vars, this doesn't bite yet; if/when a
  browser-exposed var is added, it must be named `VITE_*`, not
  `PUBLIC_*`, or a different library is needed. Flagging this now instead
  of silently asserting a prefix the library doesn't offer.
- **[`vite-env-only`](https://github.com/pcattori/vite-env-only)** stays
  in the plugin chain alongside `@vite-env/core`, not instead of it: it
  covers the *broader* server-only module boundary (all of `src/db/*`,
  not just the env schema itself), so route → lib → db imports can't drag
  server-only code into the client bundle even where `@vite-env/core`'s
  env-specific leak detection doesn't look.
- Validated once (build-time via the Vite plugin, and at module import via
  the virtual modules); throws a clear error only for a malformed, nonempty
  `DATABASE_URL` (anything not prefixed `file:` or `libsql:`). An empty
  value normalizes to the safe local default.
- No repository-owned code accesses raw `process.env`. `src/env.server.ts`
  alone imports the raw `virtual:env/server` values, parses them through
  `src/env.ts`, and exports the application-level typed `serverEnv` with
  `DATABASE_URL: string`, `DATABASE_AUTH_TOKEN?: string`, and `PORT: number`.
  This adapter avoids `@vite-env/core`'s generated raw declaration, which
  represents Standard-Schema values as strings, becoming the application
  contract. Vite-external scripts use `@vite-env/core`'s standalone `loadEnv()`
  runtime loader instead. The API e2e launcher passes only its generated
  `PORT` through `Bun.spawn`'s explicit environment map.
- `.env.example` is generated via `bunx vite-env generate` from the
  schema, then documents the safe `DATABASE_URL=file:./.data/local.db` and
  `PORT=3000` defaults; it is committed. Scaffold setup copies it to `.env`,
  which is gitignored. A clean checkout still runs without `.env` because
  the schema provides those same defaults.

## Deployment topologies (Docker Compose)

Four compose files ship in the repo, covering a progression from
simplest/single-instance to app-tier high availability. None are wired to
CI/CD — they're consumed by an external clone-build-run service (e.g.
Coolify), which is expected to own routing/load-balancing across each
service's exposed port (no reverse proxy container is included here).

1. **`docker-compose.yml`** — single `app` service, embedded file-mode
   libSQL on a named volume. Simplest option, no HA, matches the local dev
   DB code path exactly (same `file:` URL style, different volume).

2. **`docker-compose.sqld.yml`** — `app` + `db` (sqld server) service. `db`
   is on an internal-only Docker network (no host port mapping) with a
   healthcheck; `app` declares `depends_on: db: condition: service_healthy`.
   Single app instance, decoupled DB.

3. **`docker-compose.sqld-ha.yml`** — same as (2), but `app` is scalable to
   N replicas (via `docker compose up --scale app=N`, no hardcoded replica
   count in the file), all sharing the same internal, healthchecked `db`
   (sqld) service. `app`'s `ports:` entry exposes the container port
   without a fixed host port (e.g. `"PORT"` alone, letting Docker assign
   an ephemeral host port per replica) — a static host port mapping would
   collide the moment `--scale app=2` runs. The external platform is
   expected to discover the assigned ports for its own load-balancing.
   **This is app-tier HA only** — the single `db` (sqld) container is a
   disclosed single point of failure: one `sqld` crash takes down every
   `app` replica. True DB-tier HA is what `docker-compose.turso-ha.yml`
   (below) is for; naming this file `sqld-ha` describes what's scaled
   (the app), not a claim that the database is redundant.

4. **`docker-compose.turso-ha.yml`** — `app` service only, scalable the same
   way as (3), no local `db` container. Each app replica connects to a
   managed **Turso Cloud** database via `DATABASE_URL` +
   `DATABASE_AUTH_TOKEN`, relying on Turso's managed replication for DB-side
   HA.

A short `docs/deployment.md` explains when to use which file — deferred to
implementation.

## Testing

- **Unit tests**: `bun test` scoped to `src/**/*.test.ts` (excludes `e2e/`
  so the two suites never collide — `bun test`'s default glob is
  repo-wide), colocated next to source (e.g. `src/lib/example.test.ts`).
  Run against an ephemeral in-memory/file libSQL DB — same in CI and
  locally, no Docker dependency.
- **E2E tests, two layers** — API-level and browser-level, not one
  instead of the other:
  - **`e2e/api/`**: no browser. `bun:test` directly — after building,
    `Bun.spawn` boots the app (`bun run start`) as a child process on an
    ephemeral port, polls until it accepts connections, then plain
    `fetch()` calls assert status/body on `/api/health`, and the child
    process is killed in an `afterAll`. No browser binary, no download
    step. This layer covers everything that doesn't need a real
    DOM/rendering pipeline.
  - **`e2e/browser/`**: [Playwright](https://playwright.dev)
    (`@playwright/test`) starts the same built app through its `webServer`
    config and checks the hello-world page renders in Chromium.
    `bunx playwright install chromium` is a one-time local setup step;
    Linux CI uses `bunx playwright install --with-deps chromium` to add
    runner OS dependencies too. The init action caches
    `~/.cache/ms-playwright` keyed by OS and `bun.lock`.
- **Self-contained commands**: each `test:e2e:api` and
  `test:e2e:browser` command builds before starting its server, so either
  runs identically from a clean local checkout or CI. `test:e2e` runs both
  sequentially; all three remain separate from `test` (unit), so their
  file globs never collide.

## Execution decisions

- TanStack Start v1 uses its Vite-native plugin, not legacy Vinxi. The
  scaffold scripts are `vite dev`, `vite build`, and
  `bun dist/server/server.js`; the production artifact was built and served
  successfully with this configuration.
- The API e2e test's startup lifecycle is complete when written. Its initial
  execution may pass once earlier tasks provide a working built application;
  do not manufacture a failure solely to satisfy a red-phase checkpoint.
- Clean-checkout verification uses a retained detached worktree through README
  validation. It is intentionally not removed by this implementation; after
  all tasks and reviews complete, the implementation branch is pushed.

## Coverage & badges

- **Every PR and push to `main`**: `checks.yml` runs for all
  `pull_request` events and only `push` events targeting `main`, preventing
  duplicate checks for feature-branch PR updates. It runs
  `bun test src --coverage --coverage-reporter=lcov` (scoped to unit tests
  only), which both prints the summary and writes `coverage/lcov.info`, then
  uploads that report with
  [`codecov/codecov-action@v7`](https://github.com/codecov/codecov-action).
  Codecov supplies the PR report, coverage history, and dynamic README
  badge; coverage is informational, not a threshold merge gate.
- **Private-repo setup**: create the Codecov project and store its upload
  token in the repository's `CODECOV_TOKEN` Actions secret. The action
  receives `files: coverage/lcov.info`, `token: ${{ secrets.CODECOV_TOKEN
  }}`, and `fail_ci_if_error: true`; a configured report must not silently
  disappear. The token is never exposed to application code, browser
  tests, or deployment configuration.
- **No generated coverage is committed**: `coverage/` stays ignored. CI
  uploads it as an ephemeral report; it does not bot-commit JSON, update
  README text, or need `contents: write`.
- **README badges**: coverage (Codecov's project badge), CI status
  (GitHub's native workflow badge,
  `.github/workflows/checks.yml/badge.svg`), license (static MIT badge),
  and release version
  (`https://img.shields.io/github/v/release/<owner>/<repo>`, powered by
  release-please's tags — zero extra work, no CI step needed for these
  three).

## Agent tooling setup (harness-agnostic, standardized)

Goal: every contributor gets identical agent conventions and skill packs
regardless of which coding agent/harness they use, without depending on
anything already installed globally on their machine. Tiers 1–3 achieve
this by construction (plain committed files, no install step, no version
drift possible). Tier 4 (superpowers) genuinely can't be repo-vendored —
it ships through 11 different official harness integrations (Claude
Code, Antigravity, Codex App/CLI, Cursor, Factory Droid, Gemini CLI,
GitHub Copilot CLI, Kimi Code, OpenCode, Pi — confirmed from its own
README), and **most of those installs are interactive, not bash-scriptable**:
Claude Code, Codex, OpenCode, and Cursor all require an in-session slash
command or a "tell the agent to fetch instructions" prompt, with no CLI
equivalent documented. Only Gemini CLI, GitHub Copilot CLI, and Factory
Droid expose a genuine non-interactive install command. **OMP is the
recommended harness for this repo** because it's the one place in this
ecosystem where the install is fully scriptable end-to-end: OMP isn't on
superpowers' official harness list, but OMP's marketplace system is
documented as compatible with the Claude Code plugin registry format,
and superpowers ships exactly that catalog
(`.claude-plugin/marketplace.json`) — so `omp plugin marketplace add
obra/superpowers-marketplace` + `omp plugin install --scope project
superpowers@superpowers-marketplace` are real, confirmed-non-interactive
CLI commands, expected to work by construction even though the
combination isn't officially tested upstream.

1. **`AGENTS.md`** (repo root, canonical) — toolchain commands, conventions
   (Conventional Commits, oxlint/oxfmt, lefthook), and an embedded
   [**ponytail**](https://github.com/DietrichGebert/ponytail) ruleset in its
   native zero-install form: ponytail's most portable distribution path
   *is* a root `AGENTS.md` block, read automatically by Codex/VSCode, Amp,
   Jules, CodeWhale, Swival, and GitHub Copilot CLI (fallback mode) with
   no plugin step at all. **Junie is the documented exception** —
   ponytail's own README states Junie requires manually pointing at the
   file (Settings → Tools → Junie → Guidelines Path), "not automatic
   yet"; a Junie user on this repo must do that one manual step.
2. **`CLAUDE.md`** — symlink → `AGENTS.md` (`ln -s AGENTS.md CLAUDE.md`), so
   Claude Code reads the identical content with zero duplication.
3. **[`mattpocock/skills`](https://github.com/mattpocock/skills)** —
   vendored for real via its own multi-agent installer
   (`bunx skills@latest add mattpocock/skills`, run once during
   scaffolding). Select exactly the OpenCode target and these core engineering
   skills: `setup-matt-pocock-skills`, `tdd`, `diagnosing-bugs`,
   `codebase-design`, and `code-review`. The installer determines the
   OpenCode target directory; commit every nonempty generated skill file
   exactly as generated. This scoped selection supplies engineering discipline
   without duplicating superpowers' planning and agent-orchestration flows.
   `AGENTS.md` remains the portable instruction source for other harnesses.
4. **[`superpowers`](https://github.com/obra/superpowers)** — can't be
   vendored as static files (it's dynamic: hooks, subagent orchestration,
   slash commands). `scripts/setup-agent-plugins.ts` (run by `bun run
   agents:setup`) is a **helper, not a guaranteed silent installer**,
   split along the interactive/scriptable line above: it runs the real
   install command where one exists, and prints the exact
   command/prompt for the contributor to run themselves where it
   doesn't. Pins the *source* (same marketplace/repo), not an exact
   version — see [Non-goals](#non-goals) for why that's unpinnable.
5. No other per-agent shim files (`.cursor/rules`, `.github/copilot-instructions.md`,
  etc.) are added — out of requested scope, and `AGENTS.md`'s native
  adoption already covers most harnesses without them.
6. `README.md` gets a short "Agent tooling" section pointing at
  `docs/agent-tooling.md` for the full picture, plus the `bun run
  agents:setup` quick-start.

### Keeping agent tooling current (`bun run agents:update`)

`scripts/update-agent-plugins.ts` (run by `bun run agents:update`)
handles the update path each tier's install mechanism already exposes —
it does not invent new update machinery:

- **`mattpocock/skills`**: `bunx skills update`, its own official update
  command (re-syncs the vendored skill files from upstream, into whatever
  directory the original `bunx skills@latest add` selected), then the
  diff is committed like any other change.
- **`superpowers`**: same split as the install side — `omp plugin
  upgrade superpowers@superpowers-marketplace` runs for real on OMP,
  Gemini CLI, GitHub Copilot CLI, and Factory Droid; for Claude Code,
  Codex, OpenCode, and Cursor, `agents:update` prints the harness's
  update command/prompt instead of running it.
- **ponytail's embedded `AGENTS.md` block**: no upstream tool exists to
  diff/sync this (it's manually copied text, not an installed package),
  so `agents:update` prints a reminder to manually re-check ponytail's
  README ruleset against what's embedded, rather than silently
  auto-rewriting `AGENTS.md`.

This is on-demand and manual — a contributor runs it when they want
updates, the same trust model as `agents:setup`. No CI cron or
auto-update job pulls upstream changes automatically; that would risk
silently landing breaking upstream changes in a PoC with nobody watching.

## Git hooks (lefthook) + commit convention

- **`lefthook.yml`**:
  - `pre-commit` (`parallel: true`): `oxlint --fix` and `oxfmt` (write
    mode) against staged files only (`{staged_files}`), `stage_fixed:
    true` re-stages the fixed output.
  - `commit-msg`: `commitlint --edit {1}` against the commit message,
    Conventional Commits config.
  - `pre-push`: `bun scripts/affected-tests.ts {push_files}` — maps files
    being pushed (lefthook's `{push_files}`, diffed against the remote
    tracking branch) to their colocated `*.test.ts` file (or the file
    itself, if it's already a test), then runs `bun test` on just that
    matched set. No-op when nothing test-related changed. Keeps `build`,
    the full suite, and the Docker build check CI-only (no duplication)
    while still catching relevant unit-test breakage before it leaves the
    machine.
- **`commitlint.config.ts`**: `export default { extends: ["@commitlint/config-conventional"] }`
  — TS-native, matching the rest of the toolchain's config-as-TS
  convention.

## CI (GitHub Actions)

- **`.github/actions/init/action.yml`** — shared composite action:
  `moonrepo/setup-toolchain` (auto-installs whatever `.prototools` pins,
  cached by `hashFiles('.prototools')`) → cache `~/.bun/install/cache`
  keyed on the lockfile hash → cache `~/.cache/ms-playwright` keyed on OS
  and the lockfile hash → `bun install --frozen-lockfile` (CI must fail
  on lockfile drift, not silently accept it). Installs no Node toolchain
  itself — see [Runtime & tooling baseline](#runtime--tooling-baseline)
  for the Node-via-Actions caveat this doesn't change.
- **`.github/workflows/checks.yml`** — triggers on `pull_request` (any
  branch) and `push` to any branch. Single job, first step
  `uses: ./.github/actions/init`, then:
  1. `bun run lint` (check mode, not write)
  2. `bun run format` (check mode, not write)
  3. `bun run typecheck`
  4. `bun test src --coverage --coverage-reporter=lcov` (unit tests only —
     bare `bun test` also discovers `e2e/browser/*.spec.ts` and
     `e2e/api/*.test.ts`, which need Playwright/a built server and belong
     to step 7, not this coverage step)
  5. `codecov/codecov-action@v7` with `files: coverage/lcov.info`,
     `token: ${{ secrets.CODECOV_TOKEN }}`, and `fail_ci_if_error: true`
  6. `bunx playwright install --with-deps chromium`
  7. `bun run test:e2e` (both API and browser layers — see
     [Testing](#testing))
  8. `bun run build`
  9. `docker build -f Dockerfile .` (build-only, no push/registry) — catches
     Dockerfile breakage without any deploy step.
- **`.github/workflows/pr-title.yml`** — job grants `pull-requests: read`
  (required by `amannn/action-semantic-pull-request` to read the PR) and
  validates the PR title itself is a
  Conventional Commit (`amannn/action-semantic-pull-request`), lowercase
  subject, no scope required. Complements `commit-msg` linting, which only
  covers individual commits, not the squash-merge title GitHub uses by
  default.
- **No deploy workflow.** Deployment is handled entirely outside GitHub
  Actions by the external clone-build-run service.

## Release automation

- **release-please** (`release-please-config.json` +
  `.release-please-manifest.json` + `.github/workflows/release.yml`) —
  on every push to `main`, opens/updates a "Release PR" that bumps the
  version and rewrites `CHANGELOG.md` from Conventional Commit history
  since the last release; merging that PR cuts the release and tags it.
  Single-package config (`release-type: node`, path `.`) — no monorepo
  packages here. Directly consumes the Conventional Commits already
  enforced by `commitlint` and `pr-title.yml`, so there's no extra
  authoring convention to learn.
- release-please's workflow needs `permissions: contents: write` and
  `pull-requests: write` on its job — the default `GITHUB_TOKEN` is
  read-only, and without this the workflow fails outright, so this is a
  required part of the workflow file, not an optional hardening step.
- **Release PRs and required checks**: a release-please PR is opened with
  the default `GITHUB_TOKEN`, which does not trigger other `pull_request`-
  triggered workflows on GitHub — so `checks.yml` and `pr-title.yml` will
  **not** run on the Release PR itself unless a PAT or GitHub App token is
  used instead. If branch protection requires those checks, the Release
  PR becomes unmergeable without one; if it doesn't, releases ship without
  CI verification. This repo does not provision a PAT/app token — flagging
  the tradeoff rather than picking silently; the choice (accept unverified
  release PRs, or add a token) is deferred to implementation.

## Documentation

Required doc deliverables for this scaffold: `README.md` (the final,
self-contained onboarding guide and the badges from
[Coverage & badges](#coverage--badges)), `docs/deployment.md` (which
compose file to use when — see
[Deployment topologies](#deployment-topologies-docker-compose)),
`docs/agent-tooling.md` (standalone doc holding the full
[Agent tooling setup](#agent-tooling-setup-harness-agnostic-standardized)
content — `AGENTS.md`'s "Recommended harness" note links to *this* doc,
not to this design spec, since the spec is a point-in-time design record
and `docs/agent-tooling.md` is the living reference contributors actually
need day to day), `AGENTS.md` (canonical agent/contributor instructions),
`CHANGELOG.md` (generated by release-please, not hand-authored), and
`docs/specs/*` (design specs for future feature work, this document's own
home).

**README onboarding**: after the scaffold passes clean-checkout verification,
`README.md` is updated as the final onboarding step. It explains the current
scaffold concept and its explicit boundary (hello-world page plus
DB-backed health check, not checkout product behavior); lists Bun, TanStack
Start/React, Drizzle/libSQL, Valibot, Vite, oxlint/oxfmt, Playwright, Docker
Compose, and GitHub Actions; and documents prerequisites. It supplies the
exact local sequence `bun install`, `cp .env.example .env`, `bun run
db:migrate`, and `bun run dev`, while stating that `.env` is optional because
safe defaults exist. It also documents development/database commands,
unit/API/browser e2e and quality commands, deployment-topology and
agent-tooling links, agent setup/update commands, CI/Codecov/release
expectations, and links to the current spec and implementation plan.

**Docs-first, not docs-eventually**: for any change that needs one of
these documents, the doc is written *before or alongside* the code it
describes — the same spec-before-plan-before-code discipline this very
document was produced under — not deferred to "a follow-up." A PR that
changes behavior a doc describes updates that doc in the **same PR**;
stale docs are treated as a bug, not cleanup debt. This policy is
recorded in `AGENTS.md` itself (project-scope agent instructions), so it
persists across sessions and contributors rather than living only in this
spec.

## Development workflow

- **Spec-driven**: every non-trivial change starts as a design spec under
  `docs/specs/YYYY-MM-DD-<topic>-design.md`, then an implementation plan
  under `docs/plans/YYYY-MM-DD-<topic>-plan.md` (mirroring the specs
  convention — flat, not nested under `docs/superpowers/plans/`). Same
  committed-artifact, kept-current discipline as
  [Documentation](#documentation), applied to the process that produces
  the code, not just the docs describing the result.
- **Test-driven**: within that process, tests are drafted before the
  implementation they cover — red, then green, then refactor. This
  applies to unit, API-e2e, and browser-e2e work alike: a failing test
  exists first, code changes make it pass second, not the reverse.
- **KISS, YAGNI, DRY — always**: the simplest thing that satisfies the
  spec wins; nothing is built speculatively ahead of an actual need;
  duplication gets factored out, not copy-pasted forward. These aren't
  aspirational — they're a filter applied to every design decision in
  this document and every one that follows it.
- **Less is better**: less text, less code, less thinking-out-loud than
  strictly needed is the default bias — for specs, for implementation,
  and for agent-to-agent interaction. Prefer short orchestration
  exchanges that dispatch focused subagents over long inline sessions
  doing everything in one thread.

## Acceptance criteria

The scaffold is complete when all of the following hold:

- `bun install` succeeds from a clean checkout.
- Every dependency in `package.json` (and the toolchain versions in
  `.prototools`) is pinned to its latest stable release as of scaffold
  time — no artificially held-back versions. This is a point-in-time
  criterion for the initial scaffold, not an ongoing auto-update
  guarantee; keeping deps current afterward is normal maintenance, not
  something this spec automates.
- `bun run dev` serves the hello-world page at `/` and a 200 response with
  the expected JSON shape at `/api/health`, using the default local file-mode
  libSQL DB at `.data/local.db` — after the one-time `bun run db:migrate`.
- `.env.example` documents the safe local `DATABASE_URL` and `PORT`
  defaults; `.env` is a gitignored copy and the same commands also pass
  after `.env` is deleted.
- `bun run lint`, `bun run format`, `bun run typecheck`, `bun run test`,
  and `bun run build` each exit 0 on the untouched scaffold.
- The example unit test (`src/lib/example.test.ts`) and both example e2e
  tests (`e2e/api/`, `e2e/browser/`) pass.
- `git commit` with a non-conventional message is rejected by the
  `commit-msg` hook; a badly formatted/linted staged file is auto-fixed by
  the `pre-commit` hook before the commit lands; pushing a change whose
  colocated test is broken is rejected by the `pre-push` hook, while
  pushing a change with no colocated test file is not blocked.
- `docker-compose.yml` and `docker-compose.sqld.yml` start successfully
  (`docker compose -f <file> up`) and the app responds on its exposed
  port. `docker-compose.sqld-ha.yml` additionally works with
  `--scale app=2` — its `app` service exposes the container port without
  a fixed host port mapping specifically so scaling doesn't collide.
  `docker-compose.turso-ha.yml` is validated with `docker compose config`
  (structurally valid) only — a live `up` needs real Turso Cloud
  credentials this repo doesn't provision (see
  [Non-goals](#non-goals)), so it's out of scope for this criterion.
- `CLAUDE.md` is a working symlink whose resolved content is byte-identical
  to `AGENTS.md`.
- `README.md` is a self-contained new-contributor onboarding guide: it
  explains the scaffold's present concept and non-product boundary; lists the
  tech stack and prerequisites; documents installation,
  `cp .env.example .env`, migration, local development, database,
  quality, unit/API/browser-e2e, deployment, agent-tooling, CI/release, and
  project-documentation instructions; and contains the Codecov, CI, license,
  and release badges. `docs/deployment.md` explains the intended use of each
  compose topology.
- `docs/agent-tooling.md` exists with the full Agent tooling setup
  content, and `AGENTS.md`'s "Recommended harness" note links to it (not
  to this design spec).
- `src/env.ts` throws a clear, immediate error only when `DATABASE_URL` is
  set to a malformed nonempty value; it does not throw when unset or empty
  (both default to `file:./.data/local.db`) or when set to a valid value.
- The mattpocock/skills installer's output directory (confirmed during
  implementation, not asserted here) contains real vendored files, not
  empty/placeholder.
- `bun run agents:setup` completes without error on a machine with none of
  the three agent packs pre-installed. On OMP, Gemini CLI, GitHub Copilot
  CLI, or Factory Droid it runs the real install command and superpowers
  is observably installed afterward (e.g. `omp plugin list` shows it).
  On Claude Code, Codex, OpenCode, or Cursor it prints the correct
  harness-specific command/prompt and exits 0 without pretending to have
  installed anything itself.
- `.github/workflows/checks.yml` passes on a fresh PR that touches nothing
  (proves the pipeline itself is green on the scaffold); a PR whose title
  isn't a Conventional Commit is rejected by `pr-title.yml`.
- With `CODECOV_TOKEN` configured as an Actions secret, `checks.yml`
  uploads `coverage/lcov.info` to Codecov and its README badge resolves;
  no coverage artifact or bot commit appears in this repository.
- Every repository-owned executable under `scripts/` is TypeScript and is
  run by Bun; no `.sh` script remains.
- Merging a Conventional-Commit-titled PR to `main` results in
  release-please opening/updating a Release PR with a correct
  `CHANGELOG.md` entry.

## Non-goals

- Any product/domain schema, business logic, or real UI beyond the
  hello-world/health-check scaffold — `schema.ts`, `index.tsx`, `health.ts`,
  and `example.ts` are intentionally throwaway proofs, not a starting
  domain model.
- Wiring the compose files into the external deploy service (e.g. a Coolify
  project) — out of scope; this repo only ships the compose files
  themselves.
- Any GitHub Actions deploy automation (push-to-registry, SSH deploy, etc.).
- Extra per-agent shim files beyond `AGENTS.md`/`CLAUDE.md` (no
  `.cursor/rules`, `.github/copilot-instructions.md`, `.windsurf/rules`,
  etc.) — `AGENTS.md`'s native multi-harness adoption is treated as
  sufficient coverage.
- Hand-authoring the internals of the mattpocock/skills or superpowers
  packs — both are installed via their own official tooling, not written
  by us; this repo only pins *which marketplace/source* they come from
  and *how* they're installed.
- A reverse proxy / load balancer container — the external deploy platform owns that.
- Turso Cloud account provisioning — the `turso-ha` compose file expects
  `DATABASE_URL`/`DATABASE_AUTH_TOKEN` to already exist as secrets; creating
  the actual Turso Cloud database is an operational step outside this repo.
- Pinning superpowers to an exact version/SHA — confirmed not achievable:
  every marketplace install command (`name@marketplace`, on Claude Code,
  OMP, and Codex alike) resolves to whatever the marketplace catalog
  currently publishes; version/SHA pinning exists only inside the
  catalog entry itself, which `obra/superpowers` controls, not this repo.
  Forking/mirroring a private marketplace to force a pin is out of scope.
  `agents:setup` therefore pins the *source* (same marketplace, same
  plugin name) and accepts that as the standardization contract.
