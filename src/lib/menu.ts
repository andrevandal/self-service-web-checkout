import { createServerFn } from "@tanstack/react-start";

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

const menuFixture: Menu = {
  categories: [
    {
      id: "category-toasties",
      slug: "toasties",
      name: "Toasties",
      displayOrder: 1,
      products: [
        {
          id: "product-classic-cheese-toastie",
          categoryId: "category-toasties",
          slug: "classic-cheese-toastie",
          name: "Classic cheese toastie",
          description: "Mature cheddar melted between crisp sourdough.",
          basePriceCents: 650,
          imageUrl: null,
          variantGroups: [],
          addonGroups: [],
        },
        {
          id: "product-melted-mushroom-toastie",
          categoryId: "category-toasties",
          slug: "melted-mushroom-toastie",
          name: "Melted mushroom toastie",
          description: "Garlic mushrooms, cheddar, and a little thyme.",
          basePriceCents: 850,
          imageUrl: null,
          variantGroups: [
            {
              id: "variant-bread",
              productId: "product-melted-mushroom-toastie",
              slug: "bread",
              name: "Bread",
              minSelections: 1,
              maxSelections: 1,
              options: [
                {
                  id: "option-sourdough",
                  variantGroupId: "variant-bread",
                  slug: "sourdough",
                  name: "Sourdough",
                  priceDeltaCents: 0,
                  isDefault: true,
                },
                {
                  id: "option-rye",
                  variantGroupId: "variant-bread",
                  slug: "rye",
                  name: "Rye",
                  priceDeltaCents: 50,
                  isDefault: false,
                },
              ],
            },
          ],
          addonGroups: [
            {
              id: "addon-extras",
              productId: "product-melted-mushroom-toastie",
              slug: "extras",
              name: "Extras",
              minSelections: 0,
              maxSelections: 2,
              addons: [
                {
                  id: "addon-extra-cheese",
                  addonGroupId: "addon-extras",
                  slug: "extra-cheese",
                  name: "Extra cheese",
                  priceDeltaCents: 100,
                },
                {
                  id: "addon-hot-honey",
                  addonGroupId: "addon-extras",
                  slug: "hot-honey",
                  name: "Hot honey",
                  priceDeltaCents: 75,
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "category-sides",
      slug: "sides",
      name: "Sides",
      displayOrder: 2,
      products: [
        {
          id: "product-house-pickles",
          categoryId: "category-sides",
          slug: "house-pickles",
          name: "House pickles",
          description: "A sharp, crunchy side for your toastie.",
          basePriceCents: 300,
          imageUrl: null,
          variantGroups: [],
          addonGroups: [],
        },
      ],
    },
  ],
};

export const getMenu = createServerFn({ method: "GET" }).handler(() => menuFixture);
