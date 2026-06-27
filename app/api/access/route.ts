import { NextRequest, NextResponse } from "next/server";
import {
  accessCookieName,
  createSessionToken,
  getAccessPassword,
  hasValidAccessCookie,
} from "@/lib/access";

export const runtime = "edge";

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
