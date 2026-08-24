import { timingSafeEqual } from "node:crypto";

const minimumResetTokenLength = 16;

export function isPasswordResetEnabled() {
  return configuredResetToken().length >= minimumResetTokenLength;
}

export function verifyPasswordResetToken(candidate: string) {
  const configured = configuredResetToken();
  const supplied = candidate.trim();
  if (configured.length < minimumResetTokenLength || supplied.length > 256) return false;
  const expectedBuffer = Buffer.from(configured, "utf8");
  const suppliedBuffer = Buffer.from(supplied, "utf8");
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

function configuredResetToken() {
  return (process.env.GAMENOTE_PASSWORD_RESET_TOKEN || "").trim();
}
