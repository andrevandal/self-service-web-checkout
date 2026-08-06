import { expect, test } from "bun:test";

test("agent update script prints Claude Code plugin update prompts", async () => {
  const result = Bun.spawnSync(["bun", "scripts/update-agent-plugins.ts", "--dry-run"]);
  const output = new TextDecoder().decode(result.stdout);
  expect(output).toContain("bunx skills update");
  expect(output).toContain(
    "Claude Code: /plugin marketplace update superpowers-marketplace; then /plugin update superpowers@superpowers-marketplace",
  );
  expect(output).toContain(
    "Codex CLI: /plugins, search for superpowers, then select Update Plugin",
  );
  expect(result.exitCode).toBe(0);
});
