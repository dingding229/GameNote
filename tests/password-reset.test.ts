import { afterEach, describe, expect, it } from "vitest";
import { isPasswordResetEnabled, verifyPasswordResetToken } from "../lib/auth/password-reset";

const originalResetToken = process.env.GAMENOTE_PASSWORD_RESET_TOKEN;

afterEach(() => {
  if (originalResetToken === undefined) delete process.env.GAMENOTE_PASSWORD_RESET_TOKEN;
  else process.env.GAMENOTE_PASSWORD_RESET_TOKEN = originalResetToken;
});

describe("password reset token", () => {
  it("stays disabled for a missing or short server token", () => {
    delete process.env.GAMENOTE_PASSWORD_RESET_TOKEN;
    expect(isPasswordResetEnabled()).toBe(false);
    process.env.GAMENOTE_PASSWORD_RESET_TOKEN = "too-short";
    expect(isPasswordResetEnabled()).toBe(false);
    expect(verifyPasswordResetToken("too-short")).toBe(false);
  });

  it("uses an exact, timing-safe comparison for an enabled token", () => {
    process.env.GAMENOTE_PASSWORD_RESET_TOKEN = "temporary-reset-token-123456";
    expect(isPasswordResetEnabled()).toBe(true);
    expect(verifyPasswordResetToken("temporary-reset-token-123456")).toBe(true);
    expect(verifyPasswordResetToken("temporary-reset-token-654321")).toBe(false);
  });
});
