import { describe, expect, test } from "bun:test";
import { cartReducer, linePriceCents, subtotalCents, type CartLineInput } from "./cart";

const item = (overrides: Partial<CartLineInput> = {}): CartLineInput => ({
  productId: "toastie",
  categoryId: "toasties",
  productName: "Test toastie",
  basePriceCents: 850,
  variants: [],
  addons: [],
  ...overrides,
});

describe("cart reducer", () => {
  test("adds a direct product and computes a cent subtotal", () => {
    const state = cartReducer([], { type: "add", item: item(), lineId: "line-1" });
    expect(state).toHaveLength(1);
    expect(state[0]?.unitPriceCents).toBe(850);
    expect(subtotalCents(state)).toBe(850);
  });

  test("adds selected variant/addon deltas without floating point math", () => {
    const state = cartReducer([], {
      type: "add",
      lineId: "line-2",
      item: item({
        variants: [
          {
            groupId: "size",
            groupName: "Size",
            optionId: "large",
            optionName: "Large",
            priceDeltaCents: 125,
          },
        ],
        addons: [
          {
            groupId: "extras",
            groupName: "Extras",
            addonId: "less",
            addonName: "Less sauce",
            priceDeltaCents: -25,
          },
        ],
      }),
    });
    expect(linePriceCents(state[0]!)).toBe(950);
    expect(subtotalCents(state)).toBe(950);
  });

  test("removes exactly one line and recalculates subtotal", () => {
    const first = cartReducer([], {
      type: "add",
      item: item({ productId: "first" }),
      lineId: "line-1",
    });
    const both = cartReducer(first, {
      type: "add",
      item: item({ productId: "second", basePriceCents: 650 }),
      lineId: "line-2",
    });
    const remaining = cartReducer(both, { type: "remove", lineId: "line-1" });
    expect(remaining.map((line) => line.id)).toEqual(["line-2"]);
    expect(subtotalCents(remaining)).toBe(650);
  });
});
