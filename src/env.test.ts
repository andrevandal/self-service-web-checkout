import { expect, test } from "bun:test";
import { parseServerEnv } from "./env";

test("defaults DATABASE_URL when unset or empty", () => {
  expect(parseServerEnv({}).DATABASE_URL).toBe("file:./.data/local.db");
  expect(parseServerEnv({ DATABASE_URL: "" }).DATABASE_URL).toBe(
    "file:./.data/local.db",
  );
});

test("rejects malformed DATABASE_URL", () => {
  expect(() => parseServerEnv({ DATABASE_URL: "https://db" })).toThrow(
    "DATABASE_URL",
  );
});
