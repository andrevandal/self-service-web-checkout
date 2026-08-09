import { createServerFn } from "@tanstack/react-start";
import type { AdvanceOrderInput, ClaimStaffSessionInput } from "./kitchen.functions.server";
import {
  advanceOrderServerHandler,
  claimStaffSessionServerHandler,
  listActiveOrdersHandler,
} from "./kitchen.functions.server";

export type {
  AdvanceOrderInput,
  ClaimStaffSessionInput,
  KitchenOrder,
  KitchenOrderErrorCode,
  KitchenOrderEvent,
  StaffSession,
  StaffSessionErrorCode,
} from "./kitchen.functions.server";

export const claimStaffSession = createServerFn({ method: "POST" })
  .validator((input: ClaimStaffSessionInput) => input)
  .handler(claimStaffSessionServerHandler);

export const listActiveOrders = createServerFn({ method: "GET" }).handler(listActiveOrdersHandler);

export const advanceOrder = createServerFn({ method: "POST" })
  .validator((input: AdvanceOrderInput) => input)
  .handler(advanceOrderServerHandler);
