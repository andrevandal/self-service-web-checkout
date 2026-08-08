import { expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { createDatabase } from "./client";

test("creates a usable in-memory libSQL database", async () => {
  const db = createDatabase("file::memory:");
  const result = await db.run(sql`SELECT 1`);
  expect(result).toBeDefined();
});
