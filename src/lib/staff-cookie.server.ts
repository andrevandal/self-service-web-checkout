import { getRequestHeader, setResponseHeader } from "@tanstack/react-start/server";
import { signSignedCookie, verifySignedCookie } from "./signed-cookie.server";

export const STAFF_COOKIE_NAME = "staff_session";

export type StaffCookiePayload = {
  issuedAt: number;
};

const isStaffCookiePayload = (value: unknown): value is StaffCookiePayload => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  return (
    Object.keys(payload).length === 1 &&
    typeof payload.issuedAt === "number" &&
    Number.isFinite(payload.issuedAt) &&
    Number.isInteger(payload.issuedAt) &&
    payload.issuedAt > 0
  );
};

export const signStaffCookie = (payload: StaffCookiePayload, secret: string): string =>
  signSignedCookie(payload, secret);

export const verifyStaffCookie = (token: string, secret: string): StaffCookiePayload | null =>
  verifySignedCookie(token, secret, isStaffCookiePayload);

export const readStaffCookie = (secret: string): StaffCookiePayload | null => {
  const header = getRequestHeader("cookie");
  if (!header) {
    return null;
  }

  for (const part of header.split(";")) {
    const equalsIndex = part.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }
    if (part.slice(0, equalsIndex).trim() !== STAFF_COOKIE_NAME) {
      continue;
    }
    const token = part.slice(equalsIndex + 1).trim();
    return verifyStaffCookie(token, secret);
  }

  return null;
};

export const setStaffCookie = (
  payload: StaffCookiePayload,
  secret: string,
  secure: boolean,
): void => {
  const token = signStaffCookie(payload, secret);
  const secureAttribute = secure ? "; Secure" : "";
  setResponseHeader(
    "Set-Cookie",
    `${STAFF_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/${secureAttribute}`,
  );
};
