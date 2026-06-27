import type { NextRequest } from "next/server";
import {
  accessCookieName,
  createAccessSessionToken,
  defaultLocalPassword,
} from "@/lib/access-token";

export { accessCookieName };

export function getAccessPassword() {
  return process.env.APP_ACCESS_PASSWORD || defaultLocalPassword;
}

export function getSessionSecret() {
  return process.env.APP_ACCESS_SESSION_SECRET || getAccessPassword();
}

export async function hasValidAccessCookie(request: NextRequest) {
  const cookie = request.cookies.get(accessCookieName)?.value ?? "";
  return cookie === (await createSessionToken());
}

export async function createSessionToken() {
  return createAccessSessionToken(getAccessPassword(), getSessionSecret());
}
