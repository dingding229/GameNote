import { NextRequest, NextResponse } from "next/server";
import { hasValidAccessCookie } from "@/lib/auth/access";
import { readAppCache, writeAppCache } from "@/lib/ledger/repository";
import { appVersion, compareVersions, latestStableVersion, normalizeVersion } from "@/lib/version";

export const runtime = "nodejs";

const cacheKey = "github-version-check";
const cacheDurationMs = 6 * 60 * 60 * 1000;
const tagsUrl = "https://api.github.com/repos/dingding229/GameNote/tags?per_page=100";

type CachedVersion = {
  latestVersion: string;
  checkedAt: string;
};

export async function GET(request: NextRequest) {
  const now = new Date();
  const cachedEntry = await readAppCache(cacheKey).catch(() => null);
  const cachedVersion = normalizeCachedVersion(cachedEntry?.value);
  const forceRequested = request.nextUrl.searchParams.get("refresh") === "1";
  const force = forceRequested && (await hasValidAccessCookie(request));

  if (!force && cachedVersion && cachedEntry && cachedEntry.expiresAt > now.toISOString()) {
    return versionResponse(cachedVersion);
  }

  try {
    const response = await fetch(tagsUrl, {
      cache: "no-store",
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": `GameNote/${appVersion}`,
        "x-github-api-version": "2022-11-28",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
    const payload = (await response.json()) as Array<{ name?: unknown }>;
    const latestVersion = latestStableVersion(
      Array.isArray(payload)
        ? payload.flatMap((tag) => (typeof tag.name === "string" ? [tag.name] : []))
        : [],
    );
    if (!latestVersion) throw new Error("GitHub 未返回正式版本标签");
    const checkedAt = now.toISOString();
    const value = { latestVersion, checkedAt } satisfies CachedVersion;
    await writeAppCache(
      cacheKey,
      value,
      new Date(now.getTime() + cacheDurationMs).toISOString(),
    ).catch((error) => console.error("版本检查缓存写入失败", error));
    return versionResponse(value);
  } catch (error) {
    console.error("版本检查失败", error);
    if (cachedVersion) return versionResponse(cachedVersion, true);
    return NextResponse.json(
      {
        currentVersion: appVersion,
        latestVersion: "",
        updateAvailable: false,
        checkedAt: "",
        stale: true,
        error: "暂时无法连接版本服务",
      },
      { headers: { "cache-control": "no-store" } },
    );
  }
}

function normalizeCachedVersion(value: unknown): CachedVersion | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<CachedVersion>;
  const latestVersion =
    typeof source.latestVersion === "string" ? normalizeVersion(source.latestVersion) : null;
  if (!latestVersion || typeof source.checkedAt !== "string") return null;
  return { latestVersion, checkedAt: source.checkedAt };
}

function versionResponse(value: CachedVersion, stale = false) {
  return NextResponse.json(
    {
      currentVersion: appVersion,
      latestVersion: value.latestVersion,
      updateAvailable: compareVersions(value.latestVersion, appVersion) > 0,
      checkedAt: value.checkedAt,
      stale,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
