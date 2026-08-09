import { createServerFn } from "@tanstack/react-start";
import { loadMenu } from "./catalog.functions.server";

export type MenuAddon = {
  id: string;
  addonGroupId: string;
  slug: string;
  name: string;
  priceDeltaCents: number;
};

export type MenuAddonGroup = {
  id: string;
  productId: string;
  slug: string;
  name: string;
  minSelections: number;
  maxSelections: number | null;
  addons: MenuAddon[];
};

export type MenuVariantOption = {
  id: string;
  variantGroupId: string;
  slug: string;
  name: string;
  priceDeltaCents: number;
  isDefault: boolean;
};

export type MenuVariantGroup = {
  id: string;
  productId: string;
  slug: string;
  name: string;
  minSelections: number;
  maxSelections: number;
  options: MenuVariantOption[];
};

export type MenuProduct = {
  id: string;
  categoryId: string;
  slug: string;
  name: string;
  description: string | null;
  basePriceCents: number;
  imageUrl: string | null;
  variantGroups: MenuVariantGroup[];
  addonGroups: MenuAddonGroup[];
};

export type MenuCategory = {
  id: string;
  slug: string;
  name: string;
  displayOrder: number;
  products: MenuProduct[];
};

export type Menu = {
  categories: MenuCategory[];
};

export const getMenu = createServerFn({ method: "GET" }).handler(loadMenu);
