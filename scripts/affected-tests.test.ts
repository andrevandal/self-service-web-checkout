import { expect, test } from "bun:test";
import { collectAffectedTests } from "./affected-tests";

test("maps source file to its colocated test", async () => {
  expect(await collectAffectedTests(["src/lib/example.ts"])).toEqual(["src/lib/example.test.ts"]);
});

test("keeps a changed test file", async () => {
  expect(await collectAffectedTests(["src/lib/example.test.ts"])).toEqual([
    "src/lib/example.test.ts",
  ]);
});

test("omits unmatched files", async () => {
  expect(await collectAffectedTests(["src/lib/missing.ts"])).toEqual([]);
});

test("omits end-to-end tests owned by separate runners", async () => {
  expect(await collectAffectedTests(["e2e/api/health.test.ts"])).toEqual([]);
});

test("deduplicates affected test paths", async () => {
  expect(
    await collectAffectedTests([
      "src/lib/example.ts",
      "src/lib/example.test.ts",
      "src/lib/other.ts",
    ]),
  ).toEqual(["src/lib/example.test.ts"]);
});
