import { createHmac, timingSafeEqual } from "node:crypto";

export const signSignedCookie = (payload: object, secret: string): string => {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
};

export const verifySignedCookie = <T>(
  token: string,
  secret: string,
  isPayload: (value: unknown) => value is T,
): T | null => {
  const segments = token.split(".");
  if (segments.length !== 2) {
    return null;
  }

  const [encodedPayload, encodedSignature] = segments;
  if (!encodedPayload || !encodedSignature) {
    return null;
  }

  const expectedSignature = createHmac("sha256", secret).update(encodedPayload).digest();
  const actualSignature = Buffer.from(encodedSignature, "base64url");
  if (
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    return null;
  }

  try {
    const payload: unknown = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    return isPayload(payload) ? payload : null;
  } catch {
    return null;
  }
};
