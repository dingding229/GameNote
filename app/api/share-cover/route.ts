import { NextRequest, NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const runtime = "nodejs";
const maxImageBytes = 15 * 1024 * 1024;

export async function GET(request: NextRequest) {
  const value = request.nextUrl.searchParams.get("url");
  let url: URL;

  try {
    url = new URL(value || "");
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    return NextResponse.json({ error: "invalid image URL" }, { status: 400 });
  }

  try {
    if (!(await isPublicImageUrl(url))) {
      return NextResponse.json({ error: "image host unavailable" }, { status: 400 });
    }

    const response = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 GameNote/1.0" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    const contentType = response.headers.get("content-type") || "";

    if (!response.ok || !contentType.startsWith("image/")) {
      return NextResponse.json({ error: "image unavailable" }, { status: 502 });
    }

    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > maxImageBytes) {
      return NextResponse.json({ error: "image too large" }, { status: 413 });
    }

    const image = await response.arrayBuffer();
    if (image.byteLength > maxImageBytes) {
      return NextResponse.json({ error: "image too large" }, { status: 413 });
    }

    return new NextResponse(image, {
      headers: {
        "cache-control": "public, max-age=86400",
        "content-type": contentType,
      },
    });
  } catch {
    return NextResponse.json({ error: "image unavailable" }, { status: 502 });
  }
}

async function isPublicImageUrl(url: URL) {
  if (url.username || url.password || url.port) {
    return false;
  }

  try {
    const addresses = await lookup(url.hostname, { all: true });
    return addresses.length > 0 && addresses.every(({ address }) => isPublicAddress(address));
  } catch {
    return false;
  }
}

function isPublicAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }

  const normalized = address.toLowerCase();
  const mappedIpv4 = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (mappedIpv4) {
    return isPublicAddress(mappedIpv4);
  }

  return !(
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}
