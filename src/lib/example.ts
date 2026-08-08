import { sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type * as schema from "#/db/schema";

export type Database = LibSQLDatabase<typeof schema>;

export type HealthResult =
  | { status: "ok"; uptime: number; timestamp: string }
  | { status: "error"; message: string };

export const checkHealth = async (db: Database): Promise<HealthResult> => {
  try {
    await db.run(sql`SELECT 1`);
    return { status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() };
  } catch {
    return { status: "error", message: "Database connection failed" };
  }
};
