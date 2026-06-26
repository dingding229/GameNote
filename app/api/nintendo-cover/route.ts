import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

type NintendoHit = {
  title?: string;
  url?: string;
  urlKey?: string;
  productImage?: string;
  productImageSquare?: string | null;
  productGallery?: Array<{ publicId?: string; resourceType?: string }>;
  platform?: string;
  platformCode?: string;
  releaseDate?: string;
  price?: { finalPrice?: number; regPrice?: number };
  eshopDetails?: { currency?: string; regularPrice?: number };
  editions?: string[];
  sku?: string;
  nsuid?: string;
  objectID?: string;
};

type HongKongHit = {
  sys?: { id?: string };
  title?: string;
  nsuid?: string;
  releaseDate?: string | null;
  releaseDatePackage?: string | null;
  releaseDateDownload?: string | null;
  softCode?: string;
  hardwareCategory?: string;
  category?: string[];
  publisher?: string;
  pageLink?: string;
  pageLinkCustom?: string;
  link?: string;
  imageHeroOrg?: string;
  imageHero?: { url?: string };
};

type CoverResult = {
  id: string;
  title: string;
  coverUrl: string;
  nintendoUrl: string;
  platform: string;
  releaseDate: string | null;
  price: number | null;
  currency: string | null;
  source: "algolia" | "hong-kong" | "page";
};

const algoliaAppId = "U3B6GR4UA3";
const algoliaApiKey = "a29c6927638bfd8cee23993e51e721c9";
const algoliaIndex = "store_game_en_us";
const nintendoBaseUrl = "https://www.nintendo.com";
const nintendoHongKongSoftwareUrl = "https://www.nintendo.com/hk/software/switch";
const imageBaseUrl = "https://assets.nintendo.com/image/upload/q_auto/f_auto/";

const retrieveAttributes = [
  "title",
  "url",
  "urlKey",
  "productImage",
  "productImageSquare",
  "productGallery",
  "platform",
  "platformCode",
  "releaseDate",
  "price",
  "eshopDetails",
  "editions",
  "sku",
  "nsuid",
];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() ?? "";
  const pageUrl = searchParams.get("url")?.trim() ?? "";

  try {
    if (pageUrl) {
      const result = await fetchNintendoPageCover(pageUrl);
      return NextResponse.json({ results: result ? [result] : [] });
    }

    if (!query) {
      return NextResponse.json({ results: [] });
    }

    const results = await searchNintendo(query);
    return NextResponse.json({ results });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nintendo cover lookup failed";
    return NextResponse.json({ error: message, results: [] }, { status: 502 });
  }
}

async function searchNintendo(query: string): Promise<CoverResult[]> {
  const [hongKongLookup, algoliaLookup] = await Promise.allSettled([
    searchNintendoHongKong(query),
    searchNintendoAlgolia(query),
  ]);

  const results = [
    ...(hongKongLookup.status === "fulfilled" ? hongKongLookup.value : []),
    ...(algoliaLookup.status === "fulfilled" ? algoliaLookup.value : []),
  ];

  if (!results.length && hongKongLookup.status === "rejected") {
    throw hongKongLookup.reason;
  }

  if (!results.length && algoliaLookup.status === "rejected") {
    throw algoliaLookup.reason;
  }

  return dedupeCoverResults(results).slice(0, 12);
}

async function searchNintendoHongKong(query: string): Promise<CoverResult[]> {
  const variants = buildHongKongQueryVariants(query);
  const searches = await Promise.all(
    variants.map(async (variant) => {
      const url = new URL(nintendoHongKongSoftwareUrl);
      url.searchParams.set("sfq", variant);
      url.searchParams.set("sftab", "all");

      const response = await fetch(url.toString(), {
        headers: {
          "accept-language": "zh-HK,zh-TW;q=0.9,zh-CN;q=0.8,en;q=0.6",
          "user-agent": "Mozilla/5.0 Switch Purchase Ledger",
        },
      });

      if (!response.ok) {
        throw new Error(`Nintendo Hong Kong search returned ${response.status}`);
      }

      const hits = extractHongKongHits(await response.text());

      return hits
        .map((hit) => ({
          hit,
          score: Math.max(
            scoreHongKongHit(hit, query),
            scoreHongKongHit(hit, variant),
          ),
        }))
        .filter(({ score }) => score >= 20)
        .sort((left, right) => right.score - left.score)
        .map(({ hit }) => toHongKongCoverResult(hit))
        .filter((result): result is CoverResult => Boolean(result));
    }),
  );

  return dedupeCoverResults(searches.flat());
}

