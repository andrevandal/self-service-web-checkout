import { createServerFn } from "@tanstack/react-start";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "#/db/client.server";
import {
  addonGroups,
  addons,
  categories,
  products,
  variantGroups,
  variantOptions,
} from "#/db/schema";

type MenuAddon = {
  id: string;
  addonGroupId: string;
  slug: string;
  name: string;
  priceDeltaCents: number;
};

type MenuAddonGroup = {
  id: string;
  productId: string;
  slug: string;
  name: string;
  minSelections: number;
  maxSelections: number | null;
  addons: MenuAddon[];
};

type MenuVariantOption = {
  id: string;
  variantGroupId: string;
  slug: string;
  name: string;
  priceDeltaCents: number;
  isDefault: boolean;
};

type MenuVariantGroup = {
  id: string;
  productId: string;
  slug: string;
  name: string;
  minSelections: number;
  maxSelections: number;
  options: MenuVariantOption[];
};

type MenuProduct = {
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

type MenuCategory = {
  id: string;
  slug: string;
  name: string;
  displayOrder: number;
  products: MenuProduct[];
};

export type Menu = {
  categories: MenuCategory[];
};

export const loadMenu = async (): Promise<Menu> => {
  const categoryRows = await db
    .select()
    .from(categories)
    .where(eq(categories.isActive, true))
    .orderBy(asc(categories.displayOrder), asc(categories.id));

  if (categoryRows.length === 0) {
    return { categories: [] };
  }

  const categoryIds = categoryRows.map((category) => category.id);
  const productRows = await db
    .select()
    .from(products)
    .where(and(eq(products.isAvailable, true), inArray(products.categoryId, categoryIds)))
    .orderBy(asc(products.slug), asc(products.id));

  if (productRows.length === 0) {
    return {
      categories: categoryRows.map((category) => ({
        id: category.id,
        slug: category.slug,
        name: category.name,
        displayOrder: category.displayOrder,
        products: [],
      })),
    };
  }

  const productIds = productRows.map((product) => product.id);
  const variantGroupRows = await db
    .select()
    .from(variantGroups)
    .where(inArray(variantGroups.productId, productIds))
    .orderBy(asc(variantGroups.slug), asc(variantGroups.id));
  const variantGroupIds = variantGroupRows.map((group) => group.id);
  const variantOptionRows =
    variantGroupIds.length === 0
      ? []
      : await db
          .select()
          .from(variantOptions)
          .where(inArray(variantOptions.variantGroupId, variantGroupIds))
          .orderBy(asc(variantOptions.slug), asc(variantOptions.id));

  const addonGroupRows = await db
    .select()
    .from(addonGroups)
    .where(inArray(addonGroups.productId, productIds))
    .orderBy(asc(addonGroups.slug), asc(addonGroups.id));
  const addonGroupIds = addonGroupRows.map((group) => group.id);
  const addonRows =
    addonGroupIds.length === 0
      ? []
      : await db
          .select()
          .from(addons)
          .where(and(eq(addons.isActive, true), inArray(addons.addonGroupId, addonGroupIds)))
          .orderBy(asc(addons.slug), asc(addons.id));

  const optionsByGroup = new Map<string, MenuVariantOption[]>();
  for (const option of variantOptionRows) {
    const options = optionsByGroup.get(option.variantGroupId) ?? [];
    options.push({
      id: option.id,
      variantGroupId: option.variantGroupId,
      slug: option.slug,
      name: option.name,
      priceDeltaCents: option.priceDeltaCents,
      isDefault: option.isDefault,
    });
    optionsByGroup.set(option.variantGroupId, options);
  }

  const variantsByProduct = new Map<string, MenuVariantGroup[]>();
  for (const group of variantGroupRows) {
    const variantGroupsForProduct = variantsByProduct.get(group.productId) ?? [];
    variantGroupsForProduct.push({
      id: group.id,
      productId: group.productId,
      slug: group.slug,
      name: group.name,
      minSelections: group.minSelections,
      maxSelections: group.maxSelections,
      options: optionsByGroup.get(group.id) ?? [],
    });
    variantsByProduct.set(group.productId, variantGroupsForProduct);
  }

  const addonsByGroup = new Map<string, MenuAddon[]>();
  for (const addon of addonRows) {
    const addonsForGroup = addonsByGroup.get(addon.addonGroupId) ?? [];
    addonsForGroup.push({
      id: addon.id,
      addonGroupId: addon.addonGroupId,
      slug: addon.slug,
      name: addon.name,
      priceDeltaCents: addon.priceDeltaCents,
    });
    addonsByGroup.set(addon.addonGroupId, addonsForGroup);
  }

  const addonGroupsByProduct = new Map<string, MenuAddonGroup[]>();
  for (const group of addonGroupRows) {
    const addonGroupsForProduct = addonGroupsByProduct.get(group.productId) ?? [];
    addonGroupsForProduct.push({
      id: group.id,
      productId: group.productId,
      slug: group.slug,
      name: group.name,
      minSelections: group.minSelections,
      maxSelections: group.maxSelections,
      addons: addonsByGroup.get(group.id) ?? [],
    });
    addonGroupsByProduct.set(group.productId, addonGroupsForProduct);
  }

  const productsByCategory = new Map<string, MenuProduct[]>();
  for (const product of productRows) {
    const productsForCategory = productsByCategory.get(product.categoryId) ?? [];
    productsForCategory.push({
      id: product.id,
      categoryId: product.categoryId,
      slug: product.slug,
      name: product.name,
      description: product.description,
      basePriceCents: product.basePriceCents,
      imageUrl: product.imageUrl,
      variantGroups: variantsByProduct.get(product.id) ?? [],
      addonGroups: addonGroupsByProduct.get(product.id) ?? [],
    });
    productsByCategory.set(product.categoryId, productsForCategory);
  }

  return {
    categories: categoryRows.map((category) => ({
      id: category.id,
      slug: category.slug,
      name: category.name,
      displayOrder: category.displayOrder,
      products: productsByCategory.get(category.id) ?? [],
    })),
  };
};

export const getMenu = createServerFn({ method: "GET" }).handler(loadMenu);
