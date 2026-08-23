import { NextRequest, NextResponse } from "next/server";
import { hasValidAccessCookie } from "@/lib/auth/access";
import { readAppSettings } from "@/lib/ledger/repository";

export const runtime = "nodejs";

type RequestPayload = {
  action?: unknown;
  baseUrl?: unknown;
  model?: unknown;
  apiKey?: unknown;
};

export async function POST(request: NextRequest) {
  if (!(await hasValidAccessCookie(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [payload, saved] = await Promise.all([
    request.json().catch(() => ({})) as Promise<RequestPayload>,
    readAppSettings(),
  ]);
  const action = payload.action === "models" || payload.action === "test" ? payload.action : "";
  const baseUrl = (typeof payload.baseUrl === "string" ? payload.baseUrl : saved.aiBaseUrl)
    .trim()
    .replace(/\/+$/, "");
  const model = (typeof payload.model === "string" ? payload.model : saved.aiModel).trim();
  const apiKey =
    typeof payload.apiKey === "string" && payload.apiKey.trim()
      ? payload.apiKey.trim()
      : saved.aiApiKey || process.env.OPENAI_API_KEY || "";

  if (!action || !baseUrl.toLowerCase().startsWith("https://") || !apiKey) {
    return NextResponse.json({ error: "请填写有效的 HTTPS API 地址和 API Key" }, { status: 400 });
  }

  try {
    if (action === "models") {
      const response = await fetch(`${baseUrl}/models`, {
        headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      const result = (await response.json().catch(() => ({}))) as {
        data?: Array<{ id?: unknown }>;
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(result.error?.message || `获取模型失败（HTTP ${response.status}）`);
      const models = Array.from(
        new Set(
          (result.data || [])
            .map((item) => (typeof item.id === "string" ? item.id.trim() : ""))
            .filter(Boolean),
        ),
      ).sort((left, right) => left.localeCompare(right));
      return NextResponse.json({ models });
    }

    if (!model) return NextResponse.json({ error: "请先选择或填写模型" }, { status: 400 });
    const response = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model, input: "Reply with OK.", max_output_tokens: 16 }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const result = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    if (!response.ok)
      throw new Error(result.error?.message || `接口测试失败（HTTP ${response.status}）`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI 接口请求失败" },
      { status: 502 },
    );
  }
}
