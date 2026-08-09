import type { CartState } from "#/lib/cart";

import type { CreateOrderInput, CreateOrderResult } from "#/lib/order.functions";

export type { CreateOrderInput, CreateOrderResult };

export const cartToCreateOrderInput = (cart: CartState): CreateOrderInput => ({
  lines: cart.map((line) => ({
    productId: line.productId,
    quantity: 1,
    variantOptionIds: line.variants.map((variant) => variant.optionId),
    addonIds: line.addons.map((addon) => addon.addonId),
  })),
});
