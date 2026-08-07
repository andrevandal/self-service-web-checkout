import { expect, mock, test } from "bun:test";
import { sql } from "drizzle-orm";
import { createDatabase } from "../../db/client";

const db = createDatabase("file::memory:");
await db.run(
  sql`CREATE TABLE pings (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL)`,
);
await db.run(sql`INSERT INTO pings (created_at) VALUES (${Date.now()})`);

mock.module(import.meta.resolve("../../db/client.server"), () => ({ db }));

test("health route reports database connectivity", async () => {
  // Import after mocking so the route captures the in-memory database.
  const { Route } = await import("./health");
  const getHandler = (
    Route.options.server?.handlers as { GET?: () => Promise<Response> } | undefined
  )?.GET;
  if (!getHandler) {
    throw new Error("Health route GET handler is not configured");
  }

  const response = await getHandler();

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(
    expect.objectContaining({
      status: "ok",
      uptime: expect.any(Number),
      timestamp: expect.any(String),
    }),
  );
});
