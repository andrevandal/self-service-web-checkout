import { defineStandardEnv } from "@vite-env/core";
import * as v from "valibot";
const serverEnvFields = {
  DATABASE_URL: v.pipe(
    v.optional(v.string(), "file:./.data/local.db"),
    v.transform((value) => value || "file:./.data/local.db"),
    v.regex(/^(file:|libsql:)/, "DATABASE_URL must start with file: or libsql:"),
  ),
  DATABASE_AUTH_TOKEN: v.optional(v.string()),
  PORT: v.pipe(
    v.optional(v.union([v.number(), v.string()]), 3000),
    v.transform((value) => (typeof value === "string" ? Number(value) : value)),
    v.number(),
    v.integer(),
    v.minValue(1),
    v.maxValue(65535),
  ),
};

export const serverEnvSchema = v.object(serverEnvFields);

export const parseServerEnv = (input: unknown) => v.parse(serverEnvSchema, input);

export default defineStandardEnv({ server: serverEnvFields });

