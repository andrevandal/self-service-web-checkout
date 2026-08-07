import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

export const createDatabase = (url: string) => drizzle({ client: createClient({ url }), schema });
