import { integer, sqliteTable } from "drizzle-orm/sqlite-core";

export const pings = sqliteTable("pings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
