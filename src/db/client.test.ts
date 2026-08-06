import { expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { createDatabase } from "./client";

test("creates a usable in-memory libSQL database", async () => {
  const db = createDatabase("file::memory:");
  await expect(db.run(sql`SELECT 1`)).resolves.toBeDefined();
});
