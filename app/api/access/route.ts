import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const accessCookieName = "switch_ledger_access";
const defaultLocalPassword = "ns2026";
const sessionMaxAge = 60 * 60 * 24 * 30;

type AccessPayload = {
  password?: unknown;
};

export async function GET(request: NextRequest) {
  const authenticated = await hasValidAccessCookie(request);

  return NextResponse.json({ authenticated });
}

export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => ({}))) as AccessPayload;
  const password = typeof payload.password === "string" ? payload.password : "";

  if (password !== getAccessPassword()) {
    return NextResponse.json(
      { authenticated: false, error: "密码不正确" },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(accessCookieName, await createSessionToken(), {
    httpOnly: true,
    maxAge: sessionMaxAge,
    path: "/",
    sameSite: "strict",
    secure: request.nextUrl.protocol === "https:",
  });

  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(accessCookieName, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "strict",
  });

  return response;
}

async function hasValidAccessCookie(request: NextRequest) {
  const cookie = request.cookies.get(accessCookieName)?.value ?? "";
  return cookie === (await createSessionToken());
}

function getAccessPassword() {
  return process.env.APP_ACCESS_PASSWORD || defaultLocalPassword;
}

function getSessionSecret() {
  return process.env.APP_ACCESS_SESSION_SECRET || getAccessPassword();
}

async function createSessionToken() {
  const input = new TextEncoder().encode(
    `${getSessionSecret()}:${getAccessPassword()}:v1`,
  );
  const digest = await crypto.subtle.digest("SHA-256", input);

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
