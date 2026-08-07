# Boilerplate Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a reproducible TanStack Start + Drizzle/libSQL scaffold whose local app, test layers, containers, hooks, CI, releases, documentation, and agent tooling work end-to-end.

**Architecture:** One TanStack Start deployable serves the hello-world page and health endpoint. Server routes call a small library which uses a Drizzle/libSQL client; `@vite-env/core` owns typed server configuration via a valibot schema (`src/env.ts`), resolved at runtime through its standalone `loadEnv()` loader (`src/env.server.ts`) rather than its build-time-frozen virtual module, so Docker deployments honor a runtime `DATABASE_URL`; `vite-env-only` keeps database modules out of browser chunks. Tooling is Bun-first: local scripts, hooks, test layers, containers, and CI each invoke one explicit command.

**Tech Stack:** Bun, TypeScript, TanStack Start/React/Vite, Tailwind CSS, TanStack Devtools, TanStack Query, shadcn/ui, PostHog, Nitro, Drizzle ORM + libSQL, Valibot, `@vite-env/core`, `vite-env-only`, yargs, oxlint/oxfmt, lefthook, commitlint, Playwright, Docker Compose, GitHub Actions, release-please.

## Global Constraints

- Use Bun as app runtime and package manager; repo-owned executable scripts are TypeScript run by Bun; use `bunx`, never `npx`.
- Every `scripts/*.ts` entrypoint parses its CLI arguments with `yargs` (never raw `process.argv`/`Bun.argv` string matching); `bun run typecheck`'s repo-wide `tsc --noEmit` already covers `scripts/` since `tsconfig.json`'s `include` is `**/*.ts`, not `src/**` alone.
- Pin current stable dependency and `.prototools` tool versions at scaffold execution time; commit generated `bun.lock`.
- Keep code 2-space indented, UTF-8/LF, trailing whitespace trimmed, and final-newline terminated.
- Do not add product/domain behavior, schema, UI, reverse proxy, deployment workflow, migration-on-boot logic, or per-agent shim files.
- Use `DATABASE_URL=file:./.data/local.db` and `PORT=3000` defaults. Treat an
  unset or empty database URL as that default; only malformed nonempty URLs
  fail validation. Valid prefixes are `file:` and `libsql:`. Keep `.data/`
  gitignored.
- `process.env` is never read directly by repository-owned code. `src/env.server.ts` (the application server), `drizzle.config.ts` (the migration CLI), and each `scripts/*.ts`'s own `main()` all resolve typed env through `@vite-env/core/load`'s standalone `loadEnv(config)` — the same schema the Vite plugin validates, but read fresh per-process instead of the plugin's build-time-frozen `virtual:env/server`. The API e2e launcher supplies only its generated `PORT` in an explicit `Bun.spawn` environment map.
- Unit tests are colocated under `src/**/*.test.ts` and
  `scripts/**/*.test.ts`, run by `bun test src scripts`; API and browser e2e
  remain under separate `e2e/api/` and `e2e/browser/` commands.
- Tests for new observable behavior precede implementation: red, green, then
  minimal refactor. Bootstrap/configuration-only work uses relevant executable
  command checks rather than a manufactured red test. Commit each independently
  testable task with Conventional Commit syntax and an explicit scope.
- `README.md` currently says not to change it without user permission. Before Task 12 replaces it, obtain that permission or stop Task 12; all other tasks remain executable.
- Plans live at `docs/plans/YYYY-MM-DD-<topic>-plan.md`; specs live at `docs/specs/YYYY-MM-DD-<topic>-design.md`.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `package.json`, `bun.lock`, `.prototools` | Bun commands and pinned tool/dependency graph. |
| `vite.config.ts`, `tsconfig.json`, `src/router.tsx`, `src/routeTree.gen.ts` | TanStack Start build and typed file-route integration. |
| `src/routes/__root.tsx`, `src/styles.css` | Retained TanStack Start template defaults (Tailwind CSS entry stylesheet, TanStack Devtools panel) — not deliberately built product styling/observability. |
| `components.json`, `src/lib/utils.ts`, `src/integrations/tanstack-query/*`, `src/integrations/posthog/provider.tsx` | Selected `@tanstack/cli` add-on scaffolding (TanStack Query, shadcn/ui, PostHog) — retained wiring, no product UI/analytics built on top. |
| `src/env.ts` | Standard-schema server environment definition and Vite plugin registration input. |
| `src/routes/index.tsx`, `src/routes/api/health.ts` | Hello-world page and DB-connectivity liveness check (no `pings` write). |
| `src/db/schema.ts`, `src/db/client.ts`, `src/lib/example.ts` | `pings` persistence boundary (`recordPing`) and health-facing operation (`checkHealth`). |
| `drizzle.config.ts`, `drizzle/*`, `scripts/seed.ts` | Generated migration configuration and repeatable sample data. |
| `e2e/api/health.test.ts`, `e2e/browser/home.spec.ts`, `playwright.config.ts` | Isolated HTTP and Chromium smoke layers. |
| `Dockerfile`, `docker-compose*.yml` | Two documented deployment topologies. |
| `scripts/affected-tests.ts`, `scripts/setup-agent-plugins.ts`, `scripts/update-agent-plugins.ts` | Bun hook helper and harness-aware agent operations. |
| `lefthook.yml`, `commitlint.config.ts` | Local source, commit-message, and relevant-test gates. |
| `.github/actions/init/action.yml`, `.github/workflows/*.yml` | Reusable CI bootstrap, checks, PR-title enforcement, releases. |
| `README.md`, `docs/deployment.md`, `docs/agent-tooling.md`, `AGENTS.md`, `CLAUDE.md` | Contributor, topology, agent, and harness documentation. |

### Task 1: Bootstrap runtime and repository hygiene

