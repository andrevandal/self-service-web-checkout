import { expect, test } from "bun:test";

test("agent setup script reports its supported harnesses", async () => {
  const result = Bun.spawnSync(["bun", "scripts/setup-agent-plugins.ts", "--dry-run"]);
  expect(new TextDecoder().decode(result.stdout)).toContain("OMP");
  expect(result.exitCode).toBe(0);
});
