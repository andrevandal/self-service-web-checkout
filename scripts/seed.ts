import { loadEnv } from "vite";
import { createDatabase } from "../src/db/client";
import { parseServerEnv } from "../src/env";
import { recordPing } from "../src/lib/example";

export const seed = async (url: string) => recordPing(createDatabase(url));

export const main = async () => {
  const env = parseServerEnv(loadEnv("development", process.cwd(), ""));
  const ping = await seed(env.DATABASE_URL);
  console.log(`Seeded ping ${ping.id}`);
};

if (import.meta.main) {
  await main();
}