**Files:**
- Create: `package.json`, `bun.lock`, `.prototools`, `tsconfig.json`, `vite.config.ts`, `src/router.tsx`, `src/routeTree.gen.ts`, `src/routes/__root.tsx`, `src/styles.css`, `components.json`, `src/lib/utils.ts`, `src/integrations/tanstack-query/root-provider.tsx`, `src/integrations/tanstack-query/devtools.tsx`, `src/integrations/posthog/provider.tsx`
- Create: `.editorconfig`, `.oxlintrc.json`, `.oxfmtrc.jsonc`, `.gitignore`, `.dockerignore`, `.vscode/settings.json`, `.vscode/extensions.json`, `.github/PULL_REQUEST_TEMPLATE.md`

**Interfaces:**
- Consumes: no project runtime code.
- Produces: commands `dev`, `build`, `start`, `lint`, `lint:fix`, `format`, `format:fix`, `typecheck`, `test`, `test:e2e`, `test:e2e:api`, `test:e2e:browser`, `db:generate`, `db:migrate`, `db:seed`, `agents:setup`, and `agents:update`.

- [ ] **Step 1: Initialize generated TanStack Start files and lockfile**

Run from a clean branch root:

```bash
bunx @tanstack/cli@latest create . --template react-start --package-manager bun --add-ons tanstack-query,shadcn,posthog,nitro -y
bun install
```

Keep the generated TypeScript/Vite entry points required by the selected current TanStack Start template — this includes the `react-start` template's current defaults, Tailwind CSS (`src/styles.css`, `@tailwindcss/vite`) and a TanStack Devtools panel wired into `src/routes/__root.tsx` (`@tanstack/react-devtools`, `@tanstack/devtools-vite`, `@tanstack/react-router-devtools`), plus the four selected add-ons' own generated scaffolding: TanStack Query (`src/integrations/tanstack-query/*`, router context wiring in `src/router.tsx`), shadcn/ui (`components.json`, `src/lib/utils.ts`), PostHog (`src/integrations/posthog/provider.tsx`), and Nitro (`nitro/vite` plugin in `vite.config.ts`, changing the production entry to `.output/server/index.mjs`, a self-contained bundle with its own vendored native `node_modules`). None of this is deliberately built product styling, analytics, or a query layer — all of it is retained as-is. `@tanstack/cli` supersedes the older `create-tanstack-app` package name. Remove template product examples only after Tasks 2–5 replace them with the scaffold routes and tests.

- [ ] **Step 2: Install current stable runtime and tool dependencies**

```bash
bun add @tanstack/react-router @tanstack/react-start @tanstack/router-plugin @libsql/client drizzle-orm valibot @vite-env/core vite-env-only yargs
bun add -d @types/bun @types/react @types/react-dom @types/yargs typescript vite drizzle-kit oxlint oxfmt lefthook @commitlint/cli @commitlint/config-conventional @playwright/test
bun install
```

Tailwind CSS, TanStack Devtools, and `@tanstack/router-cli` arrive pre-installed from Step 1's template and are not part of this explicit install list.

Record exact resolved versions in `package.json` and `bun.lock`; do not use version ranges wider than the package manager’s exact resolved version form.
`yargs`'s installed package exports no Node-facing `types` condition (only a `browser.d.ts`); `@types/yargs` supplies the declarations `tsc --noEmit` needs.

- [ ] **Step 3: Write the baseline configuration**

Create `.prototools` with Bun’s current stable version discovered during Step 2, then add these command contracts to `package.json` (retain required TanStack scripts):

```json
{
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "start": "bun .output/server/index.mjs",
    "lint": "oxlint .",
    "lint:fix": "oxlint --fix .",
    "format": "oxfmt --check .",
    "format:fix": "oxfmt --write .",
    "typecheck": "tsc --noEmit",
    "test": "bun test src scripts",
    "test:e2e:api": "bun run db:migrate && bun run build && bun test e2e/api",
    "test:e2e:browser": "bun run build && playwright test",
    "test:e2e": "bun run test:e2e:api && bun run test:e2e:browser",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:seed": "bun scripts/seed.ts",
    "agents:setup": "bun scripts/setup-agent-plugins.ts",
    "agents:update": "bun scripts/update-agent-plugins.ts"
  }
}
```

Set `.editorconfig` to `charset = utf-8`, `end_of_line = lf`, `indent_style = space`, `indent_size = 2`, `trim_trailing_whitespace = true`, and `insert_final_newline = true`. Add `.data/` to `.gitignore`. Configure oxlint’s recommended TypeScript/React categories plus `curly` and function-style-as-expression, configure oxfmt with 100-column width, semicolons, and double quotes, and ignore the required Docker context exclusions in `.dockerignore`.

- [ ] **Step 4: Run baseline checks**

Run:

```bash
bun run format
bun run lint
bun run typecheck
bun run build
```

Expected: every command exits 0. This bootstrap/configuration task introduces
no observable application behavior, so it has no manufactured red test.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock .prototools tsconfig.json vite.config.ts src components.json .editorconfig .oxlintrc.json .oxfmtrc.jsonc .gitignore .dockerignore .vscode .github/PULL_REQUEST_TEMPLATE.md
git commit -m "chore(scaffold): bootstrap Bun TanStack Start tooling"
```

### Task 2: Typed environment and application shell

**Files:**
- Create: `src/env.ts`, `src/env.server.ts`, `src/env.test.ts`, `src/routes/index.tsx`, `src/routes/api/health.ts`
- Modify: `vite.config.ts`, `src/router.tsx`, `src/routeTree.gen.ts`, `.env.example`, `src/integrations/posthog/provider.tsx`

**Interfaces:**
- Consumes: Vite config from Task 1.
- Produces: `src/env.server.ts` resolves application-level `serverEnv` with `DATABASE_URL: string` and `PORT: number` via `@vite-env/core/load`'s `loadEnv()`; `GET /` and `GET /api/health` route contracts.

- [ ] **Step 1: Write failing environment tests**

```ts
import { expect, test } from "bun:test";
import { parseServerEnv } from "./env";

test("defaults DATABASE_URL when unset or empty", () => {
  expect(parseServerEnv({}).DATABASE_URL).toBe("file:./.data/local.db");
  expect(parseServerEnv({ DATABASE_URL: "" }).DATABASE_URL).toBe("file:./.data/local.db");
});

