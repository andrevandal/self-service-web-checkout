import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type * as schema from "../db/schema";
import { pings } from "../db/schema";

export type Database = LibSQLDatabase<typeof schema>;
export type PingResult = { id: number; createdAt: Date };

export const recordPing = async (db: Database): Promise<PingResult> => {
  const rows = await db
    .insert(pings)
    .values({ createdAt: new Date() })
    .returning({ id: pings.id, createdAt: pings.createdAt });
  const ping = rows[0];
  if (!ping) {
    throw new Error("Ping insert did not return a row");
  }
  return ping;
};
