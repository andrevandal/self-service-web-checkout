# Agent tooling

This repository standardizes contributor guidance across four complementary tiers. The committed files are the source of truth; optional plugin installs add harness-specific workflow features without replacing the repository rules.

## Tier 1: Portable contributor rules

`AGENTS.md` is the canonical, zero-install instruction file. It contains the repository checks, docs-first/spec-first/TDD workflow, Conventional Commit and hook rules, and the embedded [ponytail](https://github.com/DietrichGebert/ponytail) ruleset. Harnesses that automatically read `AGENTS.md` receive the same baseline guidance without an installer.

Junie is the documented exception: point **Settings → Tools → Junie → Project Settings → Guidelines Path** at this repository's `AGENTS.md`. Junie does not discover that file automatically yet.

## Tier 2: Claude Code compatibility

`CLAUDE.md` is a symlink to `AGENTS.md`, created with `ln -s AGENTS.md CLAUDE.md`. Claude Code therefore reads byte-identical guidance without a second file that can drift.

## Tier 3: Vendored OpenCode engineering skills

The upstream `mattpocock/skills` installer owns the OpenCode target directory. This repository vendors only the nonempty files produced for these five skills:

- `setup-matt-pocock-skills`
- `tdd`
- `diagnosing-bugs`
- `codebase-design`
- `code-review`

The target is selected by the installer (currently `.agents/skills/`). Do not fabricate `.agents/`, add empty files, or create per-agent rule/instruction shims. Refresh this selection with `bunx skills update`, review the generated diff, and commit the changed generated files exactly as upstream produced them.

## Tier 4: Superpowers plugin

[Superpowers](https://github.com/obra/superpowers) is dynamic (plugins, hooks, slash commands, and subagent orchestration), so it is not vendored as static repository files. The helper scripts install or update it through each harness's documented mechanism. The marketplace source is standardized but intentionally not pinned to an exact version or commit: the marketplace catalog controls the published plugin version, and this repository cannot safely claim a reproducible SHA.

### Setup and update commands

Run setup once when configuring a checkout:

```bash
bun run agents:setup
```

Run updates manually when you want to review upstream changes:

```bash
bun run agents:update
```

Both helpers accept `--dry-run` to print commands without executing them. Updates are manual and review-driven; there is no CI cron or automatic updater.

### Supported harness behavior

The setup helper executes real noninteractive commands only when the corresponding executable is available:

| Harness | Setup | Update |
| --- | --- | --- |
| OMP (recommended) | `omp plugin marketplace add obra/superpowers-marketplace`, then `omp plugin install --scope project superpowers@superpowers-marketplace` | `omp plugin upgrade superpowers@superpowers-marketplace` |
| Gemini CLI | `gemini extensions install https://github.com/obra/superpowers` | `gemini extensions update superpowers` |
| GitHub Copilot CLI | `copilot plugin marketplace add obra/superpowers-marketplace`, then `copilot plugin install superpowers@superpowers-marketplace` | `copilot plugin update superpowers@superpowers-marketplace` |
| Factory Droid | `droid plugin marketplace add https://github.com/obra/superpowers`, then `droid plugin install superpowers@superpowers` | `droid plugin update superpowers@superpowers` |

For interactive-only harnesses, the helpers print the exact upstream prompt instead of pretending to install anything:

- **Claude Code:** `/plugin marketplace update superpowers-marketplace`, then `/plugin update superpowers@superpowers-marketplace`.
- **Codex CLI:** open `/plugins`, search for `superpowers`, and select `Install Plugin` (or update the installed plugin there).
- **OpenCode:** tell OpenCode, `Fetch and follow instructions from https://raw.githubusercontent.com/obra/superpowers/refs/heads/main/.opencode/INSTALL.md`.
- **Cursor:** use `/add-plugin superpowers` in Cursor Agent chat.

The upstream Superpowers README also documents other harness integrations (Antigravity, Codex App, Kimi Code, and Pi) as interactive or harness-managed flows. The helper does not fabricate command-line automation for those flows; use their official plugin UI or prompt.

After `bun run agents:update`, compare the embedded ponytail block in `AGENTS.md` with the upstream [ponytail README ruleset](https://github.com/DietrichGebert/ponytail/blob/main/README.md). Ponytail is manually embedded text, so no updater silently rewrites it.
