import { expect, test } from "bun:test";

test("agent update script prints the Codex plugin update prompt", async () => {
  const result = Bun.spawnSync(["bun", "scripts/update-agent-plugins.ts", "--dry-run"]);
  const output = new TextDecoder().decode(result.stdout);
  expect(output).toContain("bunx skills update");
  expect(output).toContain(
    "Codex CLI: /plugins, search for superpowers, then select Update Plugin",
  );
  expect(result.exitCode).toBe(0);
});
