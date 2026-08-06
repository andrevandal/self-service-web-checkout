import { serverEnv } from "../env.server";
import { createDatabase } from "./client";

export const db = createDatabase(serverEnv.DATABASE_URL, serverEnv.DATABASE_AUTH_TOKEN);
