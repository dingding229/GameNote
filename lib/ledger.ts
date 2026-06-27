export type Region = "日版" | "港版" | "美版" | "欧版" | "其他";
export type GameFormat = "实体卡带" | "数字版";
export type Currency = "CNY" | "JPY" | "HKD" | "USD";

export type GameRecord = {
  id: string;
  title: string;
  price: number;
  currency: Currency;
  purchaseDate: string;
  region: Region;
  format: GameFormat;
  seller: string;
  coverUrl: string;
  nintendoUrl: string;
  notes: string;
  soldDate: string;
  soldPrice: number;
  soldCurrency: Currency;
  playTimeMinutes: number;
  playTimeUpdatedAt: string;
  firstPlayedDate: string;
  lastPlayedDate: string;
};

export type NintendoAccountBinding = {
  displayName: string;
  friendCode: string;
  linkedAt: string;
  playtimeUpdatedAt: string;
};

export type LedgerDocument = {
  version: 1;
  updatedAt: string;
  account: NintendoAccountBinding | null;
  records: GameRecord[];
};

export const currencies = ["CNY", "JPY", "HKD", "USD"] as const;
export const regions = ["日版", "港版", "美版", "欧版", "其他"] as const;
export const gameFormats = ["实体卡带", "数字版"] as const;

export function createEmptyLedger(): LedgerDocument {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    account: null,
    records: [],
  };
}

export function createLedgerDocument(
  account: NintendoAccountBinding | null,
  records: GameRecord[],
): LedgerDocument {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    account,
    records,
  };
}

export function normalizeLedgerDocument(value: unknown): LedgerDocument {
  if (Array.isArray(value)) {
    return {
      ...createEmptyLedger(),
      records: normalizeRecords(value),
    };
  }

  const source = value && typeof value === "object" ? value : null;
  const rawRecords =
    source && "records" in source
      ? (source as { records?: unknown }).records
      : null;
  const updatedAt =
    source && "updatedAt" in source
      ? String((source as { updatedAt?: unknown }).updatedAt || "")
      : "";

  return {
    version: 1,
    updatedAt: updatedAt || new Date(0).toISOString(),
    account: normalizeAccount(
      source && "account" in source
        ? (source as { account?: unknown }).account
        : null,
    ),
    records: Array.isArray(rawRecords) ? normalizeRecords(rawRecords) : [],
  };
}

export function normalizeRecords(values: unknown[]): GameRecord[] {
  return values
    .map(normalizeRecord)
    .filter((record): record is GameRecord => Boolean(record));
}

export function normalizeRecord(value: unknown): GameRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Partial<GameRecord> & { condition?: unknown };
  if (!record.title || typeof record.title !== "string") {
    return null;
  }

  const currency = currencies.includes(record.currency as Currency)
    ? (record.currency as Currency)
    : "CNY";
  const region = regions.includes(record.region as Region)
    ? (record.region as Region)
    : "其他";
  const format = gameFormats.includes(record.format as GameFormat)
    ? (record.format as GameFormat)
    : record.condition === "数字版"
      ? "数字版"
      : "实体卡带";
  const soldDate =
    format === "实体卡带" &&
    typeof record.soldDate === "string" &&
    record.soldDate
      ? record.soldDate
      : "";
  const soldCurrency = currencies.includes(record.soldCurrency as Currency)
    ? (record.soldCurrency as Currency)
    : currency;

  return {
    id: typeof record.id === "string" ? record.id : createId(),
    title: record.title.trim(),
    price: Number(record.price) || 0,
    currency,
    purchaseDate:
      typeof record.purchaseDate === "string" && record.purchaseDate
        ? record.purchaseDate
        : new Date().toISOString().slice(0, 10),
    region,
    format,
    seller: typeof record.seller === "string" ? record.seller : "",
    coverUrl: typeof record.coverUrl === "string" ? record.coverUrl : "",
    nintendoUrl: typeof record.nintendoUrl === "string" ? record.nintendoUrl : "",
    notes: typeof record.notes === "string" ? record.notes : "",
    soldDate,
    soldPrice: soldDate ? Number(record.soldPrice) || 0 : 0,
    soldCurrency,
    playTimeMinutes: Math.max(0, Math.round(Number(record.playTimeMinutes) || 0)),
    playTimeUpdatedAt:
      typeof record.playTimeUpdatedAt === "string" ? record.playTimeUpdatedAt : "",
    firstPlayedDate:
      typeof record.firstPlayedDate === "string" ? record.firstPlayedDate : "",
    lastPlayedDate:
      typeof record.lastPlayedDate === "string" ? record.lastPlayedDate : "",
  };
}

export function normalizeAccount(
  value: unknown,
  fallback: NintendoAccountBinding | null = null,
): NintendoAccountBinding | null {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const account = value as Partial<NintendoAccountBinding>;
  const displayName =
    typeof account.displayName === "string" ? account.displayName.trim() : "";
  const friendCode =
    typeof account.friendCode === "string"
      ? account.friendCode.trim().toUpperCase()
      : "";

  if (!displayName && !friendCode) {
    return null;
  }

  return {
    displayName,
    friendCode,
    linkedAt:
      typeof account.linkedAt === "string" && account.linkedAt
        ? account.linkedAt
        : fallback?.linkedAt || new Date().toISOString(),
    playtimeUpdatedAt:
      typeof account.playtimeUpdatedAt === "string"
        ? account.playtimeUpdatedAt
        : fallback?.playtimeUpdatedAt || "",
  };
}

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
