export const accessCookieName = "switch_ledger_access";
export const defaultLocalPassword = "ns2026";
export const defaultSessionMaxAge = 60 * 60 * 24 * 30;

export async function createAccessSessionToken(
  password: string,
  secret: string,
  maxAge = defaultSessionMaxAge,
) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: "switch-ledger",
    iat: now,
    exp: now + maxAge,
    pwd: await sha256Base64Url(`password:${password}`),
  };
  const unsigned = `${base64UrlEncodeJson(header)}.${base64UrlEncodeJson(payload)}`;
  const signature = await hmacSign(unsigned, secret);

  return `${unsigned}.${signature}`;
}

export async function verifyAccessSessionToken(
  token: string,
  password: string,
  secret: string,
) {
  const [encodedHeader, encodedPayload, signature] = token.split(".");

  if (!encodedHeader || !encodedPayload || !signature) {
    return false;
  }

  const expectedSignature = await hmacSign(`${encodedHeader}.${encodedPayload}`, secret);
  if (!timingSafeEqual(signature, expectedSignature)) {
    return false;
  }

  const payload = parseBase64UrlJson(encodedPayload) as {
    sub?: unknown;
    exp?: unknown;
    pwd?: unknown;
  } | null;

  if (!payload || payload.sub !== "switch-ledger") {
    return false;
  }

  if (typeof payload.exp !== "number" || payload.exp <= Date.now() / 1000) {
    return false;
  }

  return payload.pwd === (await sha256Base64Url(`password:${password}`));
}

async function hmacSign(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );

  return bytesToBase64Url(new Uint8Array(signature));
}

async function sha256Base64Url(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesToBase64Url(new Uint8Array(digest));
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
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }

  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return result === 0;
}
