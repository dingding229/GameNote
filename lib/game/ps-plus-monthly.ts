import { normalizeStoredGameTitle, toSimplifiedChinese } from "./title-normalization";
import { findChineseGameTitle, resolveGameTitles } from "./title-resolution";

export type MonthlyGame = { title: string };

export type OfficialMonthlyGame = MonthlyGame & {
  sourceTitle: string;
  coverUrl: string;
  officialUrl: string;
};

export type MonthlyGames = {
  games: MonthlyGame[];
  month: string;
  url: string;
};

type StoreMedia = { role?: string; type?: string; url?: string };
export type StoreProduct = {
  __typename?: string;
  id?: string;
  name?: string;
  platforms?: string[];
  media?: StoreMedia[];
  personalizedMeta?: { media?: StoreMedia[] };
  products?: Array<{ id?: string }>;
};

const storeBaseUrl = "https://store.playstation.com";
const storeLocale = "zh-hant-hk";
const graphQlUrl = "https://web.np.playstation.com/api/graphql/v1/op";
const searchHash = "4df6284f982e57bec70f23c77e2c219dc792eb19af7fb3d3a81767aa3f1958aa";

export function parsePsPlusMonthlyFeed(
  xml: string,
  now = new Date(),
  requestedMonth = "",
): MonthlyGames | null {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
  const target = parseRequestedMonth(requestedMonth, now);
  const currentMonth = new Date(Date.UTC(target.year, target.monthIndex, 1)).toLocaleString(
    "en-US",
    {
      month: "long",
      timeZone: "UTC",
    },
  );

  for (const match of items) {
    const item = match[1];
    const rawTitle = decodeEntities(textBetween(item, "title"));
    if (!/PlayStation Plus Monthly Games for/i.test(rawTitle) || /Game Catalog/i.test(rawTitle))
      continue;
    const monthName = rawTitle.match(/Monthly Games for ([A-Za-z]+)/i)?.[1];
    if (!monthName || monthName.toLowerCase() !== currentMonth.toLowerCase()) continue;
    const publishedAt = new Date(decodeEntities(textBetween(item, "pubDate")));
    if (requestedMonth && !articleDateMatchesMonth(publishedAt, target.year, target.monthIndex))
      continue;
    const articleUrl = decodeEntities(textBetween(item, "link"));
    const content = decodeEntities(textBetween(item, "content:encoded"), false);
    const sectionTitles = extractGameTitles(content);
    const titles = sectionTitles.length ? sectionTitles : extractHeadlineTitles(rawTitle);
    if (!titles.length) continue;
    const month = `${target.year}-${String(target.monthIndex + 1).padStart(2, "0")}`;
    return {
      month,
      url: articleUrl,
      games: titles.slice(0, 4).map((title) => ({ title })),
    };
  }
  return null;
}

function parseRequestedMonth(value: string, fallback: Date) {
  const match = value.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  return match
    ? { year: Number(match[1]), monthIndex: Number(match[2]) - 1 }
    : { year: fallback.getUTCFullYear(), monthIndex: fallback.getUTCMonth() };
}

function articleDateMatchesMonth(date: Date, year: number, monthIndex: number) {
  if (!Number.isFinite(date.getTime())) return false;
  const monthStart = Date.UTC(year, monthIndex, 1);
  const earliestAnnouncement = monthStart - 45 * 24 * 60 * 60 * 1000;
  const latestAnnouncement = monthStart + 15 * 24 * 60 * 60 * 1000;
  return date.getTime() >= earliestAnnouncement && date.getTime() <= latestAnnouncement;
}

function extractGameTitles(content: string) {
  return [...content.matchAll(/<(h[2-4]|p)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)]
    .map((heading) => decodeEntities(stripTags(heading[2])).replace(/\s+/g, " ").trim())
    .filter((heading) => /\|\s*PS(?:4|5)\b/i.test(heading))
    .map((heading) => heading.split(/\s*\|\s*PS(?:4|5)\b/i)[0].trim())
    .filter((title, index, titles) => Boolean(title) && titles.indexOf(title) === index);
}

function extractHeadlineTitles(rawTitle: string) {
  const separator = rawTitle.match(/(?:–|—|:| - )/);
  if (!separator || separator.index === undefined) return [];
  return rawTitle
    .slice(separator.index + separator[0].length)
    .split(/,| and /i)
    .map((title) => title.trim())
    .filter(Boolean);
}

export async function enrichMonthlyGames(games: MonthlyGame[]) {
  const results = await Promise.all(
    games.map(async (game) => {
      try {
        return await lookupOfficialGame(game.title);
      } catch {
        return null;
      }
    }),
  );
  return {
    games: results.filter((game): game is OfficialMonthlyGame => Boolean(game)),
    unresolved: games.filter((_, index) => !results[index]).map((game) => game.title),
  };
}

