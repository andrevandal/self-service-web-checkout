import { createServerFn } from "@tanstack/react-start";
import { asc, eq } from "drizzle-orm";
import * as v from "valibot";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { setKioskCookie } from "./kiosk-cookie.server";
import { serverEnv } from "#/env.server";
import { db } from "#/db/client.server";
import { kiosks } from "#/db/schema";

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

type KioskClaimErrorCode =
  | "invalid_password"
  | "configuration"
  | "invalid_input"
  | "kiosk_not_found"
  | "prefix_taken";

export class KioskClaimError extends Error {
  constructor(
    public readonly code: KioskClaimErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "KioskClaimError";
  }
}

const claimKioskInputSchema = v.object({
  password: v.string(),
  kioskId: v.optional(v.string()),
  name: v.optional(v.string()),
  prefix: v.optional(v.string()),
});

const toKiosk = (row: Kiosk): Kiosk => ({
  id: row.id,
  name: row.name,
  prefix: row.prefix,
});

const passwordDigest = (value: string) => createHash("sha256").update(value).digest();

const passwordsMatch = (provided: string, configured: string) => {
  const providedDigest = passwordDigest(provided);
  const configuredDigest = passwordDigest(configured);
  return timingSafeEqual(providedDigest, configuredDigest);
};

const isUniquePrefixError = (error: unknown) => {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("unique") && message.includes("prefix");
};

const normalizePrefix = (prefix: string) => prefix.trim().toUpperCase();

const generatedPrefixCandidates = (name: string): string[] => {
  const normalized = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!normalized) {return [];}

  const candidates: string[] = [];
  for (let length = 1; length <= Math.min(5, normalized.length); length += 1) {
    candidates.push(normalized.slice(0, length));
  }
  for (let number = 1; number <= 999; number += 1) {
    const suffix = String(number);
    if (suffix.length >= 5) {break;}
    candidates.push(`${normalized.slice(0, 5 - suffix.length)}${suffix}`);
  }
  return candidates;
};

const selectPrefix = async (name: string, requestedPrefix?: string) => {
  if (requestedPrefix !== undefined) {
    const prefix = normalizePrefix(requestedPrefix);
    if (!/^[A-Z0-9]{1,5}$/.test(prefix)) {
      throw new KioskClaimError("invalid_input", "Prefix must be 1-5 letters or digits");
    }
    const existing = await db
      .select({ id: kiosks.id })
      .from(kiosks)
      .where(eq(kiosks.prefix, prefix))
      .limit(1);
    if (existing.length > 0) {
      throw new KioskClaimError("prefix_taken", "That kiosk prefix is already in use");
    }
    return prefix;
  }

  const existingPrefixes = new Set(
    (await db.select({ prefix: kiosks.prefix }).from(kiosks)).map(({ prefix }) => prefix),
  );
  for (const candidate of generatedPrefixCandidates(name)) {
    if (!existingPrefixes.has(candidate)) {return candidate;}
  }
  throw new KioskClaimError("invalid_input", "Unable to derive a unique kiosk prefix");
};

export const listKiosksHandler = async (): Promise<Kiosk[]> => {
  const rows = await db
    .select({ id: kiosks.id, name: kiosks.name, prefix: kiosks.prefix })
    .from(kiosks)
    .orderBy(asc(kiosks.name), asc(kiosks.id));
  return rows.map(toKiosk);
};

export const claimKioskHandler = async (data: ClaimKioskInput): Promise<Kiosk> => {
  const { KIOSK_CLAIM_PASSWORD, KIOSK_COOKIE_SECRET, KIOSK_COOKIE_SECURE } = serverEnv;
  if (!KIOSK_CLAIM_PASSWORD || !KIOSK_COOKIE_SECRET) {
    throw new KioskClaimError("configuration", "Kiosk claim is not configured");
  }
  if (!passwordsMatch(data.password, KIOSK_CLAIM_PASSWORD)) {
    throw new KioskClaimError("invalid_password", "Invalid kiosk claim password");
  }

  if (data.kioskId !== undefined) {
    const rows = await db
      .select({ id: kiosks.id, name: kiosks.name, prefix: kiosks.prefix })
      .from(kiosks)
      .where(eq(kiosks.id, data.kioskId))
      .limit(1);
    const kiosk = rows[0];
    if (!kiosk) {
      throw new KioskClaimError("kiosk_not_found", "Kiosk not found");
    }
    const result = toKiosk(kiosk);
    setKioskCookie(
      { kioskId: result.id, issuedAt: Date.now() },
      KIOSK_COOKIE_SECRET,
      KIOSK_COOKIE_SECURE,
    );
    return result;
  }

  const name = data.name === undefined ? "" : data.name.trim();
  if (!name) {
    throw new KioskClaimError("invalid_input", "Kiosk name is required");
  }
  const prefix = await selectPrefix(name, data.prefix);
  try {
    const rows = await db
      .insert(kiosks)
      .values({ id: randomUUID(), name, prefix })
      .returning({ id: kiosks.id, name: kiosks.name, prefix: kiosks.prefix });
    const kiosk = rows[0];
    if (!kiosk) {
      throw new Error("Kiosk insert did not return a row");
    }
    const result = toKiosk(kiosk);
    setKioskCookie(
      { kioskId: result.id, issuedAt: Date.now() },
      KIOSK_COOKIE_SECRET,
      KIOSK_COOKIE_SECURE,
    );
    return result;
  } catch (error) {
    if (isUniquePrefixError(error)) {
      throw new KioskClaimError("prefix_taken", "That kiosk prefix is already in use");
    }
    throw error;
  }
};

export const listKiosks = createServerFn({ method: "GET" }).handler(listKiosksHandler);

export const claimKiosk = createServerFn({ method: "POST" })
  .validator((input) => v.parse(claimKioskInputSchema, input))
  .handler(({ data }) => claimKioskHandler(data));
