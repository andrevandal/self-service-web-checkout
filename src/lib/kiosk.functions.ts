import { createServerFn } from "@tanstack/react-start";
import * as v from "valibot";
import {
  claimKioskServerHandler,
  getKioskSessionHandler,
  listKiosksHandler,
  verifySetupPasswordHandler,
} from "./kiosk.functions.server";

export type Kiosk = {
  id: string;
  name: string;
  prefix: string;
};

export type ClaimKioskInput = {
  password: string;
  kioskId?: string;
  name?: string;
  prefix?: string;
};

const claimKioskInputSchema = v.object({
  password: v.string(),
  kioskId: v.optional(v.string()),
  name: v.optional(v.string()),
  prefix: v.optional(v.string()),
});

export const listKiosks = createServerFn({ method: "GET" }).handler(listKiosksHandler);

export const claimKiosk = createServerFn({ method: "POST" })
  .validator((input) => v.parse(claimKioskInputSchema, input))
  .handler(claimKioskServerHandler);

export const getKioskSession = createServerFn({ method: "GET" }).handler(getKioskSessionHandler);

export const verifySetupPassword = createServerFn({ method: "POST" })
  .validator((input: { password: string }) => input)
  .handler(({ data }) => verifySetupPasswordHandler(data));
