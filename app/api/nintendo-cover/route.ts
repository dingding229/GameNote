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

type MainlandHit = {
  title?: string;
  imgUrl?: string;
  jumpUrl?: string;
  publishTime?: string;
  version?: string;
  price?: number;
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
  source: "mainland" | "hong-kong" | "algolia" | "page";
};

const algoliaAppId = "U3B6GR4UA3";
const algoliaApiKey = "a29c6927638bfd8cee23993e51e721c9";
const algoliaIndex = "store_game_en_us";
const nintendoBaseUrl = "https://www.nintendo.com";
const nintendoHongKongSoftwareUrl = "https://www.nintendo.com/hk/software/switch";
const nintendoMainlandBaseUrl = "https://www.nintendoswitch.com.cn";
const nintendoMainlandSoftwareUrl = `${nintendoMainlandBaseUrl}/software`;
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
  const [mainlandLookup, hongKongLookup, algoliaLookup] = await Promise.allSettled([
    searchNintendoMainland(query),
    searchNintendoHongKong(query),
    searchNintendoAlgolia(query),
  ]);

  const results = [
    ...(mainlandLookup.status === "fulfilled" ? mainlandLookup.value : []),
    ...(hongKongLookup.status === "fulfilled" ? hongKongLookup.value : []),
    ...(algoliaLookup.status === "fulfilled" ? algoliaLookup.value : []),
  ];

  if (!results.length) {
    const rejectedLookup = [mainlandLookup, hongKongLookup, algoliaLookup].find(
      (lookup) => lookup.status === "rejected",
    );
    if (rejectedLookup?.status === "rejected") {
      throw rejectedLookup.reason;
    }
  }

  return dedupeCoverResults(results).slice(0, 12);
}