async function lookupOfficialGame(query: string): Promise<OfficialMonthlyGame | null> {
  const resolvedTitles = await resolveGameTitles(query);
  const searchVariants = [
    query,
    ...resolvedTitles.flatMap((title) => [title.chineseTitle, title.englishTitle]),
  ]
    .map((title) => title.trim())
    .filter((title, index, titles) => Boolean(title) && titles.indexOf(title) === index)
    .slice(0, 4);
  const products: StoreProduct[] = [];
  let product: StoreProduct | undefined;
  for (const variant of searchVariants) {
    try {
      products.push(...(await searchStoreProducts(variant)));
      product = selectStoreProduct(products, query, searchVariants);
      if (product && selectCoverUrl(product)) break;
    } catch {
      // Continue with the next localized search variant.
    }
  }
  const productId = product?.id;
  const coverUrl = product ? selectCoverUrl(product) : "";
  if (!product || !productId || !coverUrl) return null;
  const storeTitle = normalizeStoredGameTitle(product.name || query);
  const localizedTitle =
    findChineseGameTitle(query, resolvedTitles) || findChineseGameTitle(storeTitle, resolvedTitles);
  return {
    title: localizedTitle || storeTitle,
    sourceTitle: query.trim(),
    coverUrl,
    officialUrl: `${storeBaseUrl}/${storeLocale}/product/${encodeURIComponent(productId)}`,
  };
}

async function searchStoreProducts(query: string) {
  const url = new URL(graphQlUrl);
  url.searchParams.set("operationName", "getSearchResults");
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
    JSON.stringify({ persistedQuery: { version: 1, sha256Hash: searchHash } }),
  );
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "accept-language": "zh-HK,zh-TW;q=0.9,zh-CN;q=0.8,en;q=0.6",
      referer: `${storeBaseUrl}/${storeLocale}/`,
      "user-agent": "GameNote/1.0",
      "x-apollo-operation-name": "getSearchResults",
      "x-psn-app-ver": "@sie-ppr-web-store/app/0.113.0-",
      "x-psn-store-locale-override": "zh-Hant-HK",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) return [];
  const payload = (await response.json()) as {
    data?: { universalSearch?: { results?: unknown[] } };
  };
  return (payload.data?.universalSearch?.results ?? [])
    .map(asSearchProduct)
    .filter((product): product is StoreProduct => Boolean(product));
}

export function selectStoreProduct(products: StoreProduct[], query: string, aliases = [query]) {
  return products
    .map((product) => ({
      product,
      score: Math.max(...[query, ...aliases].map((alias) => productScore(product, alias))),
    }))
    .filter(({ score }) => score >= 80)
    .sort((left, right) => right.score - left.score)[0]?.product;
}

function productScore(product: StoreProduct, query: string) {
  if (!product.id || !product.name) return -1000;
  if (!product.platforms?.some((platform) => /^PS[45]$/i.test(platform))) return -1000;
  if (
    /demo|trial|add-on|追加内容|體驗版|体验版|試玩|试玩|升級包|升级包|digital extras|\bbundle\b|\bpack\b|\bdlc\b|season pass|點數|点数/i.test(
      product.name,
    )
  )
    return -1000;
  const candidate = comparableTitle(product.name);
  const expected = comparableTitle(query);
  if (!candidate || !expected) return -1000;
  if (candidate === expected) return 240;
  if (candidate.includes(expected)) return 190;
  if (expected.includes(candidate) && candidate.length / expected.length >= 0.65) return 170;
  const expectedTokens = titleTokens(query).filter((token) => token !== "edition");
  const candidateTokens = titleTokens(product.name).filter((token) => token !== "edition");
  const overlap = expectedTokens.filter((token) => candidateTokens.includes(token)).length;
  const coverage = expectedTokens.length ? overlap / expectedTokens.length : 0;
  return coverage >= 0.75 ? 100 + Math.round(coverage * 30) : 0;
}

function titleTokens(value: string) {
  return toSimplifiedChinese(value)
    .toLowerCase()
    .replace(/[™®©]/g, "")
    .split(/[^a-z0-9\u3400-\u9fff]+/u)
    .filter((token) => token.length > 1);
}

function comparableTitle(value: string) {
  return titleTokens(value).join("");
}

function selectCoverUrl(product: StoreProduct) {
  const media = [...(product.personalizedMeta?.media ?? []), ...(product.media ?? [])].filter(
    (item) => item.type === "IMAGE" && item.url,
  );
  for (const role of ["GAMEHUB_COVER_ART", "MASTER", "EDITION_KEY_ART", "PORTRAIT_BANNER"]) {
    const match = media.find((item) => item.role === role);
    if (match?.url) return optimizeImageUrl(match.url);
  }
  return media[0]?.url ? optimizeImageUrl(media[0].url) : "";
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

function asSearchProduct(value: unknown): StoreProduct | null {
  if (!value || typeof value !== "object") return null;
  const record = value as StoreProduct;
  if (!record.__typename || !["Product", "Concept"].includes(record.__typename)) return null;
  if (record.__typename === "Product") return record;
  const productId = record.products?.find((product) => product.id)?.id;
  return productId ? { ...record, id: productId } : null;
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, " ");
}

function textBetween(value: string, tag: string) {
  return (
    value
      .match(
        new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i"),
      )?.[1]
      ?.trim() || ""
  );
}

function decodeEntities(value: string, removeMarkup = true) {
  const decoded = value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
  return removeMarkup ? stripTags(decoded) : decoded;
}
