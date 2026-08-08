# Dependency and import-alias Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove unused direct dependencies and replace handwritten cross-directory imports with the existing `#/*` alias.

**Architecture:** `package.json` continues to own the runtime `#/* → ./src/*` mapping, and `tsconfig.json` continues to mirror it for TypeScript. Handwritten modules use `#/*` only when crossing a directory boundary; same-directory and generator-owned imports stay relative.

**Tech Stack:** Bun, TypeScript, Vite, TanStack Start, oxfmt, oxlint.

## Global Constraints

- Keep `cnfast` and `lucide-react`.
- Remove only `class-variance-authority`, `clsx`, and `tailwind-merge`.
- Do not reclassify build tooling between `dependencies` and `devDependencies`.
- Do not modify generated `src/routeTree.gen.ts`.
- Keep same-directory imports relative.
- Do not add a second alias; use only `#/*`.

---

### Task 1: Remove unused dependencies and redundant path alias

**Files:**
- Modify: `package.json:6-8,28-75`
- Modify: `bun.lock`
- Modify: `tsconfig.json:7-10`

**Interfaces:**
- Consumes: package runtime import map `#/* → ./src/*`.
- Produces: one shared alias contract in `package.json` and TypeScript.

- [ ] **Step 1: Confirm direct dependency references before removal**

Run:

```bash
grep -R -E 'class-variance-authority|clsx|tailwind-merge' src scripts vite.config.ts drizzle.config.ts package.json
```

Expected: references occur only in `package.json` and `bun.lock`; no authored source imports remain.

- [ ] **Step 2: Remove unused direct dependencies**

Run:

```bash
bun remove class-variance-authority clsx tailwind-merge
```

Expected: `package.json` and `bun.lock` remove the three direct packages; `cnfast` and `lucide-react` remain.

- [ ] **Step 3: Remove the unused TypeScript-only alias**

Change `tsconfig.json` to retain only:

```json
"paths": {
  "#/*": ["./src/*"]
}
```

- [ ] **Step 4: Verify configuration resolution**

Run:

```bash
bun run typecheck
```

Expected: exit 0.

- [ ] **Step 5: Commit dependency and alias configuration**

```bash
git add package.json bun.lock tsconfig.json
git commit -m "chore(app): remove unused class utilities"
```

### Task 2: Migrate handwritten cross-directory source imports

**Files:**
- Modify: `drizzle.config.ts:5`
- Modify: `scripts/seed.ts:2-4`
- Modify: `scripts/seed.test.ts:3`
- Modify: `src/db/client.server.ts:1`
- Modify: `src/lib/example.ts:3-4`
- Modify: `src/lib/example.test.ts:3`
- Modify: `src/routes/__root.tsx:6-9`
- Modify: `src/routes/api/health.ts:2-3`
- Modify: `src/routes/api/-health.test.ts:3,15`

**Interfaces:**
- Consumes: `#/*` mapping from `package.json` and `tsconfig.json`.
- Produces: cross-directory imports that resolve from `src/` without `../` chains.

- [ ] **Step 1: Update root configuration and script imports**

Replace imports from `src` with aliases:

```ts
import { parseServerEnv } from "#/env";
import { createDatabase } from "#/db/client";
import config, { parseServerEnv } from "#/env";
import { recordPing } from "#/lib/example";
```

Use the matching subset in `drizzle.config.ts`, `scripts/seed.ts`, and `scripts/seed.test.ts`; retain `./` imports within `scripts/`.

- [ ] **Step 2: Update source and test cross-directory imports**

Apply aliases where imports cross directories:

```ts
import { getContext } from "#/integrations/tanstack-query/root-provider";
import { serverEnv } from "#/env.server";
import { pings } from "#/db/schema";
import { db } from "#/db/client.server";
import { checkHealth } from "#/lib/example";
```

In `src/routes/__root.tsx`, use `#/integrations/...` and `#/styles.css?url`. In `src/routes/api/-health.test.ts`, use `#/db/client` while retaining the sibling `./health` dynamic import.

- [ ] **Step 3: Preserve local and generated imports**

Do not change imports such as `./env`, `./client`, `./schema`, `./example`, `./health`, test sibling imports, or any line in `src/routeTree.gen.ts`.

- [ ] **Step 4: Verify aliases across TypeScript, runtime tests, and production build**

Run:

```bash
bun run typecheck
bun run test
bun run build
```

Expected: all commands exit 0; unit and route tests resolve `#/*` through Bun, and Vite produces `.output/`.

- [ ] **Step 5: Format and commit import migration**

Run:

```bash
bun run format:fix
git add drizzle.config.ts scripts/seed.ts scripts/seed.test.ts src/router.tsx src/db/client.server.ts src/lib/example.ts src/lib/example.test.ts src/routes/__root.tsx src/routes/api/health.ts src/routes/api/-health.test.ts
git commit -m "refactor(app): use source import aliases"
```
