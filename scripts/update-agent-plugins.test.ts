import { expect, test } from "bun:test";

test("agent update script reports skills update command", async () => {
  const result = Bun.spawnSync(["bun", "scripts/update-agent-plugins.ts", "--dry-run"]);
  expect(new TextDecoder().decode(result.stdout)).toContain("bunx skills update");
  expect(result.exitCode).toBe(0);
});