test("rejects malformed DATABASE_URL", () => {
  expect(() => parseServerEnv({ DATABASE_URL: "https://db" })).toThrow("DATABASE_URL");
});
```

- [ ] **Step 2: Run tests to verify red**

Run: `bun test src/env.test.ts`  
Expected: FAIL because `src/env.ts` and `parseServerEnv` do not exist.

- [ ] **Step 3: Implement schema, loadEnv() adapter, and routes**

Expose the testable parser and register the schema with the Vite plugin. Normalize
an empty `DATABASE_URL` to `file:./.data/local.db` before parsing, then use this
schema:

```ts
// src/env.ts
import { defineStandardEnv } from "@vite-env/core";
import * as v from "valibot";

const serverEnvFields = {
  DATABASE_URL: v.pipe(
    v.optional(v.string(), "file:./.data/local.db"),
    v.transform((value) => value || "file:./.data/local.db"),
    v.regex(/^(file:|libsql:)/, "DATABASE_URL must start with file: or libsql:"),
  ),
  PORT: portSchema,
};

const clientEnvFields = {
  VITE_POSTHOG_KEY: v.optional(v.string()),
  VITE_POSTHOG_HOST: v.optional(v.string()),
};

export const serverEnvSchema = v.object(serverEnvFields);
export const parseServerEnv = (input: unknown) => v.parse(serverEnvSchema, input);
export default defineStandardEnv({ server: serverEnvFields, client: clientEnvFields });
```

`portSchema` accepts a string or number input, coerces it to a number, then applies
the integer and `1..65535` validation with a default of `3000`.
`@vite-env/core` is this scaffold's single source of truth for every env
var — hardcoding a `VITE_` prefix for client keys with no override, which
this scaffold's own Vite setup already defaults to, so `VITE_POSTHOG_KEY`/
`VITE_POSTHOG_HOST` register directly with no prefix workaround needed.
`src/env.server.ts` is the only application adapter resolving server env,
and it uses the library's standalone runtime loader instead of importing
the Vite-plugin-generated `virtual:env/server` (which resolves to a
frozen build-time literal — see
[the design spec](../specs/2026-08-06-boilerplate-design.md#typed-environment-srcenvts-and-srcenvserverts)
for why that breaks Docker's per-container `DATABASE_URL`):

```ts
// src/env.server.ts
import { loadEnv } from "@vite-env/core/load";
import config from "./env";

