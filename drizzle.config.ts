import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { defineConfig } from "drizzle-kit";
import { loadEnv } from "vite";
import { parseServerEnv } from "#/env";

const env = parseServerEnv(loadEnv("development", process.cwd(), ""));
const databasePath = env.DATABASE_URL.slice("file:".length);
if (env.DATABASE_URL.startsWith("file:") && !databasePath.startsWith(":memory:")) {
  mkdirSync(dirname(databasePath), { recursive: true });
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: env.DATABASE_URL,
  },
});
