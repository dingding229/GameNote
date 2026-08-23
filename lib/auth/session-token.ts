export const accessCookieName = "switch_ledger_access";
export const defaultSessionMaxAge = 60 * 60 * 24 * 30;

export type AccessIdentity = { id: string; username: string; sessionVersion: number };

export async function createAccessSessionToken(
  identity: AccessIdentity,
  secret: string,
  maxAge = defaultSessionMaxAge,
) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: identity.id,
    username: identity.username,
    sessionVersion: identity.sessionVersion,
    iat: now,
    exp: now + maxAge,
  };
  const unsigned = `${base64UrlEncodeJson(header)}.${base64UrlEncodeJson(payload)}`;
  return `${unsigned}.${await hmacSign(unsigned, secret)}`;
}

export async function verifyAccessSessionToken(token: string, secret: string) {
  const [encodedHeader, encodedPayload, signature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !signature) return null;

  const expected = await hmacSign(`${encodedHeader}.${encodedPayload}`, secret);
  if (!timingSafeEqual(signature, expected)) return null;

  const payload = parseBase64UrlJson(encodedPayload) as {
    sub?: unknown;
    username?: unknown;
    sessionVersion?: unknown;
    exp?: unknown;
  } | null;
  if (
    !payload ||
    typeof payload.sub !== "string" ||
    typeof payload.username !== "string" ||
    typeof payload.sessionVersion !== "number" ||
    typeof payload.exp !== "number" ||
    payload.exp <= Date.now() / 1000
  )
    return null;

  return {
    id: payload.sub,
    username: payload.username,
    sessionVersion: payload.sessionVersion,
  } satisfies AccessIdentity;
}

async function hmacSign(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

function base64UrlEncodeJson(value: unknown) {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function parseBase64UrlJson(value: string) {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))) as unknown;
  } catch {
    return null;
  }
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}
