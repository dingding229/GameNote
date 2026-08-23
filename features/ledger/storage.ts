import {
  currencies,
  exchangeCacheKey,
  gameFormats,
  gamePlatforms,
  regions,
  storageKey,
} from "./constants";
import type {
  Currency,
  ExchangeRatePayload,
  GameFormat,
  GamePlatform,
  GameRecord,
  LedgerDocument,
  Region,
} from "./types";
import {
  createId,
  isPhysicalFormat,
  normalizeFormatForPlatform,
  physicalFormatForPlatform,
} from "./utils";

export function normalizeImportedRecord(value: unknown): GameRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<GameRecord> & {
    condition?: unknown;
    nintendoUrl?: unknown;
    playstationUrl?: unknown;
  };
  if (!record.title || typeof record.title !== "string") return null;
  const platform = gamePlatforms.includes(record.platform as GamePlatform)
    ? (record.platform as GamePlatform)
    : typeof record.playstationUrl === "string" && record.playstationUrl
      ? "PlayStation"
      : "Nintendo Switch";
  const currency = currencies.includes(record.currency as Currency)
    ? (record.currency as Currency)
    : "CNY";
  const region = regions.includes(record.region as Region) ? (record.region as Region) : "其他";
  const rawFormat = gameFormats.includes(record.format as GameFormat)
    ? (record.format as GameFormat)
    : record.condition === "数字版"
      ? "数字版"
      : physicalFormatForPlatform(platform);
  const format = normalizeFormatForPlatform(rawFormat, platform);
  const soldDate =
    isPhysicalFormat(format) && typeof record.soldDate === "string" && record.soldDate
      ? record.soldDate
      : "";
  const soldCurrency = currencies.includes(record.soldCurrency as Currency)
    ? (record.soldCurrency as Currency)
    : currency;
  const officialUrl =
    typeof record.officialUrl === "string"
      ? record.officialUrl
      : typeof record.nintendoUrl === "string"
        ? record.nintendoUrl
        : typeof record.playstationUrl === "string"
          ? record.playstationUrl
          : "";
  return {
    id: typeof record.id === "string" ? record.id : createId(),
    platform,
    title: record.title.trim(),
    price: Number(record.price) || 0,
    currency,
    purchaseDate:
      typeof record.purchaseDate === "string" && record.purchaseDate
        ? record.purchaseDate
        : new Date().toISOString().slice(0, 10),
    region,
    format,
    seller: isPhysicalFormat(format) && typeof record.seller === "string" ? record.seller : "",
    coverUrl: typeof record.coverUrl === "string" ? record.coverUrl : "",
    officialUrl,
    notes: typeof record.notes === "string" ? record.notes : "",
    soldDate,
    soldPrice: soldDate ? Number(record.soldPrice) || 0 : 0,
    soldCurrency,
  };
}

export async function fetchLedgerFromServer(): Promise<LedgerDocument> {
  const response = await fetch("/api/records", { cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as
    | Partial<LedgerDocument>
    | { error?: string };
  if (!response.ok)
    throw new Error(
      "error" in payload && payload.error
        ? payload.error
        : `无法读取服务端记录（HTTP ${response.status}）`,
    );
  const records = "records" in payload ? payload.records : null;
  return {
    version: 1,
    updatedAt:
      "updatedAt" in payload && typeof payload.updatedAt === "string" ? payload.updatedAt : "",
    records: Array.isArray(records)
      ? records
          .map(normalizeImportedRecord)
          .filter((record): record is GameRecord => Boolean(record))
      : [],
  };
}

export async function saveLedgerToServer(records: GameRecord[]) {
  const response = await fetch("/api/records", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ records }),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok)
    throw new Error(payload.error || `保存服务端记录失败（HTTP ${response.status}）`);
}

export function readCachedExchangeRates() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(exchangeCacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isExchangeRatePayload(parsed) ? parsed : null;
  } catch {
    window.localStorage.removeItem(exchangeCacheKey);
    return null;
  }
}

export function isExchangeRatePayload(value: unknown): value is ExchangeRatePayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<ExchangeRatePayload>;
  return (
    payload.base === "CNY" &&
    typeof payload.date === "string" &&
    typeof payload.source === "string" &&
    Boolean(payload.rates) &&
    currencies.every((currency) => {
      const rate = payload.rates?.[currency];
      return typeof rate === "number" && Number.isFinite(rate) && rate > 0;
    })
  );
}

export function loadLegacyLocalRecords() {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    const parsedRecords = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && "records" in parsed
        ? (parsed as { records?: unknown }).records
        : null;
    if (!Array.isArray(parsedRecords)) return [];
    return parsedRecords
      .map(normalizeImportedRecord)
      .filter((record): record is GameRecord => Boolean(record));
  } catch {
    window.localStorage.removeItem(storageKey);
    return [];
  }
}
