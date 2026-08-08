import { loadEnv } from "@vite-env/core/load";
import { createDatabase } from "#/db/client";
import config, { parseServerEnv } from "#/env";
import { recordPing } from "#/lib/example";

export const seed = async (url: string) => recordPing(createDatabase(url));

export const main = async () => {
  const env = parseServerEnv((await loadEnv(config)).server);
  const ping = await seed(env.DATABASE_URL);
  console.log(`Seeded ping ${ping.id}`);
};

if (import.meta.main) {
  await main();
}
