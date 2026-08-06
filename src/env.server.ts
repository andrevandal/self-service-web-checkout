import { env as rawServerEnv } from "virtual:env/server";
import { parseServerEnv } from "./env";

export const serverEnv = parseServerEnv(rawServerEnv);
