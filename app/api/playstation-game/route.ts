import { NextRequest, NextResponse } from "next/server";
import {
  normalizeChineseGameTitle,
  normalizeStoredGameTitle,
  stripPlayStationStoreTitleMetadata,
  toSimplifiedChinese,
  toTraditionalChinese,
} from "@/lib/chinese";
import {
  findChineseGameTitle,
  resolveGameTitles,
  type ResolvedGameTitle,
} from "@/lib/game-title";

export const runtime = "edge";

type PlayStationMedia = {
  role?: string;
  type?: string;
  url?: string;
};

type PlayStationProduct = {
  __typename?: string;
  id?: string;
  name?: string;
  npTitleId?: string;
  localizedStoreDisplayClassification?: string;
  storeDisplayClassification?: string;
  platforms?: string[];
  releaseDate?: string | { value?: string };
  edition?: { name?: string };
  price?: {
    basePrice?: string;
    discountedPrice?: string;
    isFree?: boolean;
  };
  media?: PlayStationMedia[];
  personalizedMeta?: {
    media?: PlayStationMedia[];
  };
  products?: Array<{ id?: string }>;
};

type PlayStationSearchResponse = {
  data?: {
    universalSearch?: {
      results?: unknown[];
    };
  };
  errors?: Array<{ message?: string }>;
};

type PlayStationLookupResult = {
  id: string;
  title: string;
  displayTitle?: string;
  coverUrl: string;
  officialUrl: string;
  platform: string;
  releaseDate: string | null;
  price: number | null;
  currency: "HKD" | null;
  source: "playstation-hong-kong" | "playstation-page";
};

const playStationStoreBaseUrl = "https://store.playstation.com";
const playStationGraphQlUrl =
  "https://web.np.playstation.com/api/graphql/v1/op";
const playStationHongKongLocale = "zh-hant-hk";
const playStationSearchOperation = "getSearchResults";
const playStationSearchHash =
  "4df6284f982e57bec70f23c77e2c219dc792eb19af7fb3d3a81767aa3f1958aa";
const excludedClassifications = new Set([
  "ADD_ON",
  "ITEM",
  "COSTUME",
  "LEVEL",
  "MAP",
  "SEASON_PASS",
  "THEME",
  "AVATAR",
  "VIRTUAL_CURRENCY",
]);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() ?? "";
  const pageUrl = searchParams.get("url")?.trim() ?? "";

  try {
    if (pageUrl) {
      const result = await fetchPlayStationPage(pageUrl);
      if (!result) {
        return NextResponse.json({ results: [] });
      }

      const resolvedTitles = await resolveGameTitles(result.title);
      return NextResponse.json({
        results: [withChineseDisplayTitle(result, resolvedTitles)],
      });
    }

    if (!query) {
      return NextResponse.json({ results: [] });
    }

    const results = await searchPlayStationHongKong(query);
    return NextResponse.json({ results });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "PlayStation lookup failed";
    return NextResponse.json({ error: message, results: [] }, { status: 502 });
  }
}

async function searchPlayStationHongKong(
  query: string,
): Promise<PlayStationLookupResult[]> {
  const resolvedTitles = await resolveGameTitles(query);
  const variants = await buildPlayStationSearchVariants(query, resolvedTitles);
  const searches = await Promise.allSettled(
    variants.map(searchPlayStationHongKongVariant),
  );
  const results = searches.flatMap((search) =>
    search.status === "fulfilled" ? search.value : [],
  );

  if (!results.length) {
    const rejectedSearch = searches.find((search) => search.status === "rejected");
    if (rejectedSearch?.status === "rejected") {
      throw rejectedSearch.reason;
    }
  }

  return dedupeResults(results)
    .slice(0, 12)
    .map((result) => withChineseDisplayTitle(result, resolvedTitles));
}

async function searchPlayStationHongKongVariant(
  query: string,
): Promise<PlayStationLookupResult[]> {
  try {
    const products = await searchPlayStationGraphQl(query);
    if (products.length) {
      return products
        .filter(isGameLikeProduct)
        .map((product) => toLookupResult(product, "playstation-hong-kong"))
        .filter((result): result is PlayStationLookupResult => Boolean(result));
    }
  } catch (graphQlError) {
    const legacyResults = await searchPlayStationPage(query);
    if (legacyResults.length) {
      return legacyResults;
    }

    throw graphQlError;
  }

  return searchPlayStationPage(query);
}

