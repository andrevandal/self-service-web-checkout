import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

export const createDatabase = (url: string) => {
  const database = drizzle(createClient({ url }), { schema });
  const run = database.run.bind(database);
  database.run = ((query) => Promise.resolve(run(query))) as typeof database.run;
  return database;
};
