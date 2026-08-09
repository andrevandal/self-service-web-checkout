import type { CartState } from "#/lib/cart";

export type CreateOrderInput = {
  lines: Array<{
    productId: string;
    quantity: number;
    variantOptionIds: string[];
    addonIds: string[];
  }>;
};

export type CreateOrderResult = {
  id: string;
  kioskId: string;
  status: "payment_pending";
  orderNumber: null;
  subtotalCents: number;
  totalAmountCents: number;
  items: Array<{
    id: string;
    productId: string;
    productName: string;
    quantity: number;
    unitPriceCents: number;
    variants: Array<{
      id: string;
      optionId: string;
      optionName: string;
      priceDeltaCents: number;
    }>;
    addons: Array<{
      id: string;
      addonId: string;
      addonName: string;
      priceDeltaCents: number;
    }>;
  }>;
};

export const cartToCreateOrderInput = (cart: CartState): CreateOrderInput => ({
  lines: cart.map((line) => ({
    productId: line.productId,
    quantity: 1,
    variantOptionIds: line.variants.map((variant) => variant.optionId),
    addonIds: line.addons.map((addon) => addon.addonId),
  })),
});
