import { NextRequest, NextResponse } from "next/server";
import {
  accessCookieName,
  createSessionToken,
  getPasswordChangeIdentity,
  getSignedInIdentity,
} from "@/lib/auth/access";
import {
  createRegisteredUser,
  getRegisteredUser,
  updateRegisteredUserPassword,
} from "@/lib/ledger/repository";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  generateTemporaryPassword,
  removePasswordRecoveryFile,
  writePasswordRecoveryFile,
} from "@/lib/auth/password-recovery";
import {
  checkLoginRateLimit,
  clearFailedLogins,
  loginRateLimitKey,
  recordFailedLogin,
} from "@/lib/auth/login-rate-limit";

export const runtime = "nodejs";
const sessionMaxAge = 60 * 60 * 24 * 30;
type AccessPayload = {
  action?: unknown;
  username?: unknown;
  password?: unknown;
  newPassword?: unknown;
};

export async function GET(request: NextRequest) {
  const [identity, owner] = await Promise.all([
    getSignedInIdentity(request).catch(() => null),
    getRegisteredUser(),
  ]);
  return NextResponse.json({
    authenticated: Boolean(identity),
    registrationOpen: !owner,
    passwordChangeRequired: Boolean(identity && owner?.passwordChangeRequired),
    username: identity?.username || null,
  });
}

export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => ({}))) as AccessPayload;
  const action =
    payload.action === "register"
      ? "register"
      : payload.action === "recover"
        ? "recover"
        : payload.action === "complete-recovery"
          ? "complete-recovery"
          : "login";
  const username = typeof payload.username === "string" ? payload.username.trim() : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  const newPassword = typeof payload.newPassword === "string" ? payload.newPassword : "";

  if (action === "complete-recovery") {
    if (!(await getPasswordChangeIdentity(request)))
      return NextResponse.json({ error: "当前登录不能修改临时密码" }, { status: 401 });
    if (newPassword.length < 8 || newPassword.length > 128)
      return NextResponse.json({ error: "新密码需为 8-128 位" }, { status: 400 });
    try {
      await removePasswordRecoveryFile();
    } catch (error) {
      console.error("删除临时密码文件失败", error);
      return NextResponse.json(
        { error: "无法删除临时密码文件，请检查数据目录权限" },
        { status: 500 },
      );
    }
    await updateRegisteredUserPassword(await hashPassword(newPassword));
    const response = NextResponse.json({ updated: true, signedOut: true });
    clearAccessCookie(response, request);
    return response;
  }

  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username))
    return NextResponse.json({ error: "账号需为 3-32 位字母、数字或 ._-" }, { status: 400 });
  if (action !== "recover" && (password.length < 8 || password.length > 128))
    return NextResponse.json({ error: "密码需为 8-128 位" }, { status: 400 });

  const clientIp =
    request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "";
  const rateLimitKey = loginRateLimitKey(clientIp.trim(), username);
  const rateLimit = checkLoginRateLimit(rateLimitKey);
  if (!rateLimit.allowed)
    return NextResponse.json(
      { error: "登录尝试过多，请稍后再试" },
      { status: 429, headers: { "retry-after": String(rateLimit.retryAfter) } },
    );

  let user = await getRegisteredUser();
  if (action === "recover") {
    if (!user || user.username !== username) {
      recordFailedLogin(rateLimitKey);
      return NextResponse.json({ error: "无法为该账号生成临时密码" }, { status: 401 });
    }
    const temporaryPassword = generateTemporaryPassword();
    const temporaryPasswordHash = await hashPassword(temporaryPassword);
    try {
      await writePasswordRecoveryFile(temporaryPassword);
      await updateRegisteredUserPassword(temporaryPasswordHash, true);
    } catch (error) {
      await removePasswordRecoveryFile().catch(() => undefined);
      console.error("生成临时密码文件失败", error);
      return NextResponse.json(
        { error: "无法生成临时密码文件，请检查数据目录权限" },
        { status: 500 },
      );
    }
    clearFailedLogins(rateLimitKey);
    const response = NextResponse.json({ recoveryCreated: true, fileName: "password" });
    clearAccessCookie(response, request);
    return response;
  }
  if (action === "register") {
    if (user) return NextResponse.json({ error: "管理员账号已注册" }, { status: 409 });
    user = {
      id: "owner",
      username,
      passwordHash: await hashPassword(password),
      sessionVersion: 1,
      passwordChangeRequired: false,
    };
    try {
      await createRegisteredUser(user);
    } catch {
      return NextResponse.json({ error: "管理员账号已注册" }, { status: 409 });
    }
  } else if (
    !user ||
    user.username !== username ||
    !(await verifyPassword(password, user.passwordHash))
  ) {
    recordFailedLogin(rateLimitKey);
    return NextResponse.json({ error: "账号或密码不正确" }, { status: 401 });
  }

  clearFailedLogins(rateLimitKey);

  const response = NextResponse.json({
    authenticated: true,
    username: user.username,
    passwordChangeRequired: user.passwordChangeRequired,
  });
  response.cookies.set(accessCookieName, await createSessionToken(user), {
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

function clearAccessCookie(response: NextResponse, request: NextRequest) {
  response.cookies.set(accessCookieName, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "strict",
    secure: request.nextUrl.protocol === "https:",
  });
}