async function searchPlayStationGraphQl(
  query: string,
): Promise<PlayStationProduct[]> {
  const url = new URL(playStationGraphQlUrl);
  url.searchParams.set("operationName", playStationSearchOperation);
  url.searchParams.set(
    "variables",
    JSON.stringify({
      countryCode: "HK",
      languageCode: "ch",
      nextCursor: "",
      pageOffset: 0,
      pageSize: 24,
      searchTerm: query,
    }),
  );
  url.searchParams.set(
    "extensions",
    JSON.stringify({
      persistedQuery: {
        version: 1,
        sha256Hash: playStationSearchHash,
      },
    }),
  );

  const response = await fetch(url, {
    headers: {
      ...playStationHeaders(`${playStationStoreBaseUrl}/${playStationHongKongLocale}/`),
      accept: "application/json",
      "x-apollo-operation-name": playStationSearchOperation,
      "x-psn-app-ver": "@sie-ppr-web-store/app/0.113.0-",
      "x-psn-store-locale-override": "zh-Hant-HK",
    },
  });

  if (!response.ok) {
    throw new Error(`PlayStation search API returned ${response.status}`);
  }

  const payload = (await response.json()) as PlayStationSearchResponse;
  const apiError = payload.errors?.find((error) => error.message)?.message;
  if (apiError) {
    throw new Error(apiError);
  }

  const results = payload.data?.universalSearch?.results ?? [];
  return results
    .map(asSearchProduct)
    .filter((product): product is PlayStationProduct => Boolean(product));
}

async function searchPlayStationPage(
  query: string,
): Promise<PlayStationLookupResult[]> {
  const url = `${playStationStoreBaseUrl}/${playStationHongKongLocale}/search/${encodeURIComponent(
    query,
  )}`;
  const response = await fetch(url, {
    headers: playStationHeaders(url),
  });

  if (!response.ok) {
    throw new Error(`PlayStation Hong Kong search returned ${response.status}`);
  }

  const html = await response.text();
  const apolloState = extractApolloState(html);
  const products = extractSearchProducts(apolloState);

  return products
    .filter(isGameLikeProduct)
    .map((product) => toLookupResult(product, "playstation-hong-kong"))
    .filter((result): result is PlayStationLookupResult => Boolean(result));
}

async function fetchPlayStationPage(
  inputUrl: string,
): Promise<PlayStationLookupResult | null> {
  const productId = extractProductId(inputUrl);
  const url = `${playStationStoreBaseUrl}/${playStationHongKongLocale}/product/${productId}`;
  const response = await fetch(url, {
    headers: playStationHeaders(url),
  });

  if (!response.ok) {
    throw new Error(`PlayStation page returned ${response.status}`);
  }

  const html = await response.text();
  const product =
    extractProductFromEnvCaches(html, productId) ??
    extractProductFromApolloState(extractApolloState(html), productId);

  return product
    ? toLookupResult(
        product,
        "playstation-page",
        extractDisplayedHongKongPrice(html),
      )
    : null;
}

function playStationHeaders(referer: string) {
  return {
    "accept-language": "zh-HK,zh-TW;q=0.9,zh-CN;q=0.8,en;q=0.6",
    referer,
    "user-agent": "Mozilla/5.0 Game Purchase Ledger",
  };
}

async function buildPlayStationSearchVariants(
  query: string,
  resolvedTitles: ResolvedGameTitle[],
) {
  const trimmed = query.trim();
  const simplified = toSimplifiedChinese(trimmed);
  const traditional = toTraditionalChinese(simplified);
  const variants = new Set<string>();

  for (const title of resolvedTitles) {
    if (title.englishTitle) {
      variants.add(title.englishTitle);
    }
  }

  variants.add(trimmed);
  variants.add(simplified);
  variants.add(traditional);

  return [...variants].map((variant) => variant.trim()).filter(Boolean).slice(0, 8);
}

