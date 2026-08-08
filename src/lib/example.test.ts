import { beforeEach, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { createDatabase } from "#/db/client";
import { checkHealth, type Database, recordPing } from "./example";

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
test("checkHealth reports ok status when the database responds", async () => {
  const result = await checkHealth(db);
  expect(result.status).toBe("ok");
  if (result.status === "ok") {
    expect(typeof result.uptime).toBe("number");
    expect(result.timestamp).toBeDefined();
  }
});
test("checkHealth reports error status when the database throws", async () => {
  const brokenDb = {
    run: () => {
      throw new Error("down");
    },
  } as unknown as Database;
  expect(await checkHealth(brokenDb)).toEqual({
    status: "error",
    message: "Database connection failed",
  });
});
