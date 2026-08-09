import { describe, expect, test } from "bun:test";
import { normalizePrefix } from "./kiosk-session";

describe("normalizePrefix", () => {
  test("trims and uppercases a one-to-five character alphanumeric prefix", () => {
    expect(normalizePrefix(" p1 ")).toBe("P1");
  });

  test("rejects empty, overlong, and non-alphanumeric prefixes", () => {
    expect(normalizePrefix(" ")).toBeNull();
    expect(normalizePrefix("ABCDEF")).toBeNull();
    expect(normalizePrefix("A-")).toBeNull();
  });
});
