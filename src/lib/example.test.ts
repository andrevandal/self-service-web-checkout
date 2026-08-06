import { beforeEach, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { createDatabase } from "../db/client";
import { type Database, recordPing } from "./example";

let db: Database;
beforeEach(async () => {
  db = createDatabase("file::memory:");
  await db.run(
    sql`CREATE TABLE pings (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL)`,
  );
});
test("records then returns a ping", async () => {
  const ping = await recordPing(db);
  expect(ping.id).toBe(1);
  expect(ping.createdAt).toBeInstanceOf(Date);
});
