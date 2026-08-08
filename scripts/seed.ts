import { loadEnv } from "@vite-env/core/load";
import { createDatabase } from "#/db/client";
import {
  addons,
  addonGroups,
  categories,
  products,
  variantGroups,
  variantOptions,
} from "#/db/schema";
import config, { parseServerEnv } from "#/env";

const categoriesSeed = [
  {
    id: "01912a30-0001-7000-8000-000000000001",
    slug: "coffee-espresso",
    name: "Coffee & Espresso",
    displayOrder: 1,
    isActive: true,
  },
  {
    id: "01912a30-0001-7000-8000-000000000002",
    slug: "refreshment-hydration",
    name: "Refreshment & Hydration",
    displayOrder: 2,
    isActive: true,
  },
  {
    id: "01912a30-0001-7000-8000-000000000003",
    slug: "warm-savories",
    name: "Warm Savories",
    displayOrder: 3,
    isActive: true,
  },
  {
    id: "01912a30-0001-7000-8000-000000000004",
    slug: "sweet-treats",
    name: "Sweet Treats",
    displayOrder: 4,
    isActive: true,
  },
];

const productsSeed = [
  {
    id: "01912a30-0002-7000-8000-000000000101",
    categoryId: "01912a30-0001-7000-8000-000000000001",
    slug: "espresso",
    name: "Espresso",
    description: "Rich shot of our signature blend with dark chocolate notes.",
    basePriceCents: 350,
    imageUrl:
      "https://images.unsplash.com/photo-1510591509098-f4fdc6d0ff04?auto=format&fit=crop&w=600&q=80",
    isAvailable: true,
  },
  {
    id: "01912a30-0002-7000-8000-000000000102",
    categoryId: "01912a30-0001-7000-8000-000000000001",
    slug: "latte",
    name: "Latte",
    description: "Smooth double espresso with velvety steamed or iced milk.",
    basePriceCents: 525,
    imageUrl:
      "https://images.unsplash.com/photo-1534778101976-62847782c213?auto=format&fit=crop&w=600&q=80",
    isAvailable: true,
  },
  {
    id: "01912a30-0002-7000-8000-000000000103",
    categoryId: "01912a30-0001-7000-8000-000000000002",
    slug: "cold-brew",
    name: "Cold Brew",
    description: "Slow-steeped cold brew served over ice.",
    basePriceCents: 450,
    imageUrl:
      "https://images.unsplash.com/photo-1517701604599-bb29b565090c?auto=format&fit=crop&w=600&q=80",
    isAvailable: true,
  },
  {
    id: "01912a30-0002-7000-8000-000000000104",
    categoryId: "01912a30-0001-7000-8000-000000000003",
    slug: "ham-cheese-croissant",
    name: "Ham & Cheese Croissant",
    description: "Flaky croissant with smoked honey ham and melted Swiss.",
    basePriceCents: 650,
    imageUrl:
      "https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=600&q=80",
    isAvailable: true,
  },
  {
    id: "01912a30-0002-7000-8000-000000000105",
    categoryId: "01912a30-0001-7000-8000-000000000003",
    slug: "everything-bagel",
    name: "Everything Bagel",
    description: "Classic NYC toasted bagel with cream cheese.",
    basePriceCents: 475,
    imageUrl:
      "https://images.unsplash.com/photo-1585478259715-876acc5be8eb?auto=format&fit=crop&w=600&q=80",
    isAvailable: true,
  },
  {
    id: "01912a30-0002-7000-8000-000000000106",
    categoryId: "01912a30-0001-7000-8000-000000000004",
    slug: "fudge-brownie",
    name: "Fudge Brownie",
    description: "Dark chocolate brownie topped with sea salt flakes.",
    basePriceCents: 425,
    imageUrl:
      "https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=600&q=80",
    isAvailable: true,
  },
  {
    id: "01912a30-0002-7000-8000-000000000107",
    categoryId: "01912a30-0001-7000-8000-000000000004",
    slug: "chocolate-chip-cookie",
    name: "Chocolate Chip Cookie",
    description: "Soft-baked NYC cookie loaded with dark chocolate chunks.",
    basePriceCents: 375,
    imageUrl:
      "https://images.unsplash.com/photo-1499636136210-6f4ee915583e?auto=format&fit=crop&w=600&q=80",
    isAvailable: true,
  },
];

const variantGroupsSeed = [
  {
    id: "01912a30-0003-7000-8000-000000000201",
    productId: "01912a30-0002-7000-8000-000000000102",
    slug: "milk-selection",
    name: "Select Milk",
    minSelections: 1,
    maxSelections: 1,
  },
];

const variantOptionsSeed = [
  {
    id: "01912a30-0004-7000-8000-000000000301",
    variantGroupId: "01912a30-0003-7000-8000-000000000201",
    slug: "whole-milk",
    name: "Whole Milk",
    priceDeltaCents: 0,
    isDefault: true,
  },
  {
    id: "01912a30-0004-7000-8000-000000000302",
    variantGroupId: "01912a30-0003-7000-8000-000000000201",
    slug: "oat-milk",
    name: "Oat Milk",
    priceDeltaCents: 80,
    isDefault: false,
  },
  {
    id: "01912a30-0004-7000-8000-000000000303",
    variantGroupId: "01912a30-0003-7000-8000-000000000201",
    slug: "almond-milk",
    name: "Almond Milk",
    priceDeltaCents: 80,
    isDefault: false,
  },
];

const addonGroupsSeed = [
  {
    id: "01912a30-0005-7000-8000-000000000401",
    productId: "01912a30-0002-7000-8000-000000000102",
    slug: "coffee-addons",
    name: "Add-ons",
    minSelections: 0,
    maxSelections: null,
  },
];

const addonsSeed = [
  {
    id: "01912a30-0006-7000-8000-000000000501",
    addonGroupId: "01912a30-0005-7000-8000-000000000401",
    slug: "extra-shot",
    name: "Extra Shot",
    priceDeltaCents: 100,
    isActive: true,
  },
  {
    id: "01912a30-0006-7000-8000-000000000502",
    addonGroupId: "01912a30-0005-7000-8000-000000000401",
    slug: "vanilla-syrup",
    name: "Vanilla Syrup",
    priceDeltaCents: 75,
    isActive: true,
  },
];

export const seed = async (url: string) => {
  const db = createDatabase(url);

  return db.transaction(async (tx) => {
    await tx.delete(addons);
    await tx.delete(addonGroups);
    await tx.delete(variantOptions);
    await tx.delete(variantGroups);
    await tx.delete(products);
    await tx.delete(categories);

    await tx.insert(categories).values(categoriesSeed);
    await tx.insert(products).values(productsSeed);
    await tx.insert(variantGroups).values(variantGroupsSeed);
    await tx.insert(variantOptions).values(variantOptionsSeed);
    await tx.insert(addonGroups).values(addonGroupsSeed);
    await tx.insert(addons).values(addonsSeed);

    return { categories: categoriesSeed.length, products: productsSeed.length };
  });
};

export const main = async () => {
  const env = parseServerEnv((await loadEnv(config)).server);
  const counts = await seed(env.DATABASE_URL);
  console.log(`Seeded ${counts.categories} categories and ${counts.products} products`);
};

if (import.meta.main) {
  await main();
}
