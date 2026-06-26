const algoliaAppId = "U3B6GR4UA3";
const algoliaApiKey = "a29c6927638bfd8cee23993e51e721c9";
const algoliaIndex = "store_game_en_us";
const nintendoBaseUrl = "https://www.nintendo.com";
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

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/nintendo-cover") {
      return handleNintendoCover(request);
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      const indexRequest = new Request(new URL("/index.html", request.url), request);
      return env.ASSETS.fetch(indexRequest);
    }

    return env.ASSETS.fetch(request);
  },
};

export default worker;

async function handleNintendoCover(request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() ?? "";
  const pageUrl = searchParams.get("url")?.trim() ?? "";

  try {
    if (pageUrl) {
      const result = await fetchNintendoPageCover(pageUrl);
      return json({ results: result ? [result] : [] });
    }

    if (!query) {
      return json({ results: [] });
    }

    const results = await searchNintendo(query);
    return json({ results });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nintendo cover lookup failed";
    return json({ error: message, results: [] }, 502);
  }
}

async function searchNintendo(query) {
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

  const payload = await response.json();
  const hits = payload.results?.[0]?.hits ?? [];
  const seen = new Set();

  return hits
    .map((hit) => ({ hit, score: scoreHit(hit, query) }))
    .filter(({ score }) => score >= 30)
    .sort((left, right) => right.score - left.score)
    .map(({ hit }) => toCoverResult(hit))
    .filter(Boolean)
    .filter((result) => {
      const key = result.nintendoUrl || result.coverUrl || result.title;
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}

async function fetchNintendoPageCover(inputUrl) {
  const url = new URL(inputUrl);
  const host = url.hostname.toLowerCase();

  if (
    url.protocol !== "https:" ||
    (host !== "www.nintendo.com" && host !== "nintendo.com")
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

function toCoverResult(hit) {
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

function scoreHit(hit, query) {
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

function buildImageUrl(input) {
  if (!input) {
    return null;
  }

  if (input.startsWith("http://") || input.startsWith("https://")) {
    return input.replace(/^http:\/\//, "https://");
  }

  return `${imageBaseUrl}${input.replace(/^\/+/, "")}`;
}

function normalizeSearchText(value) {
  return value
    .normalize("NFKD")
    .replace(/[™®©]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function extractMetaContent(html, key) {
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

function extractCanonicalUrl(html) {
  const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];
  const tag = linkTags.find(
    (item) => item.includes('rel="canonical"') || item.includes("rel='canonical'"),
  );

  return tag ? decodeHtml(extractAttribute(tag, "href")) : null;
}

function extractAttribute(tag, attribute) {
  const pattern = new RegExp(`${attribute}=["']([^"']+)["']`, "i");
  return tag.match(pattern)?.[1] ?? null;
}

function decodeHtml(value) {
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

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
