import { createHmac, timingSafeEqual } from "node:crypto";
import { getRequestHeader, setResponseHeader } from "@tanstack/react-start/server";

export const KIOSK_COOKIE_NAME = "kiosk_session";

type KioskCookiePayload = {
  kioskId: string;
  issuedAt: number;
};

const encode = (value: string) => Buffer.from(value).toString("base64url");

const decode = (value: string) => Buffer.from(value, "base64url").toString("utf8");

export const signKioskCookie = (payload: KioskCookiePayload, secret: string): string => {
  const encodedPayload = encode(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
};

const isKioskCookiePayload = (value: unknown): value is KioskCookiePayload => {
  if (typeof value !== "object" || value === null) {return false;}
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

export const verifyKioskCookie = (token: string, secret: string): KioskCookiePayload | null => {
  const segments = token.split(".");
  if (segments.length !== 2) {return null;}

  const [encodedPayload, encodedSignature] = segments;
  if (!encodedPayload || !encodedSignature) {return null;}

  const expectedSignature = createHmac("sha256", secret).update(encodedPayload).digest();
  const actualSignature = Buffer.from(encodedSignature, "base64url");
  if (
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    return null;
  }

  try {
    const payload: unknown = JSON.parse(decode(encodedPayload));
    return isKioskCookiePayload(payload) ? payload : null;
  } catch {
    return null;
  }
};

export const readKioskCookie = (secret: string): KioskCookiePayload | null => {
  const header = getRequestHeader("cookie");
  if (!header) {return null;}

  for (const part of header.split(";")) {
    const equalsIndex = part.indexOf("=");
    if (equalsIndex === -1) {continue;}
    if (part.slice(0, equalsIndex).trim() !== KIOSK_COOKIE_NAME) {continue;}
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
