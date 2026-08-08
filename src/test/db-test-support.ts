import { runWithStartContext } from "@tanstack/start-storage-context";
import { sql } from "drizzle-orm";
import { mock } from "bun:test";
import { createDatabase } from "#/db/client";

type MigrationJournal = {
  entries: Array<{ tag: string }>;
};

export const createTestDatabase = async (url = "file::memory:") => {
  const db = createDatabase(url);
  await db.run(sql`PRAGMA foreign_keys = ON`);

  const journalUrl = new URL("../../drizzle/meta/_journal.json", import.meta.url);
  const journal = (await Bun.file(journalUrl).json()) as MigrationJournal;
  for (const { tag } of journal.entries) {
    const migrationUrl = new URL(`../../drizzle/${tag}.sql`, import.meta.url);
    const migration = await Bun.file(migrationUrl).text();
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) {
        await db.run(sql.raw(statement));
      }
    }
  }

  return db;
};

export const mockDatabaseModule = (db: unknown) => {
  mock.module("#/db/client.server", () => ({ db }));
};

export const withStartContext = <T>(handler: () => Promise<T>) =>
  runWithStartContext(
    {
      getRouter: async () => {
        throw new Error("router is not needed for direct server-function execution");
      },
      request: new Request("http://localhost"),
      startOptions: {},
      contextAfterGlobalMiddlewares: {},
      executedRequestMiddlewares: new Set(),
      handlerType: "serverFn",
    },
    handler,
  );
