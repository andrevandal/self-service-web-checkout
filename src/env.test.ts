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

test("defaults kiosk claim configuration safely", () => {
  expect(parseServerEnv({})).toMatchObject({
    KIOSK_CLAIM_PASSWORD: "",
    KIOSK_COOKIE_SECRET: "",
    KIOSK_COOKIE_SECURE: false,
  });
});

test("coerces the kiosk cookie secure flag", () => {
  expect(parseServerEnv({ KIOSK_COOKIE_SECURE: "true" }).KIOSK_COOKIE_SECURE).toBe(true);
  expect(parseServerEnv({ KIOSK_COOKIE_SECURE: "false" }).KIOSK_COOKIE_SECURE).toBe(false);
});
