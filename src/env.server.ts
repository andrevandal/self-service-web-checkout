import { loadEnv } from "@vite-env/core/load";
import config, { parseServerEnv } from "./env";

export const serverEnv = parseServerEnv((await loadEnv(config)).server);
