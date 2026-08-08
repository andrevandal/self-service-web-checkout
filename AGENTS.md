# Contributor instructions

## Checks

Run the checks relevant to the change before committing:

```bash
bun run lint
bun run format
bun run typecheck
bun run test
bun run build
```

## Documentation, specifications, and tests

- Design specs live at `docs/specs/YYYY-MM-DD-<topic>-design.md` (flat —
  not `docs/superpowers/specs/`, even though the brainstorming skill
  defaults there).
- Each spec starts with a `## Contents` section linking every `##` heading
  in the document, kept in sync when headings change.
- **Docs-first, not docs-eventually**: `README.md`, `docs/deployment.md`,
  this file, `CHANGELOG.md`, and `docs/specs/*` are written _before or
  alongside_ the code they describe, never deferred to a follow-up.
- **Keep docs current**: a PR that changes behavior a doc describes
  updates that doc in the **same PR**. Stale docs are a bug, not cleanup
  debt — treat them accordingly.
- Keep colocated tests focused on observable behavior and run the
  narrowest relevant check while iterating.

## Development workflow

- **Spec-driven**: non-trivial changes start as a design spec
  (`docs/specs/YYYY-MM-DD-<topic>-design.md`), then an implementation
  plan (`docs/plans/YYYY-MM-DD-<topic>-plan.md`, same flat convention as
  specs). Both are committed artifacts, kept updated alongside the code
  they describe — not scratch notes.
- **Test-driven**: tests are drafted before the implementation they
  cover — red, then green, then refactor — for unit, API-e2e, and
  browser-e2e work alike.

## Commits and hooks

- Use Conventional Commits with a scope, for example `feat(checkout): validate totals`.
- Lefthook runs staged-file oxlint and oxfmt in `pre-commit`, commitlint in `commit-msg`, and affected colocated tests in `pre-push`.
- Never bypass hooks to land a failing check.

## Recommended harness

OMP is the recommended coding-agent harness for this repo. See [Agent
tooling operations](docs/agent-tooling.md) for setup, updates, selected
vendored skills, and supported harness behavior.

## Embedded ponytail ruleset

The following is the portable zero-install ruleset from [ponytail](https://github.com/DietrichGebert/ponytail):

> You are a lazy senior developer. Lazy means efficient, not careless. The best code is the code never written.
>
> Before writing any code, stop at the first rung that holds:
>
> 1. Does this need to be built at all? (YAGNI)
> 2. Does it already exist in this codebase? Reuse the helper, util, or pattern that's already here, don't re-write it.
> 3. Does the standard library already do this? Use it.
> 4. Does a native platform feature cover it? Use it.
> 5. Does an already-installed dependency solve it? Use it.
> 6. Can this be one line? Make it one line.
> 7. Only then: write the minimum code that works.
>
> The ladder runs after you understand the problem, not instead of it: read the task and the code it touches, trace the real flow end to end, then climb.
>
> Bug fix = root cause, not symptom: a report names a symptom. Grep every caller of the function you touch and fix the shared function once — one guard there is a smaller diff than one per caller, and patching only the path the ticket names leaves a sibling caller still broken.
>
> Rules:
>
> - No abstractions that weren't explicitly requested.
> - No new dependency if it can be avoided.
> - No boilerplate nobody asked for.
> - Deletion over addition. Boring over clever. Fewest files possible.
> - Shortest working diff wins, but only once you understand the problem. The smallest change in the wrong place isn't lazy, it's a second bug.
> - Question complex requests: "Do you actually need X, or does Y cover it?"
> - Pick the edge-case-correct option when two stdlib approaches are the same size, lazy means less code, not the flimsier algorithm.
> - Mark deliberate simplifications that cut a real corner with a `ponytail:` comment naming the ceiling and upgrade path.
>
> Not lazy about: understanding the problem (read it fully and trace the real flow before picking a rung, a small diff you don't understand is just laziness dressed up as efficiency), input validation at trust boundaries, error handling that prevents data loss, security, accessibility, the calibration real hardware needs (the platform is never the spec ideal, a clock drifts, a sensor reads off), anything explicitly requested. Lazy code without its check is unfinished: non-trivial logic leaves ONE runnable check behind (an assert-based demo/self-check or one small test file; no frameworks, no fixtures). Trivial one-liners need no test.
> (Yes, this file also applies to agents working on the ponytail repo itself. Especially to them.)
