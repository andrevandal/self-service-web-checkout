import { describe, expect, test } from "bun:test";
import { validateStaffPassword } from "#/lib/kitchen";

describe("kitchen staff seam", () => {
  test("rejects an incorrect staff password", () => {
    expect(() => validateStaffPassword("wrong")).toThrow(
      expect.objectContaining({ code: "invalid_password" }),
    );
  });

  test("rejects an empty staff password as invalid input", () => {
    expect(() => validateStaffPassword("   ")).toThrow(
      expect.objectContaining({ code: "invalid_input" }),
    );
  });

  test("returns a valid staff password unchanged", () => {
    expect(validateStaffPassword("warm-melted")).toBe("warm-melted");
  });
});