function extractProductId(inputUrl: string) {
  let url: URL;

  try {
    url = new URL(inputUrl);
  } catch {
    throw new Error("请输入有效的 PlayStation Store 商品页 URL");
  }

  if (
    url.protocol !== "https:" ||
    !["store.playstation.com", "www.playstation.com"].includes(
      url.hostname.toLowerCase(),
    )
  ) {
    throw new Error("仅支持 PlayStation 香港官方商品页");
  }

  const match = url.pathname.match(/\/product\/([^/?#]+)/i);
  const productId = match?.[1]?.trim();

  if (!productId) {
    throw new Error("无法从 PlayStation 页面 URL 识别商品 ID");
  }

  return productId;
}

function extractApolloState(html: string) {
  const nextData = extractScriptJson(html, "__NEXT_DATA__");
  const source = asRecord(nextData);
  if (!source) {
    return {};
  }

  const props = asRecord(source.props);
  const pageProps = asRecord(props?.pageProps);
  const state =
    asRecord(source.apolloState) ??
    asRecord(props?.apolloState) ??
    asRecord(pageProps?.apolloState);

  return asRecord(state) ?? {};
}

function extractScriptJson(html: string, scriptId: string) {
  const pattern = new RegExp(
    `<script[^>]+id=["']${escapeRegExp(scriptId)}["'][^>]*>([\\s\\S]*?)<\\/script>`,
    "i",
  );
  const match = html.match(pattern);

  if (!match) {
    return null;
  }

  return parseJson(match[1]);
}

function extractProductFromEnvCaches(html: string, productId: string) {
  const pattern =
    /<script[^>]+id=["']env:[^"']+["'][^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const candidates: PlayStationProduct[] = [];

  for (const match of html.matchAll(pattern)) {
    const payload = asRecord(parseJson(match[1]));
    const cache = asRecord(payload?.cache);

    if (!cache) {
      continue;
    }

    const exact = asProduct(cache[`Product:${productId}`]);
    if (exact && hasUsableProductData(exact)) {
      candidates.push(exact);
    }

    const products = Object.values(cache)
      .map(asProduct)
      .filter((item): item is PlayStationProduct =>
        Boolean(item && item.id === productId && hasUsableProductData(item)),
      );

    candidates.push(...products);
  }

  return candidates.sort(
    (left, right) => productDataScore(right) - productDataScore(left),
  )[0] ?? null;
}

function extractProductFromApolloState(
  apolloState: Record<string, unknown>,
  productId: string,
) {
  return (
    Object.values(apolloState)
      .map(asProduct)
      .find((product): product is PlayStationProduct =>
        Boolean(product && product.id === productId),
      ) ?? null
  );
}

function extractSearchProducts(apolloState: Record<string, unknown>) {
  const root = asRecord(apolloState.ROOT_QUERY);
  const search = root
    ? Object.entries(root).find(([key]) => key.startsWith("universalSearch("))?.[1]
    : null;
  const refs = Array.isArray(asRecord(search)?.results)
    ? (asRecord(search)?.results as unknown[])
    : [];
  const orderedProducts = refs
    .map((item) => {
      const ref = asRecord(item)?.__ref;
      return typeof ref === "string" ? asProduct(apolloState[ref]) : null;
    })
    .filter((product): product is PlayStationProduct => Boolean(product));

  if (orderedProducts.length) {
    return orderedProducts;
  }

  return Object.values(apolloState)
    .map(asProduct)
    .filter((product): product is PlayStationProduct =>
      Boolean(product && product.__typename === "Product"),
    );
}

function toLookupResult(
  product: PlayStationProduct,
  source: PlayStationLookupResult["source"],
  fallbackPrice: number | null = null,
): PlayStationLookupResult | null {
  if (!product.id || !product.name) {
    return null;
  }

  const coverUrl = selectCoverUrl(product);
  if (!coverUrl) {
    return null;
  }

  const price = parseHongKongPrice(product.price) ?? fallbackPrice;
  const classification =
    product.localizedStoreDisplayClassification || product.edition?.name || "";
  const platforms = Array.isArray(product.platforms)
    ? product.platforms.filter(Boolean)
    : [];

  return {
    id: product.id,
    title: normalizeChineseGameTitle(
      stripPlayStationStoreTitleMetadata(product.name),
    ),
    coverUrl,
    officialUrl: `${playStationStoreBaseUrl}/${playStationHongKongLocale}/product/${product.id}`,
    platform: normalizeChineseGameTitle(
      [platforms.join(" / ") || "PlayStation", classification]
        .filter(Boolean)
        .join(" · "),
    ),
    releaseDate: normalizeReleaseDate(product.releaseDate),
    price,
    currency: price === null ? null : "HKD",
    source,
  };
}

function withChineseDisplayTitle(
  result: PlayStationLookupResult,
  resolvedTitles: ResolvedGameTitle[],
): PlayStationLookupResult {
  const normalizedTitle = normalizeStoredGameTitle(
    stripPlayStationStoreTitleMetadata(result.title),
  );
  const chineseTitle = /[\u3400-\u9fff]/u.test(normalizedTitle)
    ? normalizedTitle
    : findChineseGameTitle(normalizedTitle, resolvedTitles);

  return chineseTitle
    ? { ...result, displayTitle: normalizeChineseGameTitle(chineseTitle) }
    : result;
}

function isGameLikeProduct(product: PlayStationProduct) {
  if (!product.id || !product.name) {
    return false;
  }

  if (
    product.storeDisplayClassification &&
    excludedClassifications.has(product.storeDisplayClassification)
  ) {
    return false;
  }

  return Array.isArray(product.platforms)
    ? product.platforms.some((platform) => /^PS[45]/i.test(platform))
    : true;
}

function hasUsableProductData(product: PlayStationProduct) {
  return Boolean(product.name && (product.media?.length || product.price));
}

function productDataScore(product: PlayStationProduct) {
  return [
    product.name ? 8 : 0,
    product.price ? 12 : 0,
    product.platforms?.length ? 8 : 0,
    product.localizedStoreDisplayClassification ? 5 : 0,
    product.storeDisplayClassification ? 4 : 0,
    product.edition?.name ? 3 : 0,
    product.media?.length ? 6 : 0,
    product.personalizedMeta?.media?.length ? 6 : 0,
  ].reduce((sum, value) => sum + value, 0);
}

function selectCoverUrl(product: PlayStationProduct) {
  const media = [
    ...(product.personalizedMeta?.media ?? []),
    ...(product.media ?? []),
  ].filter((item) => item.type === "IMAGE" && item.url);
  const rolePriority = [
    "GAMEHUB_COVER_ART",
    "MASTER",
    "EDITION_KEY_ART",
    "PORTRAIT_BANNER",
    "FOUR_BY_THREE_BANNER",
    "BACKGROUND",
  ];

  for (const role of rolePriority) {
    const match = media.find((item) => item.role === role);
    if (match?.url) {
      return optimizeImageUrl(match.url);
    }
  }

  return media[0]?.url ? optimizeImageUrl(media[0].url) : "";
}

function parseHongKongPrice(price: PlayStationProduct["price"]) {
  if (!price) {
    return null;
  }

  if (price.isFree) {
    return 0;
  }

  const text = price.discountedPrice || price.basePrice || "";
  const match = text.match(/HK\$\s*([\d,.]+)/i);

  if (!match) {
    return null;
  }

  const value = Number(match[1].replaceAll(",", ""));
  return Number.isFinite(value) ? value : null;
}

function extractDisplayedHongKongPrice(html: string) {
  const match = html.match(/HK\$\s*([\d,.]+)/i);

  if (!match) {
    return null;
  }

  const value = Number(match[1].replaceAll(",", ""));
  return Number.isFinite(value) ? value : null;
}

function normalizeReleaseDate(value: PlayStationProduct["releaseDate"]) {
  if (typeof value === "string" && value) {
    return value;
  }

  if (value && typeof value === "object" && typeof value.value === "string") {
    return value.value;
  }

  return null;
}

function optimizeImageUrl(input: string) {
  try {
    const url = new URL(input.replace(/^http:\/\//, "https://"));

    if (url.hostname === "image.api.playstation.com") {
      url.searchParams.delete("thumb");
      url.searchParams.set("w", "960");
    }

    return url.toString();
  } catch {
    return input;
  }
}

function dedupeResults(results: PlayStationLookupResult[]) {
  const seen = new Set<string>();

  return results.filter((result) => {
    const key = `${result.id}:${result.title}`.toLowerCase();

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function parseJson(value: string) {
  const text = value.trim();

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return JSON.parse(decodeHtmlEntities(text)) as unknown;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function asProduct(value: unknown): PlayStationProduct | null {
  const record = asRecord(value);

  if (!record || record.__typename !== "Product") {
    return null;
  }

  return record as PlayStationProduct;
}

function asSearchProduct(value: unknown): PlayStationProduct | null {
  const record = asRecord(value);

  if (!record || !["Product", "Concept"].includes(String(record.__typename))) {
    return null;
  }

  if (record.__typename === "Product") {
    return record as PlayStationProduct;
  }

  const concept = record as PlayStationProduct;
  const productId = concept.products?.find((product) => product.id)?.id;
  return productId ? { ...concept, id: productId } : null;
}

function decodeHtmlEntities(value: string) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#34;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
