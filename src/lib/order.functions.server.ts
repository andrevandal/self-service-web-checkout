// Server-only order handlers are kept behind the client-safe function wrapper.
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as v from "valibot";
import { readKioskCookie } from "./kiosk-cookie.server";
import { serverEnv } from "#/env.server";
import { db } from "#/db/client.server";
import {
  addonGroups,
  addons,
  categories,
  kiosks,
  orderItemAddons,
  orderItemVariants,
  orderItems,
  orders,
  products,
  variantGroups,
  variantOptions,
} from "#/db/schema";

export type CreateOrderInput = {
  lines: Array<{
    productId: string;
    quantity: number;
    variantOptionIds: string[];
    addonIds: string[];
  }>;
};

type OrderVariantSnapshot = {
  id: string;
  optionId: string;
  optionName: string;
  priceDeltaCents: number;
};

type OrderAddonSnapshot = {
  id: string;
  addonId: string;
  addonName: string;
  priceDeltaCents: number;
};

type OrderItemSnapshot = {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  variants: OrderVariantSnapshot[];
  addons: OrderAddonSnapshot[];
};

export type CreateOrderResult = {
  id: string;
  kioskId: string;
  status: "payment_pending";
  orderNumber: null;
  subtotalCents: number;
  totalAmountCents: number;
  items: OrderItemSnapshot[];
};

export type CreateOrderErrorCode =
  | "configuration"
  | "kiosk_identity"
  | "invalid_input"
  | "catalog_unavailable"
  | "selection_invalid";

export class CreateOrderError extends Error {
  constructor(
    public readonly code: CreateOrderErrorCode,
    detail: string,
  ) {
    // `message` is the only Error property TanStack Start's RPC serializer
    // preserves across the client/server boundary (see
    // @tanstack/router-core's ShallowErrorPlugin). Using `code` as the
    // message lets client-side error-copy lookups key off `error.message`
    // after deserialization; `detail` stays available server-side.
    super(code);
    this.name = "CreateOrderError";
    this.cause = detail;
  }
}

const identifierSchema = v.pipe(v.string(), v.minLength(1));
const createOrderInputSchema = v.object({
  lines: v.pipe(
    v.array(
      v.object({
        productId: identifierSchema,
        quantity: v.pipe(v.number(), v.integer(), v.minValue(1)),
        variantOptionIds: v.array(identifierSchema),
        addonIds: v.array(identifierSchema),
      }),
    ),
    v.minLength(1),
  ),
});

const validateInput = (input: unknown): CreateOrderInput => {
  const result = v.safeParse(createOrderInputSchema, input);
  if (!result.success) {
    throw new CreateOrderError("invalid_input", "Cart must contain valid line items");
  }
  return result.output as CreateOrderInput;
};

const duplicateIds = (ids: string[]) => new Set(ids).size !== ids.length;