export const serverEnv = (await loadEnv(config)).server;
```

This resolves fresh at module-import time in whatever process is actually
running (the Vite dev server, the built Nitro server, a test run) —
`loadEnv()` reads `.env` files merged with live `process.env`
(`process.env` wins) at call time, so a local `.env` file works with zero
extra code, and a container's `-e DATABASE_URL=...`/compose
`environment:` override is honored because it was never baked into a
build artifact. Only server-boundary code needs this runtime-freshness
fix — client-shipped values are always inlined at build time regardless,
`virtual:env/client` included. Keep `src/env.ts` free of `loadEnv()`/
`process.env` access so parser tests remain runnable under `bun test`
with arbitrary fixture objects. Configure Vite's server port as `3000`.

In `vite.config.ts`, register TanStack Start, `vite-env-only`'s
`envOnlyMacros()`, and `ViteEnv({ configFile: "./src/env.ts" })` from
`@vite-env/core` (build-time schema validation plus leak detection across
the full server+client schema); retain template-required plugins
(Tailwind, devtools, Nitro). Generate `.env.example` with
`bunx vite-env generate` from the full schema in one pass (documents
`DATABASE_URL=file:./.data/local.db`, `PORT=3000`, and commented-out
`VITE_POSTHOG_KEY=`/`VITE_POSTHOG_HOST=` — nothing added by hand).
Rewrite `src/integrations/posthog/provider.tsx` (the one generated add-on
file this scaffold deliberately edits) to import
`{ env } from "virtual:env/client"` instead of reading raw
`import.meta.env.VITE_POSTHOG_KEY` directly, so `@vite-env/core` is the
only env access point in the codebase. Implement `index.tsx` to render
exact visible text `Self-service web checkout` and `health.ts` as a
placeholder `GET` handler returning a fixed `200` response; Task 4
replaces its body with the real DB-connectivity check.

- [ ] **Step 4: Regenerate route tree and run green checks**

Run:

```bash
bun run dev
# in a second terminal after readiness
curl -i http://localhost:3000/
curl -i http://localhost:3000/api/health
bun test src/env.test.ts
```

Expected: home returns 200 with the heading; health also returns its fixed placeholder 200 (its real DB-connectivity body arrives in Task 4), while both environment tests pass. Stop the dev server after inspection.

- [ ] **Step 5: Commit**

```bash
git add src/env.ts src/env.test.ts src/routes src/router.tsx src/routeTree.gen.ts vite.config.ts .env.example src/integrations/posthog/provider.tsx
git commit -m "feat(app): add typed environment and scaffold routes"
```

### Task 3: Drizzle migration foundation

**Files:**
- Create: `src/db/schema.ts`, `src/db/client.ts`, `src/db/client.server.ts`, `src/db/client.test.ts`, `drizzle.config.ts`
- Create: generated `drizzle/*`
- Modify: `package.json`

**Interfaces:**
- Consumes: typed `serverEnv` from `src/env.server.ts` and typed external-script environment loading.
- Produces: virtual-import-free `createDatabase(url: string)`, the application `db` singleton, the `pings` table, and working `db:generate`/`db:migrate` commands.
- [ ] **Step 1: Write a failing database-client test**

```ts
import { expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { createDatabase } from "./client";

test("creates a usable in-memory libSQL database", async () => {
  const db = createDatabase("file::memory:");
  await expect(db.run(sql`SELECT 1`)).resolves.toBeDefined();
});
```

- [ ] **Step 2: Run the test to verify red**

Run: `bun test src/db/client.test.ts`
Expected: FAIL because `createDatabase` does not exist.

- [ ] **Step 3: Implement schema, client, and migration configuration**

Define the only scaffold table:

```ts
// src/db/schema.ts
import { integer, sqliteTable } from "drizzle-orm/sqlite-core";
export const pings = sqliteTable("pings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
```

`src/db/client.ts` exports `createDatabase(url)`, which creates a libSQL client and returns Drizzle configured with `pings`; it contains no environment import so Bun tests and scripts can import it. `src/db/client.server.ts` is the sole application database boundary: it imports typed `serverEnv` from `src/env.server.ts` and exports the application `db` singleton created by the factory. Create `drizzle.config.ts` using `@vite-env/core/load`'s `loadEnv(config)` to resolve the same typed database URL outside Vite, then configure `drizzle-kit` with that URL.

- [ ] **Step 4: Generate the migration and run green checks**

Run:

```bash
bun test src/db/client.test.ts
bun run db:generate
rm -f .data/local.db
bun run db:migrate
```

Expected: client test passes; generated migration creates `pings` in ignored `.data/local.db`.

- [ ] **Step 5: Commit**

```bash
git add src/db drizzle.config.ts drizzle package.json
git commit -m "feat(data): add libSQL migration foundation"
```

### Task 4: Drizzle persistence boundary, health behavior, and seed

**Files:**
- Create: `src/lib/example.ts`, `src/lib/example.test.ts`, `scripts/seed.ts`, `scripts/seed.test.ts`
- Modify: `src/routes/api/health.ts`, `package.json`

**Interfaces:**
- Consumes: `createDatabase(url)`, the migrated `pings` table, and `@vite-env/core/load`'s `loadEnv()`.
- Produces: `recordPing(db)`, `PingResult = { id: number; createdAt: Date }` (exercised only by `db:seed` and its own unit test), `checkHealth(db)` returning `{ status: "ok", uptime: number, timestamp: string } | { status: "error", message: string }`, the `/api/health` `200`/`503` response built from that result, and `db:seed` output `Seeded ping <id>`.

- [ ] **Step 1: Write failing persistence and seed tests**

```ts
// src/lib/example.test.ts
import { beforeEach, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { createDatabase } from "../db/client";
import { checkHealth, recordPing } from "./example";

let db: ReturnType<typeof createDatabase>;
beforeEach(async () => {
  db = createDatabase("file::memory:");
  await db.run(sql`CREATE TABLE pings (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL)`);
});
test("records then returns a ping", async () => {
  const ping = await recordPing(db);
  expect(ping.id).toBe(1);
  expect(ping.createdAt).toBeInstanceOf(Date);
});
test("reports ok status when the database responds", async () => {
  const result = await checkHealth(db);
  expect(result.status).toBe("ok");
});
test("reports error status when the database throws", async () => {
  const brokenDb = {
    run: () => {
      throw new Error("down");
    },
  } as unknown as typeof db;
  expect(await checkHealth(brokenDb)).toEqual({
    status: "error",
    message: "Database connection failed",
  });
});
```

```ts
// scripts/seed.test.ts
import { expect, test } from "bun:test";
import { seed } from "./seed";

test("seed persists one ping", async () => {
  const result = await seed("file::memory:");
  expect(result.id).toBe(1);
});
```

- [ ] **Step 2: Run tests to verify red**

Run: `bun test src/lib/example.test.ts scripts/seed.test.ts`
Expected: FAIL because `recordPing`, `checkHealth`, and `seed` do not exist.

- [ ] **Step 3: Implement persistence, route response, and seed**

`recordPing` inserts `new Date()`, selects the inserted row, and throws `Error("Ping insert did not return a row")` if absent; it is exercised only by `scripts/seed.ts` and its own unit test, never by the health route. `checkHealth(db)` runs `db.run(sql\`SELECT 1\`)`; on success it returns `{ status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() }`, on a thrown error it returns `{ status: "error", message: "Database connection failed" }`. `src/routes/api/health.ts`'s `GET` handler calls `checkHealth(db)` through the application database and serializes the result as JSON with status `200` for `"ok"` or `503` for `"error"` — it performs no writes. Implement `seed(url: string)` using a supplied database and `recordPing`; `main()` calls `loadEnv(config)` (from `@vite-env/core/load`), resolves the typed URL, invokes `seed`, and logs `Seeded ping ${ping.id}`. Do not migrate in `seed`; the caller must migrate first.

- [ ] **Step 4: Run unit, endpoint, and seed checks**

Run:

```bash
bun test src/lib/example.test.ts scripts/seed.test.ts
rm -f .data/local.db
bun run db:migrate
bun run db:seed
bun run dev
curl -s http://localhost:3000/api/health
```

Expected: tests pass; seed prints `Seeded ping 1`; curl returns JSON matching `{"status":"ok","uptime":<number>,"timestamp":"<ISO-8601>"}`.

- [ ] **Step 5: Commit**

```bash
git add src/lib src/routes/api/health.ts scripts/seed.ts scripts/seed.test.ts package.json
git commit -m "feat(data): add libSQL ping persistence and health check"
```

### Task 5: API and browser end-to-end smoke layers

**Files:**
- Create: `e2e/api/health.test.ts`, `e2e/browser/home.spec.ts`, `playwright.config.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: built `bun run start`, health JSON, and home heading from Tasks 2–3.
- Produces: self-contained `test:e2e:api`, `test:e2e:browser`, and sequential `test:e2e` commands.

- [ ] **Step 1: Write failing API smoke test**

```ts
import { afterAll, beforeAll, expect, test } from "bun:test";

let child: Bun.Subprocess;
let baseUrl = "";
beforeAll(async () => {
  const port = 3100 + Math.floor(Math.random() * 1000);
  baseUrl = `http://127.0.0.1:${port}`;
  child = Bun.spawn(["bun", "run", "start"], { env: { PORT: String(port) }, stdout: "ignore", stderr: "inherit" });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) return; } catch { /* server not ready */ }
    await Bun.sleep(100);
  }
  throw new Error("Server did not become ready");
});
afterAll(() => child.kill());
test("health endpoint reports database connectivity", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(
    expect.objectContaining({ status: "ok", uptime: expect.any(Number), timestamp: expect.any(String) }),
  );
});
```

- [ ] **Step 2: Write failing browser smoke test**

```ts
import { expect, test } from "@playwright/test";
test("renders scaffold heading", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Self-service web checkout" })).toBeVisible();
});
```

- [ ] **Step 3: Run both tests to verify red**

Run:

```bash
bun run test:e2e:api
bunx playwright test e2e/browser/home.spec.ts
```

Expected: browser test fails until `playwright.config.ts` supplies its `webServer` and base URL. The API test may pass because its prescribed startup polling is already present and Tasks 1–4 can satisfy the endpoint contract; do not manufacture a failure.

- [ ] **Step 4: Implement startup ownership and Playwright configuration**

Keep the API test’s `Bun.spawn`/poll/`afterAll` lifecycle. Set Playwright `webServer.command` to `bun run start`, `webServer.env.PORT` to `3101`, `baseURL` to `http://127.0.0.1:3101`, `reuseExistingServer` to `false`, and `testDir` to `e2e/browser`. Do not share a server between suites.