async function searchNintendoAlgolia(query: string): Promise<CoverResult[]> {
  const params = new URLSearchParams({
    hitsPerPage: "12",
    analytics: "false",
    clickAnalytics: "false",
    attributesToRetrieve: JSON.stringify(retrieveAttributes),
  });

  const response = await fetch(
    `https://${algoliaAppId}-dsn.algolia.net/1/indexes/*/queries`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-algolia-api-key": algoliaApiKey,
        "x-algolia-application-id": algoliaAppId,
      },
      body: JSON.stringify({
        requests: [
          {
            indexName: algoliaIndex,
            query,
            params: params.toString(),
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Nintendo search returned ${response.status}`);
  }

  const payload = (await response.json()) as {
    results?: Array<{ hits?: NintendoHit[] }>;
  };

  const hits = payload.results?.[0]?.hits ?? [];

  return hits
    .map((hit) => ({ hit, score: scoreHit(hit, query) }))
    .filter(({ score }) => score >= 30)
    .sort((left, right) => right.score - left.score)
    .map(({ hit }) => toCoverResult(hit))
    .filter((result): result is CoverResult => Boolean(result));
}

function scoreHit(hit: NintendoHit, query: string) {
  const normalizedTitle = normalizeSearchText(hit.title ?? "");
  const normalizedQuery = normalizeSearchText(query);
  const queryWords = normalizedQuery.split(" ").filter(Boolean);
  let score = 0;

  if (normalizedTitle === normalizedQuery) {
    score += 120;
  }

  if (normalizedTitle.startsWith(normalizedQuery)) {
    score += 80;
  }

  if (normalizedTitle.includes(normalizedQuery)) {
    score += 60;
  }

  if (queryWords.length && queryWords.every((word) => normalizedTitle.includes(word))) {
    score += 36;
  }

  if (hit.platformCode === "NINTENDO_SWITCH") {
    score += 20;
  }

  if (hit.platformCode === "NINTENDO_SWITCH_2") {
    score -= 12;
  }

  if (hit.editions?.includes("Physical")) {
    score += 8;
  }

  if (!normalizedQuery.includes("booster") && normalizedTitle.includes("booster")) {
    score -= 35;
  }

  if (!normalizedQuery.includes("upgrade") && normalizedTitle.includes("upgrade pack")) {
    score -= 35;
  }

  if (!normalizedQuery.includes("bundle") && normalizedTitle.includes("bundle")) {
    score -= 10;
  }

  return score;
}

function scoreHongKongHit(hit: HongKongHit, query: string) {
  const title = normalizeSearchText(hit.title ?? "");
  const normalizedQuery = normalizeSearchText(query);
  const queryWords = normalizedQuery.split(" ").filter(Boolean);
  let score = 0;

  if (!title || !normalizedQuery) {
    return score;
  }

  if (title === normalizedQuery) {
    score += 140;
  }

  if (title.startsWith(normalizedQuery)) {
    score += 90;
  }

  if (title.includes(normalizedQuery)) {
    score += 70;
  }

  if (queryWords.length && queryWords.every((word) => title.includes(word))) {
    score += 38;
  }

  if (hit.hardwareCategory === "Nintendo Switch") {
    score += 20;
  }

  if (hit.category?.includes("盒裝版")) {
    score += 12;
  }

  if (hit.category?.includes("下載版")) {
    score += 4;
  }

  return score;
}

async function fetchNintendoPageCover(inputUrl: string): Promise<CoverResult | null> {
  const url = new URL(inputUrl);
  const host = url.hostname.toLowerCase();

  if (
    url.protocol !== "https:" ||
    ![
      "www.nintendo.com",
      "nintendo.com",
      "www.nintendo.com.hk",
      "nintendo.com.hk",
      "ec.nintendo.com",
      "store.nintendo.com.hk",
    ].includes(host)
  ) {
    throw new Error("Only Nintendo product pages are supported");
  }

  const response = await fetch(url.toString(), {
    headers: { "user-agent": "Mozilla/5.0 Switch Purchase Ledger" },
  });

  if (!response.ok) {
    throw new Error(`Nintendo page returned ${response.status}`);
  }

  const html = await response.text();
  const coverUrl = extractMetaContent(html, "og:image");
  const rawTitle = extractMetaContent(html, "og:title");
  const canonicalUrl = extractCanonicalUrl(html) ?? url.toString();

  if (!coverUrl) {
    return null;
  }

  const title =
    rawTitle
      ?.replace(/\s+for Nintendo Switch.*$/i, "")
      .replace(/\s+- Nintendo Official Site$/i, "")
      .trim() || "Nintendo Switch Game";

  return {
    id: canonicalUrl,
    title,
    coverUrl,
    nintendoUrl: canonicalUrl,
    platform: "Nintendo Switch",
    releaseDate: null,
    price: null,
    currency: null,
    source: "page",
  };
}

function toHongKongCoverResult(hit: HongKongHit): CoverResult | null {
  const coverUrl = hit.imageHero?.url || hit.imageHeroOrg;

  if (!coverUrl || !hit.title) {
    return null;
  }

  const nintendoUrl = buildHongKongGameUrl(hit);
  const categories = hit.category?.length ? ` · ${hit.category.join(" / ")}` : "";

  return {
    id: hit.nsuid ?? hit.softCode ?? hit.sys?.id ?? nintendoUrl,
    title: hit.title,
    coverUrl: coverUrl.replaceAll("\\u0026", "&"),
    nintendoUrl,
    platform: `${hit.hardwareCategory ?? "Nintendo Switch"}${categories}`,
    releaseDate:
      hit.releaseDatePackage ??
      hit.releaseDateDownload ??
      hit.releaseDate ??
      null,
    price: null,
    currency: null,
    source: "hong-kong",
  };
}

function buildHongKongGameUrl(hit: HongKongHit) {
  const rawUrl =
    hit.pageLinkCustom ||
    hit.link ||
    (hit.pageLink && hit.pageLink !== "URLを指定する" ? hit.pageLink : "") ||
    (hit.softCode ? `/hk/switch/${hit.softCode}/` : "") ||
    nintendoHongKongSoftwareUrl;
  const url = rawUrl.replace("{NSUID}", hit.nsuid ?? "");

  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url.replace(/^http:\/\//, "https://");
  }

  return new URL(url, nintendoBaseUrl).toString();
}

function toCoverResult(hit: NintendoHit): CoverResult | null {
  const coverUrl = buildImageUrl(
    hit.productImageSquare ||
      hit.productImage ||
      hit.productGallery?.find((item) => item.resourceType === "image")?.publicId,
  );

  if (!coverUrl || !hit.title) {
    return null;
  }

  const nintendoUrl = hit.url
    ? hit.url.startsWith("http")
      ? hit.url
      : `${nintendoBaseUrl}${hit.url}`
    : hit.urlKey
      ? `${nintendoBaseUrl}/us/store/products/${hit.urlKey}/`
      : nintendoBaseUrl;

  return {
    id: hit.sku ?? hit.nsuid ?? hit.objectID ?? nintendoUrl,
    title: hit.title,
    coverUrl,
    nintendoUrl,
    platform: hit.platform ?? "Nintendo Switch",
    releaseDate: hit.releaseDate ?? null,
    price:
      hit.price?.finalPrice ??
      hit.price?.regPrice ??
      hit.eshopDetails?.regularPrice ??
      null,
    currency: hit.eshopDetails?.currency ?? null,
    source: "algolia",
  };
}

function buildImageUrl(input: string | null | undefined) {
  if (!input) {
    return null;
  }

  if (input.startsWith("http://") || input.startsWith("https://")) {
    return input.replace(/^http:\/\//, "https://");
  }

  return `${imageBaseUrl}${input.replace(/^\/+/, "")}`;
}

function extractHongKongHits(html: string): HongKongHit[] {
  const text = html
    .replace(/\\"/g, '"')
    .replace(/\\u0026/g, "&")
    .replace(/\\u003c/g, "<")
    .replace(/\\u003e/g, ">");
  const marker = '"posts":{"items":[';
  const start = text.indexOf(marker);

  if (start < 0) {
    return [];
  }

  const arrayStart = start + marker.length - 1;
  const arrayEnd = findJsonEnd(text, arrayStart);

  if (arrayEnd < 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(text.slice(arrayStart, arrayEnd)) as unknown;
    return Array.isArray(parsed) ? (parsed as HongKongHit[]) : [];
  } catch {
    return [];
  }
}

function findJsonEnd(text: string, start: number) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "[" || char === "{") {
      depth += 1;
    } else if (char === "]" || char === "}") {
      depth -= 1;

      if (depth === 0) {
        return index + 1;
      }
    }
  }

  return -1;
}

function dedupeCoverResults(results: CoverResult[]) {
  const seen = new Set<string>();

  return results.filter((result) => {
    const key = normalizeSearchText(
      result.nintendoUrl || result.coverUrl || result.title,
    );

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function buildHongKongQueryVariants(query: string) {
  const trimmed = query.trim();
  const variants = new Set<string>([trimmed]);
  const traditional = toTraditionalSearchText(trimmed);

  if (traditional !== trimmed) {
    variants.add(traditional);
  }

  const normalized = trimmed.toLowerCase();
  const aliasEntries: Array<[RegExp, string]> = [
    [/马里奥|超級?马力欧|馬力歐|马力欧/i, "瑪利歐"],
    [/塞尔达|萨尔达|薩爾達|zelda/i, "薩爾達"],
    [/宝可梦|寶可夢|口袋妖怪|pokemon/i, "寶可夢"],
    [/喷射战士|噴射戰士|喷喷|斯普拉遁|splatoon/i, "斯普拉遁"],
    [/动物森友会|動物森友會|动物之森/i, "動物森友會"],
    [/异度神剑|異度神劍|xenoblade/i, "異度神劍"],
    [/大乱斗|大亂鬥|smash/i, "大亂鬥"],
    [/健身环|健身環|ring fit/i, "健身環"],
    [/银河战士|銀河戰士|metroid/i, "密特羅德"],
    [/路易基|luigi/i, "路易吉"],
  ];

  for (const [pattern, replacement] of aliasEntries) {
    if (pattern.test(normalized) || pattern.test(trimmed)) {
      variants.add(replacement);
      variants.add(trimmed.replace(pattern, replacement));
      variants.add(traditional.replace(pattern, replacement));
    }
  }

  return [...variants].filter(Boolean).slice(0, 5);
}

function toTraditionalSearchText(value: string) {
  const map: Record<string, string> = {
    马: "馬",
    玛: "瑪",
    奥: "奧",
    萨: "薩",
    尔: "爾",
    达: "達",
    传: "傳",
    说: "說",
    国: "國",
    泪: "淚",
    异: "異",
    剑: "劍",
    战: "戰",
    斗: "鬥",
    环: "環",
    乱: "亂",
    宝: "寶",
    梦: "夢",
    动: "動",
    会: "會",
    喷: "噴",
    射: "射",
    个: "個",
    队: "隊",
    长: "長",
    体: "體",
    验: "驗",
    轻: "輕",
    乐: "樂",
    龙: "龍",
    门: "門",
    机: "機",
    时: "時",
    间: "間",
    竞: "競",
    车: "車",
    银: "銀",
    灵: "靈",
    欧: "歐",
    风: "風",
    云: "雲",
    无: "無",
    双: "雙",
    复: "復",
    旧: "舊",
    网: "網",
    球: "球",
  };

  return [...value].map((char) => map[char] ?? char).join("");
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[™®©]/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .toLowerCase();
}

function extractMetaContent(html: string, key: string) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  const tag = metaTags.find(
    (item) =>
      item.includes(`property="${key}"`) ||
      item.includes(`property='${key}'`) ||
      item.includes(`name="${key}"`) ||
      item.includes(`name='${key}'`),
  );

  return tag ? decodeHtml(extractAttribute(tag, "content")) : null;
}

function extractCanonicalUrl(html: string) {
  const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];
  const tag = linkTags.find(
    (item) => item.includes('rel="canonical"') || item.includes("rel='canonical'"),
  );

  return tag ? decodeHtml(extractAttribute(tag, "href")) : null;
}

function extractAttribute(tag: string, attribute: string) {
  const pattern = new RegExp(`${attribute}=["']([^"']+)["']`, "i");
  return tag.match(pattern)?.[1] ?? null;
}

function decodeHtml(value: string | null) {
  if (!value) {
    return null;
  }

  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}
