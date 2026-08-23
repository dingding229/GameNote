import { describe, expect, it } from "vitest";
import { createAccessSessionToken, verifyAccessSessionToken } from "../lib/auth/session-token";

const secret = "test-secret-that-is-long-enough-for-session-token-tests";

describe("session token", () => {
  it("round-trips the session version", async () => {
    const identity = { id: "owner", username: "admin", sessionVersion: 3 };
    const token = await createAccessSessionToken(identity, secret, 60);
    await expect(verifyAccessSessionToken(token, secret)).resolves.toEqual(identity);
  });

  it("rejects a modified token", async () => {
    const token = await createAccessSessionToken(
      { id: "owner", username: "admin", sessionVersion: 1 },
      secret,
      60,
    );
    await expect(verifyAccessSessionToken(`${token.slice(0, -1)}x`, secret)).resolves.toBeNull();
  });
});
