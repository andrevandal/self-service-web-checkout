# Dependency and import-alias design

## Goal
Remove unused direct dependencies and standardize cross-directory project imports without changing runtime behavior.

## Dependency decisions
- Retain `cnfast`: `src/lib/utils.ts` exports its `cn` helper and `ClassValue` type.
- Retain `lucide-react` for planned interface icons, despite no current import.
- Remove unused direct dependencies `class-variance-authority`, `clsx`, and `tailwind-merge` from `package.json` and `bun.lock`.
- Do not reclassify build tooling between `dependencies` and `devDependencies`.

## Import boundary
- Use the existing `#/*` alias for handwritten cross-directory imports rooted at `src/`, including scripts that import source modules.
- Keep same-directory imports relative to preserve local-module readability.
- Preserve generated `src/routeTree.gen.ts` imports; the TanStack generator owns that file.
- Remove unused `@/*` from TypeScript `paths`; `package.json` already defines `#/*` for Bun/Node resolution and Vite reads TypeScript paths.

## Verification
- `bun run typecheck` proves alias resolution across TypeScript and Vite configuration.
- `bun run test` proves application, route, and script imports still resolve.
- `bun run build` proves Vite and production bundling resolve aliases.
