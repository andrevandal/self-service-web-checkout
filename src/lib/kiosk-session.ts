import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, setResponseHeader } from "@tanstack/react-start/server";

export type Kiosk = {
  id: string;
  name: string;
  prefix: string;
};

export type KioskSession = Kiosk | null;

export type KioskClaimInput =
  | { password: string; kioskId: string }
  | { password: string; name: string; prefix?: string };

export type KioskClaimErrorCode =
  | "invalid_password"
  | "configuration"
  | "invalid_input"
  | "kiosk_not_found"
  | "prefix_taken";

export class KioskClaimError extends Error {
  readonly code: KioskClaimErrorCode;

  constructor(code: KioskClaimErrorCode) {
    super(code);
    this.name = "KioskClaimError";
    this.code = code;
  }
}

const SETUP_PASSWORD = "warm-melted";
const SESSION_COOKIE = "kiosk_session";
const kiosks = new Map<string, Kiosk>([
  ["front-counter", { id: "front-counter", name: "Front counter", prefix: "A" }],
  ["drive-through", { id: "drive-through", name: "Drive through", prefix: "D" }],
]);
const sessions = new Map<string, string>();

export const normalizePrefix = (value: string): string | null => {
  const prefix = value.trim().toUpperCase();
  return /^[A-Z0-9]{1,5}$/.test(prefix) ? prefix : null;
};

const readCookie = (name: string): string | null => {
  const header = getRequestHeader("cookie");
  if (!header) {
    return null;
  }

  for (const part of header.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (key === name) {
      return valueParts.join("=") || null;
    }
  }

  return null;
};

const nextPrefix = (): string => {
  for (const code of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    if (![...kiosks.values()].some((kiosk) => kiosk.prefix === code)) {
      return code;
    }
  }
  throw new KioskClaimError("configuration");
};

const setSessionCookie = (kiosk: Kiosk) => {
  const token = crypto.randomUUID();
  sessions.set(token, kiosk.id);
  setResponseHeader("Set-Cookie", `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`);
};

export const getKioskSession = createServerFn({ method: "GET" }).handler((): KioskSession => {
  const kioskId = readCookie(SESSION_COOKIE);
  return kioskId ? (kiosks.get(sessions.get(kioskId) ?? "") ?? null) : null;
});

export const listKiosks = createServerFn({ method: "GET" }).handler((): Kiosk[] => {
  return [...kiosks.values()];
});

export const claimKiosk = createServerFn({ method: "POST" })
  .validator((input: KioskClaimInput) => input)
  .handler(({ data }): Kiosk => {
    if (data.password !== SETUP_PASSWORD) {
      throw new KioskClaimError("invalid_password");
    }

    if ("kioskId" in data) {
      const kiosk = kiosks.get(data.kioskId);
      if (!kiosk) {
        throw new KioskClaimError("kiosk_not_found");
      }
      setSessionCookie(kiosk);
      return kiosk;
    }

    const name = data.name.trim();
    if (!name) {
      throw new KioskClaimError("invalid_input");
    }

    const prefix = data.prefix === undefined ? nextPrefix() : normalizePrefix(data.prefix);
    if (!prefix) {
      throw new KioskClaimError("invalid_input");
    }
    if ([...kiosks.values()].some((kiosk) => kiosk.prefix === prefix)) {
      throw new KioskClaimError("prefix_taken");
    }

    const kiosk: Kiosk = {
      id: crypto.randomUUID(),
      name,
      prefix,
    };
    kiosks.set(kiosk.id, kiosk);
    setSessionCookie(kiosk);
    return kiosk;
  });
