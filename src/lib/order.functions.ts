import { createServerFn } from "@tanstack/react-start";
import type { CreateOrderInput } from "./order.functions.server";
import { createOrderServerHandler } from "./order.functions.server";

export type { CreateOrderInput, CreateOrderResult } from "./order.functions.server";

export const createOrder = createServerFn({ method: "POST" })
  .validator((input: CreateOrderInput) => input)
  .handler(createOrderServerHandler);
