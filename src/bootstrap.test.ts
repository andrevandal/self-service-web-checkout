import { expect, test } from "bun:test";

test("scaffold test runner is configured", () => {
  expect(import.meta.env).toBeDefined();
});
