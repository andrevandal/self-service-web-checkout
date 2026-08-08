import { expect, mock, test } from "bun:test";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createTestDatabase } from "#/test/db-test-support";

let seedDatabaseUrl = "file::memory:?cache=shared";
mock.module("@vite-env/core/load", () => ({
  loadEnv: async () => ({ server: { DATABASE_URL: seedDatabaseUrl } }),
}));

const { main, seed } = await import("./seed");

test("seed is repeatable and populates the catalog", async () => {
  const url = `file:/tmp/self-service-seed-repeatable-${randomUUID()}.db`;
  const db = await createTestDatabase(url);
  const first = await seed(url);
  const second = await seed(url);

  expect(first).toEqual({ categories: 4, products: 7 });
  expect(second).toEqual({ categories: 4, products: 7 });

  const count = async (table: string) => {
    const rows = await db.all<{ count: number }>(sql.raw(`SELECT COUNT(*) AS count FROM ${table}`));
    return rows[0]?.count;
  };

  expect(await count("categories")).toBe(4);
  expect(await count("products")).toBe(7);
  expect(await count("variant_groups")).toBe(1);
  expect(await count("variant_options")).toBe(3);
  expect(await count("addon_groups")).toBe(1);
  expect(await count("addons")).toBe(2);
});

test("main loads the database URL from env, seeds rows, and logs counts", async () => {
  const url = `file:/tmp/self-service-seed-main-${randomUUID()}.db`;
  const db = await createTestDatabase(url);
  seedDatabaseUrl = url;

  const messages: string[] = [];
  const originalLog = console.log;
  console.log = (message: string) => {
    messages.push(message);
  };
  try {
    await main();
  } finally {
    console.log = originalLog;
  }

  expect(messages).toEqual(["Seeded 4 categories and 7 products"]);
  const rows = await db.all<{ count: number }>(sql`SELECT COUNT(*) AS count FROM categories`);
  expect(rows[0]?.count).toBe(4);
});
