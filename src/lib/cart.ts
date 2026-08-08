export type CartVariantSelection = {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  priceDeltaCents: number;
};

export type CartAddonSelection = {
  groupId: string;
  groupName: string;
  addonId: string;
  addonName: string;
  priceDeltaCents: number;
};

export type CartLineInput = {
  productId: string;
  categoryId: string;
  productName: string;
  basePriceCents: number;
  variants: CartVariantSelection[];
  addons: CartAddonSelection[];
};

export type CartLine = CartLineInput & {
  id: string;
  unitPriceCents: number;
};

export type CartState = CartLine[];

export type CartAction =
  | { type: "add"; item: CartLineInput; lineId?: string }
  | { type: "remove"; lineId: string };

export const linePriceCents = (item: CartLineInput): number => {
  const variantDeltas = item.variants.reduce((sum, variant) => sum + variant.priceDeltaCents, 0);
  const addonDeltas = item.addons.reduce((sum, addon) => sum + addon.priceDeltaCents, 0);
  return item.basePriceCents + variantDeltas + addonDeltas;
};

const createLineId = (): string => globalThis.crypto.randomUUID();

export const cartReducer = (state: CartState, action: CartAction): CartState => {
  switch (action.type) {
    case "add": {
      return [
        ...state,
        {
          ...action.item,
          id: action.lineId ?? createLineId(),
          unitPriceCents: linePriceCents(action.item),
        },
      ];
    }
    case "remove":
      return state.filter((line) => line.id !== action.lineId);
  }
};

export const subtotalCents = (lines: CartState): number =>
  lines.reduce((sum, line) => sum + line.unitPriceCents, 0);
