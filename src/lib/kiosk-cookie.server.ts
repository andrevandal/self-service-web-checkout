import { getRequestHeader, setResponseHeader } from "@tanstack/react-start/server";
import { signSignedCookie, verifySignedCookie } from "./signed-cookie.server";

export const KIOSK_COOKIE_NAME = "kiosk_session";

type KioskCookiePayload = {
  kioskId: string;
  issuedAt: number;
};

export const signKioskCookie = (payload: KioskCookiePayload, secret: string): string =>
  signSignedCookie(payload, secret);

const isKioskCookiePayload = (value: unknown): value is KioskCookiePayload => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.kioskId === "string" &&
    payload.kioskId.length > 0 &&
    typeof payload.issuedAt === "number" &&
    Number.isFinite(payload.issuedAt) &&
    Number.isInteger(payload.issuedAt) &&
    payload.issuedAt > 0
  );
};

export const verifyKioskCookie = (token: string, secret: string): KioskCookiePayload | null =>
  verifySignedCookie(token, secret, isKioskCookiePayload);

export const readKioskCookie = (secret: string): KioskCookiePayload | null => {
  const header = getRequestHeader("cookie");
  if (!header) {
    return null;
  }

  for (const part of header.split(";")) {
    const equalsIndex = part.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }
    if (part.slice(0, equalsIndex).trim() !== KIOSK_COOKIE_NAME) {
      continue;
    }
    const token = part.slice(equalsIndex + 1).trim();
    return verifyKioskCookie(token, secret);
  }

  return null;
};

export const setKioskCookie = (
  payload: KioskCookiePayload,
  secret: string,
  secure: boolean,
): void => {
  const token = signKioskCookie(payload, secret);
  const secureAttribute = secure ? "; Secure" : "";
  setResponseHeader(
    "Set-Cookie",
    `${KIOSK_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/${secureAttribute}`,
  );
};

export type { KioskCookiePayload };
