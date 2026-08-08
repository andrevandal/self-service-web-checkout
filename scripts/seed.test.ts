import { expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { createDatabase } from "#/db/client";
import { seed } from "./seed";

test("seed is repeatable and populates the catalog", async () => {
  const url = "file::memory:?cache=shared";
  const db = createDatabase(url);

  await db.run(sql`CREATE TABLE categories (
    id TEXT PRIMARY KEY NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1
  )`);
  await db.run(sql`CREATE TABLE products (
    id TEXT PRIMARY KEY NOT NULL,
    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    base_price_cents INTEGER NOT NULL,
    image_url TEXT,
    is_available INTEGER NOT NULL DEFAULT 1
  )`);
  await db.run(sql`CREATE TABLE variant_groups (
    id TEXT PRIMARY KEY NOT NULL,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    min_selections INTEGER NOT NULL DEFAULT 1,
    max_selections INTEGER NOT NULL DEFAULT 1,
    UNIQUE(product_id, slug)
  )`);
  await db.run(sql`CREATE TABLE variant_options (
    id TEXT PRIMARY KEY NOT NULL,
    variant_group_id TEXT NOT NULL REFERENCES variant_groups(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    price_delta_cents INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0,
    UNIQUE(variant_group_id, slug)
  )`);
  await db.run(sql`CREATE TABLE addon_groups (
    id TEXT PRIMARY KEY NOT NULL,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    min_selections INTEGER NOT NULL DEFAULT 0,
    max_selections INTEGER,
    UNIQUE(product_id, slug)
  )`);
  await db.run(sql`CREATE TABLE addons (
    id TEXT PRIMARY KEY NOT NULL,
    addon_group_id TEXT NOT NULL REFERENCES addon_groups(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    price_delta_cents INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    UNIQUE(addon_group_id, slug)
  )`);

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