- [ ] **Step 5: Run green e2e checks**

Run:

```bash
bunx playwright install chromium
bun run test:e2e:api
bun run test:e2e:browser
bun run test:e2e
```

Expected: all commands exit 0; neither test is discovered by `bun run test`.

- [ ] **Step 6: Commit**

```bash
git add e2e playwright.config.ts package.json
git commit -m "test(e2e): add API and browser scaffold smoke tests"
```

### Task 6: Docker image and two compose topologies

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `docker-compose.sqld.yml`, `docs/deployment.md`
- Modify: `.dockerignore`

**Interfaces:**
- Consumes: `PORT`, built server command, Drizzle’s `file:`/`libsql:` configuration.
- Produces: named-volume local DB topology and internal healthchecked sqld topology; both run one app process.

- [ ] **Step 1: Write failing topology validations**

```bash
docker build -f Dockerfile .
docker compose -f docker-compose.yml config
docker compose -f docker-compose.sqld.yml config
```

Expected: FAIL until Dockerfile and compose files exist.

- [ ] **Step 2: Implement a non-root Bun image**

Use an `oven/bun` builder to install with `--frozen-lockfile` and run `bun run build`. Copy only `package.json` and the built `.output/` directory into an `oven/bun` runtime stage — Nitro's `.output/server` bundle is self-contained (its non-bundleable native dependencies, e.g. libSQL's platform binding, are vendored into `.output/server/node_modules`), so the runtime stage does not run a second `bun install`. Create a non-root `app` user, set `USER app`, expose `3000`, set `ENV PORT=3000`, and execute `bun run start`. Never execute `db:migrate` on container boot.

- [ ] **Step 3: Implement exact compose constraints**

`docker-compose.yml` has only `app`, mounts a named volume at `/app/data`, and sets `DATABASE_URL=file:/app/data/local.db`. `docker-compose.sqld.yml` creates `app` + `db`, puts `db` only on an internal network, gives `db` a healthcheck, and uses `depends_on: { db: { condition: service_healthy } }`; app uses `DATABASE_URL=libsql://db:8080`. Both topology files run exactly one `app` process.

- [ ] **Step 4: Document topology selection**

Write `docs/deployment.md` with a two-row table: file, use case, availability boundary, required secrets. State both run one app process; no file supplies proxy or migration orchestration.

- [ ] **Step 5: Run container checks**

Run:

```bash
docker build -f Dockerfile -t scaffold-check .
docker compose -f docker-compose.yml up --build -d
docker compose -f docker-compose.yml ps
docker compose -f docker-compose.yml exec app sh -c "test -f /app/data/local.db"
docker compose -f docker-compose.yml down -v
docker compose -f docker-compose.sqld.yml up --build -d
docker compose -f docker-compose.sqld.yml ps
docker compose -f docker-compose.sqld.yml down -v
docker run --rm -d --name scaffold-env-check -p 3299:3000 -e DATABASE_URL=file:/tmp/override.db scaffold-check
sleep 2
curl -fsS http://127.0.0.1:3299/api/health
docker exec scaffold-env-check test -f /tmp/override.db
docker stop scaffold-env-check
```

