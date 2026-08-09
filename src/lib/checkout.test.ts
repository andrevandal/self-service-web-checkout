import { describe, expect, test } from "bun:test";
import { cartToCreateOrderInput } from "#/lib/checkout";
import type { CartState } from "#/lib/cart";

describe("cartToCreateOrderInput", () => {
  test("submits only catalog selections with one backend quantity per cart line", () => {
    const cart = [
      {
        id: "line-1",
        productId: "product-melted-mushroom-toastie",
        categoryId: "category-toasties",
        productName: "Melted mushroom toastie",
        basePriceCents: 850,
        variants: [
          {
            groupId: "variant-bread",
            groupName: "Bread",
            optionId: "option-rye",
            optionName: "Rye",
            priceDeltaCents: 50,
          },
        ],
        addons: [
          {
            groupId: "addon-extras",
            groupName: "Extras",
            addonId: "addon-extra-cheese",
            addonName: "Extra cheese",
            priceDeltaCents: 100,
          },
        ],
        unitPriceCents: 1_000,
      },
    ] satisfies CartState;

    expect(cartToCreateOrderInput(cart)).toEqual({
      lines: [
        {
          productId: "product-melted-mushroom-toastie",
          quantity: 1,
          variantOptionIds: ["option-rye"],
          addonIds: ["addon-extra-cheese"],
        },
      ],
    });
  });
});
