export const accessCookieName = "switch_ledger_access";
export const defaultLocalPassword = "ns2026";

export async function createAccessSessionToken(
  password: string,
  secret: string,
) {
  const input = new TextEncoder().encode(`${secret}:${password}:v1`);
  const digest = await crypto.subtle.digest("SHA-256", input);

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