Expected: both `ps` outputs show healthy/running services; the named volume
actually receives `local.db`; the last block proves the runtime
`DATABASE_URL` override is honored by the same built image (this is the
regression check for the bug documented in
[Typed environment](../specs/2026-08-06-boilerplate-design.md#typed-environment-srcenvts-and-srcenvserverts)) —
`/tmp/override.db` must exist, not the build-time default path.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile docker-compose.yml docker-compose.sqld.yml .dockerignore docs/deployment.md
git commit -m "feat(deploy): add single-app container topologies"
```

### Task 7: Hooks, commit convention, and affected-test selector

**Files:**
- Create: `lefthook.yml`, `commitlint.config.ts`, `scripts/affected-tests.ts`, `scripts/affected-tests.test.ts`

**Interfaces:**
- Consumes: lefthook `{staged_files}` and `{push_files}` arguments.
- Produces: `collectAffectedTests(pushFiles: string[]): Promise<string[]>`,
  where a changed `src/x.ts` maps to existing `src/x.test.ts`, an existing test
  maps to itself, and unmatched files return no entry.

- [ ] **Step 1: Write failing selector tests**

```ts
import { expect, test } from "bun:test";
import { collectAffectedTests } from "./affected-tests";

test("maps source file to its colocated test", async () => {
  await expect(collectAffectedTests(["src/lib/example.ts"])).resolves.toEqual([
    "src/lib/example.test.ts",
  ]);
});
test("keeps a changed test file", async () => {
  await expect(collectAffectedTests(["src/lib/example.test.ts"])).resolves.toEqual([
    "src/lib/example.test.ts",
  ]);
});
```

- [ ] **Step 2: Run test to verify red**

Run: `bun test scripts/affected-tests.test.ts`  
Expected: FAIL because `collectAffectedTests` does not exist.

- [ ] **Step 3: Implement selector and hook configuration**

Implement `collectAffectedTests` as an async function using
`await Bun.file(candidate).exists()` and de-duplicate results. The executable
main parses positional push-file arguments with `yargs(hideBin(process.argv))`
(`argv._` as the file list, not raw `process.argv.slice(2)`), awaits the
selector, then runs `bun test ...tests` only if nonempty; otherwise it exits 0.
Configure lefthook exactly:

```yaml
pre-commit:
  parallel: true
  commands:
    lint:
      glob: "*.{js,ts,jsx,tsx}"
      run: bunx oxlint --fix --no-error-on-unmatched-pattern {staged_files}
      stage_fixed: true
    format:
      glob: "*.{js,ts,jsx,tsx,json,jsonc,md,css,html,yml,yaml}"
      run: bunx oxfmt --write --no-error-on-unmatched-pattern {staged_files}
      stage_fixed: true
commit-msg:
  commands:
    conventional: { run: bunx commitlint --edit {1} }
pre-push:
  commands:
    affected-tests: { run: bun scripts/affected-tests.ts {push_files} }
```

`glob` filters `{staged_files}` per command and skips the command entirely when
nothing matches. `--no-error-on-unmatched-pattern` additionally covers the case
where a matched file is itself ignored by `.oxlintrc.json`/`.oxfmtrc.jsonc`
(for example a staged, oxlint-ignored generated file, or a doc path oxfmt
ignores) — without it, oxlint/oxfmt exit nonzero on zero linted files and the
hook fails on an otherwise-valid commit.

Set `commitlint.config.ts` to `export default { extends: ["@commitlint/config-conventional"] };`.

- [ ] **Step 4: Run green and hook behavior checks**

Run:

```bash
bun test scripts/affected-tests.test.ts
bunx lefthook install
git commit --allow-empty -m "bad message"
git commit --allow-empty -m "chore(hooks): verify conventional message"
```

Expected: selector test passes; first commit is rejected; second commit succeeds. Do not use a broken test push as a routine validation if it risks a remote; invoke the helper locally with a fixture path instead.

- [ ] **Step 5: Commit**

```bash
git add lefthook.yml commitlint.config.ts scripts/affected-tests.ts scripts/affected-tests.test.ts
git commit -m "chore(hooks): enforce formatting and relevant tests"
```

### Task 8: Standardized agent tooling and canonical documentation

**Files:**
- Create: `docs/agent-tooling.md`, `scripts/setup-agent-plugins.ts`, `scripts/update-agent-plugins.ts`, `CLAUDE.md` symlink
- Modify: `AGENTS.md`, `package.json`
- Create: installer-generated OpenCode skill directory and files

**Interfaces:**
- Consumes: `bun run agents:setup` and `bun run agents:update` script names.
- Produces: byte-identical `CLAUDE.md -> AGENTS.md`; documented setup/update behavior with OMP real command `omp plugin marketplace add obra/superpowers-marketplace` then `omp plugin install --scope project superpowers@superpowers-marketplace`.

- [ ] **Step 1: Write failing agent-script contract tests**

```ts
import { expect, test } from "bun:test";

test("agent setup script reports its supported harnesses", async () => {
  const result = Bun.spawnSync(["bun", "scripts/setup-agent-plugins.ts", "--dry-run"]);
  expect(new TextDecoder().decode(result.stdout)).toContain("OMP");
  expect(result.exitCode).toBe(0);
});
```

Place this as `scripts/setup-agent-plugins.test.ts`; write an analogous `--dry-run` test for `update-agent-plugins.ts` containing `bunx skills update`.

- [ ] **Step 2: Run tests to verify red**

Run: `bun test scripts/setup-agent-plugins.test.ts scripts/update-agent-plugins.test.ts`  
Expected: FAIL because both scripts do not exist.

- [ ] **Step 3: Vendor the selected upstream skills**

Run:

```bash
bunx skills@latest add mattpocock/skills
```

In the installer select the **OpenCode** target and exactly these skills: `setup-matt-pocock-skills`, `tdd`, `diagnosing-bugs`, `codebase-design`, and `code-review`. Record every actual installer-created path with `git status --short`; retain nonempty vendored files exactly as generated. The installer controls the OpenCode target directory; do not fabricate `.agents/` or create rule/instruction shims for any other agent.

- [ ] **Step 4: Implement agent setup/update scripts and docs**

Use `Bun.spawnSync` for commands. Parse `--dry-run` with `yargs(hideBin(process.argv)).option("dry-run", { type: "boolean", default: false })`, not `Bun.argv.includes(...)`; the dry-run mode prints commands without executing. Detect OMP via `Bun.which("omp")`: setup executes the marketplace-add then plugin-install commands; update executes `omp plugin upgrade superpowers@superpowers-marketplace`. For Gemini CLI, GitHub Copilot CLI, and Factory Droid, run their documented noninteractive superpowers command; for Claude Code, Codex, OpenCode, and Cursor, print the exact official interactive installation/update prompt and exit 0. Setup always prints the completed vendored-skills status; update runs `bunx skills update` then reminds contributors to compare the embedded ponytail block to its upstream README.

Replace `AGENTS.md` with concise canonical instructions: exact checks, docs-first/spec-first/TDD rules, Conventional Commit and hook rules, and an embedded ponytail ruleset. Its Recommended harness section links to `docs/agent-tooling.md`, not this historical spec. Make the symlink with `ln -s AGENTS.md CLAUDE.md`. Write `docs/agent-tooling.md` to explain all four tiers, the selected OpenCode vendoring scope, supported harness behavior, Junie's manual Guidelines Path exception, the unpinnable marketplace-source policy, setup and update commands, and that updates are manual/no CI cron.

- [ ] **Step 5: Run green checks**

Run:

```bash
bun test scripts/setup-agent-plugins.test.ts scripts/update-agent-plugins.test.ts
bun run agents:setup --dry-run
bun run agents:update --dry-run
cmp AGENTS.md CLAUDE.md
readlink CLAUDE.md
```

Expected: tests pass; scripts exit 0; `cmp` exits 0; `readlink` prints `AGENTS.md`.

- [ ] **Step 6: Commit**

```bash
git add AGENTS.md CLAUDE.md docs/agent-tooling.md scripts/setup-agent-plugins.ts scripts/setup-agent-plugins.test.ts scripts/update-agent-plugins.ts scripts/update-agent-plugins.test.ts package.json
# Add every nonempty installer-created OpenCode skill path shown by git status.
git add <installer-created-opencode-skill-paths>
git commit -m "chore(agents): standardize contributor agent tooling"
```

### Task 9: Contributor documentation

**Files:**
- Modify: `docs/deployment.md`, `docs/agent-tooling.md`, `AGENTS.md`

**Interfaces:**
- Consumes: compose topology documents and agent tooling from prior tasks.
- Produces: accurate operational references; final README onboarding is deferred to Task 12 after clean-checkout verification and explicit owner permission.

- [ ] **Step 1: Write operational documentation acceptance checks**

```bash
grep -F "docker-compose.sqld.yml" docs/deployment.md
grep -F "bun run agents:update" docs/agent-tooling.md
grep -F "docs/agent-tooling.md" AGENTS.md
```

Expected before documentation completion: at least one command fails.

- [ ] **Step 2: Complete operational documentation**

Ensure `docs/deployment.md` covers both compose topologies and their migration boundary. Ensure `docs/agent-tooling.md` documents setup/update behavior and selected OpenCode vendored skills. Ensure `AGENTS.md` links its Recommended harness section to `docs/agent-tooling.md`. Do not modify `README.md` in this task.

- [ ] **Step 3: Run documentation checks**

Run the Step 1 commands.

Expected: every command exits 0.

- [ ] **Step 4: Commit**

```bash
git add docs/deployment.md docs/agent-tooling.md AGENTS.md
git commit -m "docs(scaffold): document contributor operations"
```

### Task 10: CI checks, coverage upload, PR titles, and releases

**Files:**
- Create: `.github/actions/init/action.yml`, `.github/workflows/checks.yml`, `.github/workflows/pr-title.yml`, `.github/workflows/release.yml`, `release-please-config.json`, `.release-please-manifest.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: all scripts above, `coverage/lcov.info`, `CODECOV_TOKEN`, and Conventional Commit history.
- Produces: checks on pull requests targeting `main` and pushes to `main`,
  semantic PR-title validation, and release-please on pushes to `main`.

- [ ] **Step 1: Write failing workflow syntax checks**

```bash
docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest -color .github/workflows/checks.yml .github/workflows/pr-title.yml .github/workflows/release.yml
```

Expected: FAIL because workflow files do not exist. Use `rhysd/actionlint`'s official released binary/Docker action for the `bunx actionlint`-style checks below (the `actionlint` npm package is a WASM library with no executable `bin`, so it cannot satisfy this check as a dependency).

- [ ] **Step 2: Implement the shared init action**

Write composite action steps in this order: `moonrepo/setup-toolchain`, Bun cache keyed by `bun.lock`, Playwright cache keyed by runner OS plus `bun.lock`, then `bun install --frozen-lockfile`. Do not install Node.

- [ ] **Step 3: Implement checks and PR title workflows**

`checks.yml` triggers `pull_request` events targeting `main` and `push` events targeting `main`, avoiding duplicate feature-branch checks. It uses local init, then runs: lint; format; typecheck; `bun test src scripts --coverage --coverage-reporter=lcov` (unit tests only, matching the Global Constraints unit/e2e separation and `package.json`'s `test` script scope — bare `bun test` also discovers `e2e/browser/*.spec.ts` and `e2e/api/*.test.ts`, which need Playwright/a built server and are not part of this step); Codecov v7 with `files: coverage/lcov.info`, `token: ${{ secrets.CODECOV_TOKEN }}`, and `fail_ci_if_error: true`; `bunx playwright install --with-deps chromium`; `bun run test:e2e`; `bun run build`; `docker build -f Dockerfile .`. `pr-title.yml` runs on `opened`, `edited`, `reopened`, and `synchronize` pull-request events; its `pull-requests: read` job uses `amannn/action-semantic-pull-request@v6` with `requireScope: false`, `subjectPattern: ^[a-z].+$`, and the matching lowercase-subject error.

- [ ] **Step 4: Implement release configuration**

Use a single-package `node` release type at `.`. Add `.release-please-manifest.json` with `{".": "0.1.0"}` and set `package.json`'s `version` to `"0.1.0"` so both sources agree before the first Release PR. The workflow triggers only push to `main`, grants `contents: write` and `pull-requests: write`, and uses `googleapis/release-please-action`. Add `coverage/`, `test-results/`, and Playwright output to `.gitignore`. Do not hand-author `CHANGELOG.md`; release-please owns it after its first merged Release PR. Task 12 documents required `CODECOV_TOKEN` and Release PR token decisions in the final README.

- [ ] **Step 5: Run workflow and local coverage checks**

Run:

```bash
docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest -color .github/workflows/checks.yml .github/workflows/pr-title.yml .github/workflows/release.yml
bun test src scripts --coverage --coverage-reporter=lcov
test -s coverage/lcov.info
bun run lint && bun run format && bun run typecheck && bun run test:e2e && bun run build
docker build -f Dockerfile .
```

Expected: every command exits 0 and `coverage/lcov.info` is untracked/ignored.

- [ ] **Step 6: Commit**

```bash
git add .github/actions/init/action.yml .github/workflows/checks.yml .github/workflows/pr-title.yml .github/workflows/release.yml release-please-config.json .release-please-manifest.json .gitignore package.json bun.lock
git commit -m "ci(scaffold): add checks coverage and release automation"
```

### Task 11: Clean-checkout acceptance verification

**Files:**
- Modify: only defects discovered in prior files.
- Test: all scaffold contracts.

**Interfaces:**
- Consumes: complete scaffold.
- Produces: evidence that each locally verifiable acceptance criterion holds.

- [ ] **Step 1: Create clean verification workspace**

```bash
git worktree add --detach ../self-service-web-checkout-verify HEAD
cd ../self-service-web-checkout-verify
```

- [ ] **Step 2: Run clean local application verification**

```bash
bun install --frozen-lockfile
rm -f .env .data/local.db
bun run db:migrate
bun run dev
```

In a second terminal, run:

```bash
curl -fsS http://localhost:3000/
curl -fsS http://localhost:3000/api/health
```

Expected: both return 200; health has `status: "ok"` with `uptime` and `timestamp` fields while `.env` remains absent.

- [ ] **Step 3: Run all local quality and test commands**

```bash
bun run lint
bun run format
bun run typecheck
bun run test
bun run test:e2e:api
bun run test:e2e:browser
bun run build
```

Expected: every command exits 0.

- [ ] **Step 4: Run remaining structural contracts**

```bash
cmp AGENTS.md CLAUDE.md
bunx lefthook run pre-commit
docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest -color .github/workflows/checks.yml .github/workflows/pr-title.yml .github/workflows/release.yml
docker compose -f docker-compose.sqld.yml config
git check-ignore coverage/lcov.info
git check-ignore .data/local.db
```
Expected: every command exits 0. Confirm GitHub-only behavior after first push: checks workflow, semantic PR-title rejection, Codecov upload with secret configured, and release-please Release PR after a Conventional Commit reaches `main`.

- [ ] **Step 5: Retain verification worktree**

Keep `../self-service-web-checkout-verify` available through Task 12's README
validation. Do not remove it as part of this implementation. After all tasks
and reviews complete, push the implementation branch as directed by the
repository owner.

### Task 12: Finalize new-contributor README onboarding

**Files:**
- Modify: `README.md`
- Test: contributor-facing command and link checks.

**Interfaces:**
- Consumes: final script names, Docker topology descriptions, agent-tooling guide, and the verified local workflow from Tasks 1–11.
- Produces: one self-contained onboarding document for a developer new to this repository.

- [ ] **Step 1: Obtain README replacement permission and inventory final commands**

Ask the repository owner once for explicit permission to replace the current in-progress `README.md`; stop this task if denied. Then run:

```bash
bun run
docker compose -f docker-compose.yml config --services
```

Expected: output contains the final scripts and the default topology service names used below.

- [ ] **Step 2: Replace the README with complete onboarding content**

Write these sections in this order:

```markdown
# Self-service web checkout

## Concept

## Tech stack

## Prerequisites

## Quick start

## Development

## Database

## Testing and quality checks

## Deployment topologies

## Agent tooling

## CI and releases

## Documentation
```

`Concept` explains that this repository currently provides only the scaffold proof: a TanStack Start hello-world page and `/api/health` endpoint that checks Drizzle/libSQL database connectivity with `SELECT 1`; it does not claim product checkout functionality yet. `Tech stack` lists Bun, TanStack Start/React, Drizzle/libSQL, Valibot, Vite, oxlint/oxfmt, Playwright, Docker Compose, and GitHub Actions.

`Prerequisites` names Bun at the version pinned by `.prototools`, Docker for container validation/deployment, and Chromium installation for browser e2e. `Quick start` includes exact commands:

```bash
bun install
cp .env.example .env
bun run db:migrate
bun run dev
```

State that `.env` is optional because safe defaults exist, then show `http://localhost:3000/` and `curl http://localhost:3000/api/health`. `Development`, `Database`, and `Testing and quality checks` list every relevant final script with a one-sentence purpose and include:

```bash
bun run lint
bun run format
bun run typecheck
bun run test
bun run test:e2e:api
bun run test:e2e:browser
bun run build
```

`Deployment topologies` summarizes both compose files and links `docs/deployment.md`. `Agent tooling` links `docs/agent-tooling.md`, names OMP as recommended, and shows `bun run agents:setup` and `bun run agents:update`. `CI and releases` explains checks, Codecov token configuration, Conventional Commit requirement, and release-please’s Release PR. `Documentation` links the current design spec and implementation plan. Include GitHub checks, Codecov, MIT license, and release-version badges with actual repository owner/name values.

- [ ] **Step 3: Validate onboarding instructions from a clean checkout**

Run from the Task 11 verification worktree:

```bash
test -s README.md
grep -F "## Concept" README.md
grep -F "## Tech stack" README.md
grep -F "## Quick start" README.md
grep -F "bun run db:migrate" README.md
grep -F "bun run test:e2e:browser" README.md
grep -F "docs/deployment.md" README.md
grep -F "docs/agent-tooling.md" README.md
```

Expected: every command exits 0. Follow the listed quick-start commands on the clean worktree and confirm `/` and `/api/health` both respond 200.

- [ ] **Step 4: Commit final onboarding documentation**

```bash
git add README.md
git commit -m "docs(readme): add contributor onboarding guide"
```

- [ ] **Step 5: Retain verification workspace and push after completion**

Keep the Task 11 verification workspace; do not remove it as part of this
implementation. After all tasks and reviews complete, push the implementation
branch as directed by the repository owner.


## Plan Self-Review

- **Spec coverage:** Tasks 1–5 cover Bun, Oxc, Start, typed environment, Drizzle, migration/seed, unit, API e2e, and browser e2e. Task 6 covers every container topology and deployment docs. Tasks 7–8 cover hooks, commit convention, selected OpenCode skills, agent scripts, symlink, and agent documentation. Task 9 covers operational docs without touching the README. Task 10 covers CI, Codecov, PR titles, and release-please. Task 11 verifies locally actionable acceptance criteria and names external GitHub validations. Task 12 is the sole final, clean-checkout-validated README onboarding task and requires explicit owner permission.
- **Deliberate external boundaries:** Codecov upload/badge resolution, PR workflow execution, and release-please Release PR require a GitHub repository plus secrets/tokens. The plan validates their configuration locally and leaves no simulated substitute.
- **Placeholder scan:** No deferred implementation markers or unspecified interfaces. Task 8 fixes the upstream installer selection to OpenCode plus five named skills; it commits the actual nonempty generated paths rather than fabricating a target directory.
- **Type consistency:** `parseServerEnv`, `createDatabase`, `recordPing`, `PingResult`, `checkHealth`, health JSON, `collectAffectedTests`, and all scripts are defined before consumers and use identical names throughout.
