import { expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { createDatabase } from "../src/db/client";
import { seed } from "./seed";
test("seed persists one ping", async () => {
  const url = "file::memory:?cache=shared";
  const db = createDatabase(url);
  await db.run(
    sql`CREATE TABLE pings (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL)`,
  );
  const result = await seed(url);
  expect(result.id).toBe(1);
});
