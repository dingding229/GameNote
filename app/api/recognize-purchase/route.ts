import { NextRequest, NextResponse } from "next/server";
import { hasValidAccessCookie } from "@/lib/auth/access";
import { readAppSettings } from "@/lib/ledger/repository";

export const runtime = "nodejs";

const maxImages = 6;
const maxImageBytes = 12 * 1024 * 1024;
const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: NextRequest) {
  if (!(await hasValidAccessCookie(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const settings = await readAppSettings();
  const apiKey = settings.aiApiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "未配置 OPENAI_API_KEY，无法使用图片识别" }, { status: 503 });
  }

  const formData = await request.formData().catch(() => null);
  const images =
    formData?.getAll("images").filter((value): value is File => value instanceof File) || [];
  if (!images.length || images.length > maxImages) {
    return NextResponse.json({ error: `请选择 1-${maxImages} 张图片` }, { status: 400 });
  }
  if (images.some((image) => !supportedTypes.has(image.type) || image.size > maxImageBytes)) {
    return NextResponse.json(
      { error: "仅支持 JPG、PNG、WebP，单张不能超过 12MB" },
      { status: 400 },
    );
  }

  const content: Array<Record<string, unknown>> = [
    {
      type: "input_text",
      text: purchaseRecognitionPrompt,
    },
  ];
  for (const image of images) {
    const base64 = Buffer.from(await image.arrayBuffer()).toString("base64");
    content.push({
      type: "input_image",
      image_url: `data:${image.type};base64,${base64}`,
      detail: "high",
    });
  }

  try {
    const response = await fetch(`${settings.aiBaseUrl}/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: settings.aiModel || process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini",
        input: [{ role: "user", content }],
        text: {
          format: {
            type: "json_schema",
            name: "purchase_recognition",
            strict: true,
            schema: recognitionSchema,
          },
        },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const payload = (await response.json().catch(() => ({}))) as OpenAiResponse;
    if (!response.ok) {
      throw new Error(payload.error?.message || `AI 识别失败（HTTP ${response.status}）`);
    }
    const outputText = payload.output
      ?.flatMap((item) => item.content || [])
      .find((item) => item.type === "output_text")?.text;
    if (!outputText) throw new Error("AI 未返回可解析的识别结果");
    return NextResponse.json(JSON.parse(outputText));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "购买图片识别失败" },
      { status: 502 },
    );
  }
}

type OpenAiResponse = {
  error?: { message?: string };
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
};

const purchaseRecognitionPrompt = `你在分析电商或二手平台的游戏购买/订单截图。识别截图中实际购买的游戏，每个独立游戏生成一条结果。
规则：
1. title 写规范、简洁的游戏名，去掉店铺宣传、成色和退换货文案；不要把推荐商品识别成已购买游戏。
2. price 优先使用“实付”“实付款”“成交价”，其次商品总价；不要使用原价、划线价、补贴金额或推荐商品价格。currency 使用 CNY/JPY/HKD/USD/EUR/BRL。
3. platform 只能是 Nintendo Switch 或 PlayStation。NS、Switch、Switch2、任天堂为 Nintendo Switch；PS4/PS5 为 PlayStation。标题同时包含多个平台且无法从商品图/选项确定时，选最可能值并降低 confidence、写 warning。
4. region 只能是 日版/港版/台版/美版/欧版/其他。港版、港服写港版；没有证据写其他。
5. format 只能是 实体卡带/实体光盘/数字版。Switch 实体通常为实体卡带，PlayStation 实体通常为实体光盘。
6. seller 是购买平台或店铺名（如淘宝、闲鱼、拼多多、百亿补贴），能识别店铺时可写“平台 · 店铺”。purchaseDate 仅在截图明确显示下单/成交日期时写 YYYY-MM-DD，否则空字符串。
7. notes 可保留 DLC、限定版、盒装、语言等对收藏有用的信息，不要写订单号、姓名、电话、地址等隐私信息。
8. confidence 为 0 到 1。warning 写需要用户核实的歧义，无则空字符串。`;

const recognitionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["games"],
  properties: {
    games: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "price",
          "currency",
          "platform",
          "region",
          "format",
          "seller",
          "purchaseDate",
          "notes",
          "confidence",
          "warning",
        ],
        properties: {
          title: { type: "string" },
          price: { type: "number", minimum: 0 },
          currency: { type: "string", enum: ["CNY", "JPY", "HKD", "USD", "EUR", "BRL"] },
          platform: { type: "string", enum: ["Nintendo Switch", "PlayStation"] },
          region: { type: "string", enum: ["日版", "港版", "台版", "美版", "欧版", "其他"] },
          format: { type: "string", enum: ["实体卡带", "实体光盘", "数字版"] },
          seller: { type: "string" },
          purchaseDate: { type: "string" },
          notes: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          warning: { type: "string" },
        },
      },
    },
  },
} as const;
