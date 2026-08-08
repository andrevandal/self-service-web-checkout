import { expect, test } from "bun:test";
import { parseServerEnv } from "./env";

test("defaults DATABASE_URL when unset or empty", () => {
  expect(parseServerEnv({}).DATABASE_URL).toBe("file:./.data/local.db");
  expect(parseServerEnv({ DATABASE_URL: "" }).DATABASE_URL).toBe("file:./.data/local.db");
});

test("rejects an unsupported DATABASE_URL scheme", () => {
  expect(() => parseServerEnv({ DATABASE_URL: "ftp://db" })).toThrow("DATABASE_URL");
});

test("coerces string PORT to a number", () => {
  expect(parseServerEnv({ PORT: "3000" }).PORT).toBe(3000);
});

test("accepts an internal sqld HTTP endpoint", () => {
  expect(parseServerEnv({ DATABASE_URL: "http://db:8080" }).DATABASE_URL).toBe("http://db:8080");
});