export const createOrderHandler = async (input: CreateOrderInput): Promise<CreateOrderResult> => {
  const data = validateInput(input);
  const secret = serverEnv.KIOSK_COOKIE_SECRET;
  if (!secret) {
    throw new CreateOrderError("configuration", "Kiosk cookie secret is not configured");
  }

  const cookie = readKioskCookie(secret);
  if (!cookie) {
    throw new CreateOrderError("kiosk_identity", "A valid kiosk session is required");
  }

  return db.transaction(async (tx) => {
    const kioskRows = await tx
      .select({ id: kiosks.id })
      .from(kiosks)
      .where(eq(kiosks.id, cookie.kioskId))
      .limit(1);
    if (!kioskRows[0]) {
      throw new CreateOrderError("kiosk_identity", "Kiosk session no longer exists");
    }

    const lineSnapshots: Array<{
      productId: string;
      productName: string;
      quantity: number;
      unitPriceCents: number;
      lineTotalCents: number;
      variants: Array<{
        optionId: string;
        optionName: string;
        priceDeltaCents: number;
      }>;
      addons: Array<{
        addonId: string;
        addonName: string;
        priceDeltaCents: number;
      }>;
    }> = [];

    for (const line of data.lines) {
      const productRows = await tx
        .select({
          id: products.id,
          name: products.name,
          basePriceCents: products.basePriceCents,
        })
        .from(products)
        .innerJoin(categories, eq(products.categoryId, categories.id))
        .where(
          and(
            eq(products.id, line.productId),
            eq(products.isAvailable, true),
            eq(categories.isActive, true),
          ),
        )
        .limit(1);
      const product = productRows[0];
      if (!product) {
        throw new CreateOrderError("catalog_unavailable", "Product is not available");
      }

      if (duplicateIds(line.variantOptionIds) || duplicateIds(line.addonIds)) {
        throw new CreateOrderError("selection_invalid", "Modifier selections cannot repeat");
      }

      const variantGroupRows = await tx
        .select()
        .from(variantGroups)
        .where(eq(variantGroups.productId, product.id));
      const variantGroupIds = variantGroupRows.map((group) => group.id);
      const variantOptionRows =
        variantGroupIds.length === 0
          ? []
          : await tx
              .select()
              .from(variantOptions)
              .where(inArray(variantOptions.variantGroupId, variantGroupIds));
      const variantOptionsById = new Map(variantOptionRows.map((option) => [option.id, option]));

      if (line.variantOptionIds.some((id) => !variantOptionsById.has(id))) {
        throw new CreateOrderError("selection_invalid", "Variant selection is not valid");
      }

      const selectedVariants = line.variantOptionIds.map((id) => variantOptionsById.get(id)!);
      for (const group of variantGroupRows) {
        const count = selectedVariants.filter(
          (option) => option.variantGroupId === group.id,
        ).length;
        if (count < group.minSelections || count > group.maxSelections) {
          throw new CreateOrderError("selection_invalid", "Variant selection count is not valid");
        }
      }

      const addonGroupRows = await tx
        .select()
        .from(addonGroups)
        .where(eq(addonGroups.productId, product.id));
      const addonGroupIds = addonGroupRows.map((group) => group.id);
      const addonRows =
        addonGroupIds.length === 0
          ? []
          : await tx.select().from(addons).where(inArray(addons.addonGroupId, addonGroupIds));
      const addonsById = new Map(addonRows.map((addon) => [addon.id, addon]));

      if (line.addonIds.some((id) => !addonsById.has(id))) {
        throw new CreateOrderError("selection_invalid", "Addon selection is not valid");
      }
      const selectedAddons = line.addonIds.map((id) => addonsById.get(id)!);
      if (selectedAddons.some((addon) => !addon.isActive)) {
        throw new CreateOrderError("catalog_unavailable", "Addon is not available");
      }
      for (const group of addonGroupRows) {
        const count = selectedAddons.filter((addon) => addon.addonGroupId === group.id).length;
        if (
          count < group.minSelections ||
          (group.maxSelections !== null && count > group.maxSelections)
        ) {
          throw new CreateOrderError("selection_invalid", "Addon selection count is not valid");
        }
      }

      const variantSnapshots = selectedVariants.map((option) => ({
        optionId: option.id,
        optionName: option.name,
        priceDeltaCents: option.priceDeltaCents,
      }));
      const addonSnapshots = selectedAddons.map((addon) => ({
        addonId: addon.id,
        addonName: addon.name,
        priceDeltaCents: addon.priceDeltaCents,
      }));
      const unitPriceCents = product.basePriceCents;
      const modifierDeltaCents =
        variantSnapshots.reduce((sum, option) => sum + option.priceDeltaCents, 0) +
        addonSnapshots.reduce((sum, addon) => sum + addon.priceDeltaCents, 0);

      lineSnapshots.push({
        productId: product.id,
        productName: product.name,
        quantity: line.quantity,
        unitPriceCents,
        lineTotalCents: (unitPriceCents + modifierDeltaCents) * line.quantity,
        variants: variantSnapshots,
        addons: addonSnapshots,
      });
    }

    const subtotalCents = lineSnapshots.reduce((sum, line) => sum + line.lineTotalCents, 0);
    const orderId = randomUUID();
    await tx.insert(orders).values({
      id: orderId,
      kioskId: cookie.kioskId,
      status: "payment_pending",
      orderNumber: null,
      subtotalCents,
      totalAmountCents: subtotalCents,
      paidAt: null,
    });

    const items: OrderItemSnapshot[] = [];
    for (const line of lineSnapshots) {
      const itemId = randomUUID();
      await tx.insert(orderItems).values({
        id: itemId,
        orderId,
        productId: line.productId,
        productName: line.productName,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
      });

      const variants: OrderVariantSnapshot[] = [];
      for (const variant of line.variants) {
        const id = randomUUID();
        await tx.insert(orderItemVariants).values({
          id,
          orderItemId: itemId,
          variantOptionId: variant.optionId,
          optionName: variant.optionName,
          priceDeltaCents: variant.priceDeltaCents,
        });
        variants.push({ id, ...variant });
      }

      const addons: OrderAddonSnapshot[] = [];
      for (const addon of line.addons) {
        const id = randomUUID();
        await tx.insert(orderItemAddons).values({
          id,
          orderItemId: itemId,
          addonId: addon.addonId,
          addonName: addon.addonName,
          priceDeltaCents: addon.priceDeltaCents,
        });
        addons.push({ id, ...addon });
      }

      items.push({
        id: itemId,
        productId: line.productId,
        productName: line.productName,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        variants,
        addons,
      });
    }

    return {
      id: orderId,
      kioskId: cookie.kioskId,
      status: "payment_pending",
      orderNumber: null,
      subtotalCents,
      totalAmountCents: subtotalCents,
      items,
    };
  });
};

export const createOrderServerHandler = ({
  data,
}: {
  data: CreateOrderInput;
}): Promise<CreateOrderResult> => createOrderHandler(data);
