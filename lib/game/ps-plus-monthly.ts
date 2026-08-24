import { normalizeStoredGameTitle } from "./title-normalization";
import { resolveChineseGameTitle } from "./title-resolution";

export type MonthlyGame = {
  title: string;
  coverUrl: string;
  officialUrl: string;
};

export type MonthlyGames = {
  games: MonthlyGame[];
  month: string;
  url: string;
};

type StoreMedia = { role?: string; type?: string; url?: string };
type StoreProduct = {
  __typename?: string;
  id?: string;
  name?: string;
  platforms?: string[];
  storeDisplayClassification?: string;
  media?: StoreMedia[];
  personalizedMeta?: { media?: StoreMedia[] };
  products?: Array<{ id?: string }>;
};

const storeBaseUrl = "https://store.playstation.com";
const storeLocale = "zh-hant-hk";
const graphQlUrl = "https://web.np.playstation.com/api/graphql/v1/op";
const searchHash = "4df6284f982e57bec70f23c77e2c219dc792eb19af7fb3d3a81767aa3f1958aa";

export function parsePsPlusMonthlyFeed(xml: string, now = new Date()): MonthlyGames | null {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
  const currentMonth = now.toLocaleString("en-US", { month: "long", timeZone: "UTC" });

  for (const match of items) {
    const item = match[1];
    const rawTitle = decodeEntities(textBetween(item, "title"));
    if (!/PlayStation Plus Monthly Games for/i.test(rawTitle) || /Game Catalog/i.test(rawTitle))
      continue;
    const monthName = rawTitle.match(/Monthly Games for ([A-Za-z]+)/i)?.[1];
    if (!monthName || monthName.toLowerCase() !== currentMonth.toLowerCase()) continue;
    const separator = rawTitle.match(/(?:–|—|:| - )/);
    if (!separator || separator.index === undefined) continue;
    const fallbackTitles = rawTitle
      .slice(separator.index + separator[0].length)
      .split(/,| and /i)
      .map((title) => title.trim())
      .filter(Boolean)
      .slice(0, 4);
    const articleUrl = decodeEntities(textBetween(item, "link"));
    const content = decodeEntities(textBetween(item, "content:encoded"), false);
    const sections = extractGameSections(content);
    const titles = sections.length ? sections.map((section) => section.title) : fallbackTitles;
    if (!titles.length) continue;
    const images = [...content.matchAll(/<img[^>]+(?:data-src|src)=["']([^"']+)["']/gi)]
      .map((image) => decodeEntities(image[1]))
      .filter((url, index, values) => url.startsWith("https://") && values.indexOf(url) === index);
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    return {
      month,
      url: articleUrl,
      games: titles.map((title, index) => ({
        title,
        coverUrl: sections[index]?.coverUrl || images[index] || "",
        officialUrl: articleUrl,
      })),
    };
  }
  return null;
}

function extractGameSections(content: string) {
  const headings = [
    ...content.matchAll(/<strong[^>]*>([\s\S]*?)\s*\|\s*PS(?:4|5)[^<]*<\/strong>/gi),
  ];
  return headings.slice(0, 4).flatMap((heading, index) => {
    if (heading.index === undefined) return [];
    const title = decodeEntities(heading[1]).trim();
    if (!title) return [];
    const end = headings[index + 1]?.index ?? content.length;
    const section = content.slice(heading.index, end);
    const coverUrl = decodeEntities(
      section.match(/<img[^>]+(?:data-src|src)=["']([^"']+)["']/i)?.[1] || "",
    );
    return [{ title, coverUrl: coverUrl.startsWith("https://") ? coverUrl : "" }];
  });
}

export async function enrichMonthlyGames(games: MonthlyGame[]) {
  return Promise.all(
    games.map(async (game) => {
      try {
        const official = await lookupOfficialGame(game.title);
        return (
          official ?? {
            ...game,
            title: (await resolveChineseGameTitle(game.title)) || game.title,
          }
        );
      } catch {
        return {
          ...game,
          title: (await resolveChineseGameTitle(game.title).catch(() => "")) || game.title,
        };
      }
    }),
  );
}

async function lookupOfficialGame(query: string): Promise<MonthlyGame | null> {
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
  if (!response.ok) return null;
  const payload = (await response.json()) as {
    data?: { universalSearch?: { results?: unknown[] } };
  };
  const products = (payload.data?.universalSearch?.results ?? [])
    .map(asSearchProduct)
    .filter((product): product is StoreProduct => Boolean(product));
  const ranked = products
    .map((product) => ({ product, score: productScore(product, query) }))
    .filter(({ score }) => score >= 80)
    .sort((left, right) => right.score - left.score);
  const product = ranked[0]?.product;
  const productId = product?.id;
  const coverUrl = product ? selectCoverUrl(product) : "";
  if (!product || !productId || !coverUrl) return null;
  const storedTitle = normalizeStoredGameTitle(product.name || query);
  const localizedTitle = /[\u3400-\u9fff]/u.test(storedTitle)
    ? storedTitle
    : (await resolveChineseGameTitle(query)) || storedTitle;
  return {
    title: localizedTitle,
    coverUrl,
    officialUrl: `${storeBaseUrl}/${storeLocale}/product/${productId}`,
  };
}

function productScore(product: StoreProduct, query: string) {
  if (!product.id || !product.name) return -1000;
  if (!product.platforms?.some((platform) => /^PS[45]$/i.test(platform))) return -1000;
  if (/demo|trial|add-on|追加内容|体验版|试玩|升级包/i.test(product.name)) return -1000;
  const candidate = comparableTitle(product.name);
  const expected = comparableTitle(query);
  if (!candidate || !expected) return -1000;
  if (candidate === expected) return 220;
  const lengthRatio =
    Math.min(candidate.length, expected.length) / Math.max(candidate.length, expected.length);
  if (lengthRatio >= 0.72 && (candidate.includes(expected) || expected.includes(candidate)))
    return 140;
  const expectedTokens = titleTokens(query);
  const candidateTokens = titleTokens(product.name);
  const overlap = expectedTokens.filter((token) => candidateTokens.includes(token)).length;
  return expectedTokens.length && overlap / expectedTokens.length >= 0.8 ? 90 : 0;
}

function titleTokens(value: string) {
  return value
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

function textBetween(value: string, tag: string) {
  return (
    value
      .match(
        new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i"),
      )?.[1]
      ?.trim() || ""
  );
}

function decodeEntities(value: string, stripTags = true) {
  const decoded = value
    .replace(/&#8211;|&#8212;|&ndash;|&mdash;/g, "–")
    .replace(/&#8217;|&apos;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
  return stripTags ? decoded.replace(/<[^>]+>/g, "") : decoded;
}