async function searchNintendoMainland(query: string): Promise<CoverResult[]> {
  const response = await fetch(nintendoMainlandSoftwareUrl, {
    headers: {
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
      "user-agent": "Mozilla/5.0 Switch Purchase Ledger",
    },
  });

  if (!response.ok) {
    throw new Error(`Nintendo Mainland search returned ${response.status}`);
  }

  const variants = buildMainlandQueryVariants(query);
  const hits = extractMainlandHits(await response.text());

  return hits
    .map((hit) => ({
      hit,
      score: Math.max(
        ...variants.map((variant) => scoreMainlandHit(hit, variant)),
      ),
    }))
    .filter(({ score }) => score >= 24)
    .sort((left, right) => right.score - left.score)
    .map(({ hit }) => toMainlandCoverResult(hit))
    .filter((result): result is CoverResult => Boolean(result));
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

function scoreMainlandHit(hit: MainlandHit, query: string) {
  const title = normalizeSearchText(applyMainlandTitleStyle(hit.title ?? ""));
  const normalizedQuery = normalizeSearchText(applyMainlandTitleStyle(query));
  const queryWords = normalizedQuery.split(" ").filter(Boolean);
  let score = 0;

  if (!title || !normalizedQuery) {
    return score;
  }

  if (title === normalizedQuery) {
    score += 150;
  }

  if (title.startsWith(normalizedQuery)) {
    score += 100;
  }

  if (title.includes(normalizedQuery)) {
    score += 80;
  }

  if (queryWords.length && queryWords.every((word) => title.includes(word))) {
    score += 45;
  }

  if (hit.jumpUrl) {
    score += 8;
  }

  if (typeof hit.price === "number") {
    score += 4;
  }

  if (
    !normalizedQuery.includes("通行证") &&
    !normalizedQuery.includes("dlc") &&
    title.includes("通行证")
  ) {
    score -= 35;
  }

  if (
    !normalizedQuery.includes("实况") &&
    !normalizedQuery.includes("家庭") &&
    !normalizedQuery.includes("live") &&
    title.includes("实况")
  ) {
    score -= 30;
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
      "www.nintendoswitch.com.cn",
      "nintendoswitch.com.cn",
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
    title: applyMainlandTitleStyle(toSimplifiedText(title)),
    coverUrl: optimizeCoverUrl(coverUrl),
    nintendoUrl: canonicalUrl,
    platform: "Nintendo Switch",
    releaseDate: null,
    price: null,
    currency: null,
    source: "page",
  };
}

function toHongKongCoverResult(hit: HongKongHit): CoverResult | null {
  const coverUrl = buildHongKongCoverUrl(hit);

  if (!coverUrl || !hit.title) {
    return null;
  }

  const nintendoUrl = buildHongKongGameUrl(hit);
  const categories = hit.category?.length
    ? ` · ${hit.category.map(toSimplifiedText).map(applyMainlandTitleStyle).join(" / ")}`
    : "";

  return {
    id: hit.nsuid ?? hit.softCode ?? hit.sys?.id ?? nintendoUrl,
    title: applyMainlandTitleStyle(toSimplifiedText(hit.title)),
    coverUrl,
    nintendoUrl,
    platform: `${applyMainlandTitleStyle(
      toSimplifiedText(hit.hardwareCategory ?? "Nintendo Switch"),
    )}${categories}`,
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

function toMainlandCoverResult(hit: MainlandHit): CoverResult | null {
  if (!hit.title || !hit.imgUrl) {
    return null;
  }

  const nintendoUrl = buildMainlandGameUrl(hit.jumpUrl);

  return {
    id: nintendoUrl || normalizeSearchText(hit.title),
    title: applyMainlandTitleStyle(toSimplifiedText(hit.title)),
    coverUrl: optimizeCoverUrl(decodeScriptEscapes(hit.imgUrl)),
    nintendoUrl,
    platform: hit.version ? `Nintendo Switch · ${hit.version}` : "Nintendo Switch",
    releaseDate: hit.publishTime ?? null,
    price: hit.price ?? null,
    currency: hit.price ? "CNY" : null,
    source: "mainland",
  };
}

function buildHongKongCoverUrl(hit: HongKongHit) {
  const coverUrl = hit.imageHeroOrg || hit.imageHero?.url;
  return coverUrl ? optimizeCoverUrl(coverUrl) : null;
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

function buildMainlandGameUrl(rawUrl: string | undefined) {
  if (!rawUrl) {
    return nintendoMainlandSoftwareUrl;
  }

  const decoded = decodeScriptEscapes(rawUrl).replace(/^http:\/\//, "https://");

  if (/^\d+$/.test(decoded)) {
    return `${nintendoMainlandSoftwareUrl}/${decoded}`;
  }

  try {
    return new URL(decoded, nintendoMainlandBaseUrl).toString();
  } catch {
    return nintendoMainlandSoftwareUrl;
  }
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
    return optimizeCoverUrl(input);
  }

  return `${imageBaseUrl}${input.replace(/^\/+/, "")}`;
}

function optimizeCoverUrl(input: string) {
  const normalized = input.replaceAll("\\u0026", "&").replace(/^http:\/\//, "https://");

  try {
    const url = new URL(normalized);

    if (url.hostname === "images.ctfassets.net") {
      url.searchParams.set("w", "960");
      url.searchParams.set("fm", "webp");
      url.searchParams.set("q", "90");
      url.searchParams.delete("h");
      url.searchParams.delete("fit");
    }

    return url.toString();
  } catch {
    return normalized;
  }
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

function extractMainlandHits(html: string): MainlandHit[] {
  const text = decodeScriptEscapes(html);
  const variableStrings = extractMainlandVariableStrings(text);
  const hits: MainlandHit[] = [];
  const assignedHits = new Map<string, MainlandHit>();
  const assignmentPattern =
    /([A-Za-z_$][\w$]*)\.(title|imgUrl|jumpUrl|publishTime|version|price)=([^;]+);/g;

  for (const match of text.matchAll(assignmentPattern)) {
    const [, owner, field, rawValue] = match;
    const value = resolveMainlandToken(rawValue, variableStrings);

    if (value === null) {
      continue;
    }

    const hit = assignedHits.get(owner) ?? {};
    setMainlandHitField(hit, field, value);
    assignedHits.set(owner, hit);
  }

  hits.push(...assignedHits.values());

  const objectPattern =
    /\{title:((?:"(?:\\.|[^"\\])*")|[A-Za-z_$][\w$]*)[^{}]*?\}/g;

  for (const match of text.matchAll(objectPattern)) {
    const [block, rawTitle] = match;
    const hit: MainlandHit = {};
    const title = resolveMainlandToken(rawTitle, variableStrings);

    if (typeof title === "string") {
      hit.title = title;
    }

    for (const field of ["imgUrl", "jumpUrl", "publishTime", "version", "price"]) {
      const value = extractMainlandObjectField(block, field, variableStrings);

      if (value !== null) {
        setMainlandHitField(hit, field, value);
      }
    }

    hits.push(hit);
  }

  return dedupeMainlandHits(hits).filter((hit) => hit.title && hit.imgUrl);
}

function extractMainlandVariableStrings(text: string) {
  const variables = new Map<string, string>();
  const marker = "serverRendered:true}}(";
  const callStart = text.lastIndexOf(marker);

  if (callStart < 0) {
    return variables;
  }

  const functionStart = text.lastIndexOf("function(", callStart);
  const paramsEnd = functionStart >= 0 ? text.indexOf("){", functionStart) : -1;

  if (functionStart < 0 || paramsEnd < 0) {
    return variables;
  }

  const params = text
    .slice(functionStart + "function(".length, paramsEnd)
    .split(",")
    .map((param) => param.trim())
    .filter(Boolean);
  const argsStart = callStart + marker.length;
  const argsEnd =
    text.indexOf("));</script>", argsStart) >= 0
      ? text.indexOf("));</script>", argsStart)
      : text.indexOf("));", argsStart);

  if (argsEnd < 0) {
    return variables;
  }

  const args = splitTopLevelArguments(text.slice(argsStart, argsEnd));

  params.forEach((param, index) => {
    const value = parseMainlandStringToken(args[index] ?? "");

    if (value !== null) {
      variables.set(param, value);
    }
  });

  return variables;
}

function splitTopLevelArguments(value: string) {
  const tokens: string[] = [];
  let start = 0;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

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
    } else if (char === "{" || char === "[") {
      depth += 1;
    } else if (char === "}" || char === "]") {
      depth -= 1;
    } else if (char === "," && depth === 0) {
      tokens.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }

  tokens.push(value.slice(start).trim());
  return tokens;
}

function extractMainlandObjectField(
  block: string,
  field: string,
  variables: Map<string, string>,
) {
  const pattern = new RegExp(
    `${field}:((?:"(?:\\\\.|[^"\\\\])*")|[A-Za-z_$][\\w$]*|-?\\d+(?:\\.\\d+)?)`,
  );
  const match = block.match(pattern);

  return match ? resolveMainlandToken(match[1], variables) : null;
}

function resolveMainlandToken(
  rawValue: string,
  variables: Map<string, string>,
): string | number | null {
  const value = rawValue.trim();
  const stringValue = parseMainlandStringToken(value);

  if (stringValue !== null) {
    return stringValue;
  }

  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return Number(value);
  }

  return variables.get(value) ?? null;
}

function parseMainlandStringToken(value: string) {
  const trimmed = value.trim();

  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) {
    return null;
  }

  return decodeHtml(decodeScriptEscapes(trimmed.slice(1, -1))) ?? "";
}

function setMainlandHitField(
  hit: MainlandHit,
  field: string,
  value: string | number,
) {
  if (field === "price") {
    hit.price = typeof value === "number" ? value : Number(value) || undefined;
    return;
  }

  if (typeof value !== "string") {
    return;
  }

  if (field === "title") {
    hit.title = value;
  } else if (field === "imgUrl") {
    hit.imgUrl = value;
  } else if (field === "jumpUrl") {
    hit.jumpUrl = value;
  } else if (field === "publishTime") {
    hit.publishTime = value;
  } else if (field === "version") {
    hit.version = value;
  }
}

function dedupeMainlandHits(hits: MainlandHit[]) {
  const seen = new Set<string>();

  return hits.filter((hit) => {
    const key = normalizeSearchText(
      `${hit.title ?? ""} ${hit.jumpUrl ?? ""} ${hit.imgUrl ?? ""}`,
    );

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
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
    const keys = [
      normalizeSearchText(result.title),
      normalizeSearchText(result.nintendoUrl || result.coverUrl),
    ].filter(Boolean);

    if (keys.some((key) => seen.has(key))) {
      return false;
    }

    keys.forEach((key) => seen.add(key));
    return true;
  });
}

function buildMainlandQueryVariants(query: string) {
  const trimmed = query.trim();
  const simplified = toSimplifiedText(trimmed);
  const mainland = applyMainlandTitleStyle(simplified);
  const variants = new Set<string>([trimmed, simplified, mainland]);
  const normalized = trimmed.toLowerCase();
  const aliasEntries: Array<[RegExp, string]> = [
    [/马里奥|玛利欧|瑪利歐|mario/i, "马力欧"],
    [/马车|mario\s*kart/i, "马力欧卡丁车"],
    [/萨尔达|薩爾達|zelda/i, "塞尔达"],
    [/宝可梦|寶可夢|口袋妖怪|pokemon/i, "宝可梦"],
    [/健身环|健身環|ring fit/i, "健身环"],
    [/星之卡比|kirby/i, "星之卡比"],
    [/耀西|yoshi/i, "耀西"],
    [/奥德赛|奧德賽|odyssey/i, "奥德赛"],
  ];

  for (const [pattern, replacement] of aliasEntries) {
    if (pattern.test(normalized) || pattern.test(trimmed)) {
      variants.add(applyMainlandTitleStyle(simplified.replace(pattern, replacement)));
      if (
        normalizeSearchText(simplified).length <=
        normalizeSearchText(replacement).length + 1
      ) {
        variants.add(replacement);
      }
    }
  }

  return [...variants].filter(Boolean).slice(0, 8);
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
      variants.add(trimmed.replace(pattern, replacement));
      variants.add(traditional.replace(pattern, replacement));
      if (
        normalizeSearchText(trimmed).length <=
        normalizeSearchText(replacement).length + 1
      ) {
        variants.add(replacement);
      }
    }
  }

  return [...variants].filter(Boolean).slice(0, 5);
}

function applyMainlandTitleStyle(value: string) {
  return value
    .replace(/\bZELDA\b/gi, "塞尔达")
    .replaceAll("薩爾達", "塞尔达")
    .replaceAll("萨尔达", "塞尔达")
    .replaceAll("瑪利歐", "马力欧")
    .replaceAll("玛利欧", "马力欧")
    .replaceAll("马里奥", "马力欧")
    .replaceAll("瑪利奧", "马力欧")
    .replaceAll("玛利奥", "马力欧")
    .replaceAll("超級马力欧", "超级马力欧")
    .replaceAll("超級 马力欧", "超级 马力欧")
    .replaceAll("卡比之星", "星之卡比")
    .replaceAll("路易基", "路易吉");
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

function toSimplifiedText(value: string) {
  const map: Record<string, string> = {
    萬: "万",
    與: "与",
    專: "专",
    東: "东",
    嚴: "严",
    個: "个",
    臨: "临",
    為: "为",
    麗: "丽",
    樂: "乐",
    鄉: "乡",
    書: "书",
    買: "买",
    亂: "乱",
    爭: "争",
    亞: "亚",
    產: "产",
    親: "亲",
    優: "优",
    會: "会",
    傳: "传",
    傷: "伤",
    體: "体",
    俠: "侠",
    侶: "侣",
    債: "债",
    償: "偿",
    兒: "儿",
    黨: "党",
    蘭: "兰",
    關: "关",
    興: "兴",
    養: "养",
    獸: "兽",
    軍: "军",
    農: "农",
    沖: "冲",
    決: "决",
    凍: "冻",
    淨: "净",
    涼: "凉",
    減: "减",
    鳳: "凤",
    凱: "凯",
    擊: "击",
    劃: "划",
    剛: "刚",
    創: "创",
    別: "别",
    劍: "剑",
    劇: "剧",
    勸: "劝",
    辦: "办",
    務: "务",
    動: "动",
    勵: "励",
    勁: "劲",
    勞: "劳",
    勢: "势",
    區: "区",
    醫: "医",
    華: "华",
    協: "协",
    單: "单",
    賣: "卖",
    盧: "卢",
    衛: "卫",
    廳: "厅",
    歷: "历",
    壓: "压",
    雙: "双",
    發: "发",
    變: "变",
    葉: "叶",
    號: "号",
    後: "后",
    嗎: "吗",
    啟: "启",
    員: "员",
    響: "响",
    嚇: "吓",
    喚: "唤",
    噴: "喷",
    園: "园",
    圍: "围",
    國: "国",
    圖: "图",
    圓: "圆",
    聖: "圣",
    場: "场",
    壞: "坏",
    塊: "块",
    堅: "坚",
    壇: "坛",
    墜: "坠",
    壘: "垒",
    墾: "垦",
    墊: "垫",
    牆: "墙",
    聲: "声",
    處: "处",
    備: "备",
    復: "复",
    夠: "够",
    頭: "头",
    夾: "夹",
    奪: "夺",
    奮: "奋",
    奧: "奥",
    獎: "奖",
    妝: "妆",
    婦: "妇",
    媽: "妈",
    娛: "娱",
    嫻: "娴",
    孫: "孙",
    學: "学",
    寧: "宁",
    寶: "宝",
    實: "实",
    寵: "宠",
    審: "审",
    宮: "宫",
    寬: "宽",
    對: "对",
    尋: "寻",
    導: "导",
    將: "将",
    爾: "尔",
    塵: "尘",
    嘗: "尝",
    盡: "尽",
    層: "层",
    屆: "届",
    屬: "属",
    歲: "岁",
    島: "岛",
    嶺: "岭",
    峽: "峡",
    幣: "币",
    帥: "帅",
    師: "师",
    帳: "帐",
    帶: "带",
    幫: "帮",
    並: "并",
    廣: "广",
    莊: "庄",
    慶: "庆",
    庫: "库",
    應: "应",
    廟: "庙",
    廢: "废",
    開: "开",
    異: "异",
    棄: "弃",
    張: "张",
    彈: "弹",
    強: "强",
    歸: "归",
    當: "当",
    錄: "录",
    徑: "径",
    禦: "御",
    憶: "忆",
    憂: "忧",
    懷: "怀",
    態: "态",
    總: "总",
    戀: "恋",
    惡: "恶",
    悅: "悦",
    懸: "悬",
    驚: "惊",
    懼: "惧",
    慘: "惨",
    懲: "惩",
    慚: "惭",
    慣: "惯",
    願: "愿",
    戲: "戏",
    戰: "战",
    戶: "户",
    撲: "扑",
    執: "执",
    擴: "扩",
    掃: "扫",
    揚: "扬",
    擾: "扰",
    撫: "抚",
    拋: "抛",
    搶: "抢",
    護: "护",
    報: "报",
    擔: "担",
    擬: "拟",
    擁: "拥",
    擋: "挡",
    掙: "挣",
    擠: "挤",
    揮: "挥",
    損: "损",
    撿: "捡",
    換: "换",
    據: "据",
    擲: "掷",
    攬: "揽",
    攪: "搅",
    攜: "携",
    攝: "摄",
    擺: "摆",
    搖: "摇",
    撐: "撑",
    敵: "敌",
    數: "数",
    鬥: "斗",
    斬: "斩",
    斷: "断",
    無: "无",
    舊: "旧",
    時: "时",
    曉: "晓",
    暫: "暂",
    術: "术",
    機: "机",
    殺: "杀",
    雜: "杂",
    權: "权",
    條: "条",
    來: "来",
    極: "极",
    構: "构",
    槍: "枪",
    楓: "枫",
    櫃: "柜",
    標: "标",
    棧: "栈",
    棟: "栋",
    欄: "栏",
    樹: "树",
    樣: "样",
    橋: "桥",
    檔: "档",
    夢: "梦",
    檢: "检",
    樓: "楼",
    橫: "横",
    櫻: "樱",
    歡: "欢",
    歐: "欧",
    殘: "残",
    毀: "毁",
    畢: "毕",
    氣: "气",
    漢: "汉",
    湯: "汤",
    溝: "沟",
    沒: "没",
    淚: "泪",
    瀉: "泻",
    潑: "泼",
    澤: "泽",
    潔: "洁",
    淺: "浅",
    測: "测",
    濟: "济",
    渾: "浑",
    濃: "浓",
    濤: "涛",
    漣: "涟",
    渦: "涡",
    潤: "润",
    漲: "涨",
    漸: "渐",
    漁: "渔",
    溫: "温",
    灣: "湾",
    濕: "湿",
    滾: "滚",
    滿: "满",
    濾: "滤",
    濫: "滥",
    濱: "滨",
    灘: "滩",
    瀟: "潇",
    瀾: "澜",
    滅: "灭",
    燈: "灯",
    靈: "灵",
    災: "灾",
    燦: "灿",
    點: "点",
    煉: "炼",
    爛: "烂",
    煩: "烦",
    燒: "烧",
    燙: "烫",
    熱: "热",
    愛: "爱",
    爺: "爷",
    牽: "牵",
    獨: "独",
    狹: "狭",
    獅: "狮",
    獄: "狱",
    獵: "猎",
    豬: "猪",
    貓: "猫",
    獻: "献",
    瑪: "玛",
    環: "环",
    現: "现",
    畫: "画",
    暢: "畅",
    療: "疗",
    瘋: "疯",
    癢: "痒",
    癱: "瘫",
    皺: "皱",
    監: "监",
    蓋: "盖",
    盤: "盘",
    睜: "睁",
    著: "着",
    瞞: "瞒",
    矯: "矫",
    礦: "矿",
    碼: "码",
    磚: "砖",
    確: "确",
    禮: "礼",
    禍: "祸",
    禪: "禅",
    離: "离",
    種: "种",
    積: "积",
    稱: "称",
    穩: "稳",
    窮: "穷",
    竊: "窃",
    竅: "窍",
    窩: "窝",
    窺: "窥",
    競: "竞",
    筆: "笔",
    簡: "简",
    簽: "签",
    籃: "篮",
    類: "类",
    粵: "粤",
    糧: "粮",
    緊: "紧",
    紅: "红",
    級: "级",
    紀: "纪",
    純: "纯",
    紙: "纸",
    紋: "纹",
    紐: "纽",
    線: "线",
    組: "组",
    細: "细",
    織: "织",
    終: "终",
    絆: "绊",
    經: "经",
    結: "结",
    繞: "绕",
    繪: "绘",
    給: "给",
    統: "统",
    絕: "绝",
    綠: "绿",
    維: "维",
    續: "续",
    練: "练",
    編: "编",
    緣: "缘",
    縮: "缩",
    繳: "缴",
    網: "网",
    羅: "罗",
    齊: "齐",
    罰: "罚",
    習: "习",
    聯: "联",
    聰: "聪",
    肅: "肃",
    腸: "肠",
    膚: "肤",
    腦: "脑",
    腳: "脚",
    臉: "脸",
    騰: "腾",
    艱: "艰",
    藝: "艺",
    節: "节",
    蘇: "苏",
    蘋: "苹",
    蒼: "苍",
    薦: "荐",
    蕩: "荡",
    榮: "荣",
    藥: "药",
    萊: "莱",
    蓮: "莲",
    獲: "获",
    瑩: "莹",
    蘿: "萝",
    營: "营",
    蕭: "萧",
    薩: "萨",
    蔥: "葱",
    藍: "蓝",
    魯: "鲁",
    虛: "虚",
    蟲: "虫",
    雖: "虽",
    蝦: "虾",
    蝕: "蚀",
    蟻: "蚁",
    蠶: "蚕",
    蠻: "蛮",
    蟬: "蝉",
    蠅: "蝇",
    補: "补",
    襯: "衬",
    裝: "装",
    褲: "裤",
    視: "视",
    覺: "觉",
    觸: "触",
    訂: "订",
    計: "计",
    訊: "讯",
    討: "讨",
    讓: "让",
    記: "记",
    講: "讲",
    許: "许",
    論: "论",
    設: "设",
    訪: "访",
    證: "证",
    詞: "词",
    試: "试",
    詩: "诗",
    誠: "诚",
    話: "话",
    詳: "详",
    語: "语",
    誤: "误",
    說: "说",
    請: "请",
    諸: "诸",
    諾: "诺",
    讀: "读",
    課: "课",
    誰: "谁",
    調: "调",
    諒: "谅",
    談: "谈",
    謀: "谋",
    謊: "谎",
    謂: "谓",
    謎: "谜",
    謝: "谢",
    謠: "谣",
    謹: "谨",
    譜: "谱",
    穀: "谷",
    貝: "贝",
    負: "负",
    財: "财",
    責: "责",
    賢: "贤",
    敗: "败",
    貨: "货",
    質: "质",
    販: "贩",
    貪: "贪",
    貧: "贫",
    購: "购",
    貴: "贵",
    費: "费",
    賀: "贺",
    資: "资",
    賦: "赋",
    賭: "赌",
    賞: "赏",
    賜: "赐",
    賠: "赔",
    賴: "赖",
    賺: "赚",
    賽: "赛",
    贊: "赞",
    贈: "赠",
    趙: "赵",
    趕: "赶",
    趨: "趋",
    躍: "跃",
    踐: "践",
    蹤: "踪",
    軀: "躯",
    車: "车",
    軌: "轨",
    軒: "轩",
    轉: "转",
    輪: "轮",
    軟: "软",
    轟: "轰",
    軸: "轴",
    輕: "轻",
    載: "载",
    輔: "辅",
    輛: "辆",
    輩: "辈",
    輝: "辉",
    輯: "辑",
    輸: "输",
    辭: "辞",
    邊: "边",
    遼: "辽",
    達: "达",
    遷: "迁",
    過: "过",
    邁: "迈",
    運: "运",
    還: "还",
    這: "这",
    進: "进",
    遠: "远",
    連: "连",
    遲: "迟",
    適: "适",
    選: "选",
    遜: "逊",
    遞: "递",
    邏: "逻",
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

function decodeScriptEscapes(value: string) {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, code: string) =>
      String.fromCharCode(parseInt(code, 16)),
    )
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, code: string) =>
      String.fromCharCode(parseInt(code, 16)),
    )
    .replaceAll("\\/", "/")
    .replaceAll('\\"', '"')
    .replaceAll("\\'", "'");
}
