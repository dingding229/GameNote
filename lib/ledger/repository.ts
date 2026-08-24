import {
  createEmptyLedger,
  currencies,
  type Currency,
  type LedgerDocument,
  normalizeLedgerDocument,
} from "./schema";
import { defaultThemeColor, isAccessibleThemeColor } from "@/lib/ui/theme-color";
import { validLedgerNumber } from "./limits";

export type StatementSync = {
  get(...values: unknown[]): unknown;
  run(...values: unknown[]): unknown;
  all?(...values: unknown[]): unknown[];
};

type StatementRunResult = { changes?: number | bigint };

export type DatabaseSync = {
  close(): void;
  prepare(sql: string): StatementSync;
};

type LedgerSqliteModule = {
  DatabaseSync: new (path: string) => DatabaseSync;
};

type FsPromises = {
  mkdir(path: string, options: { recursive: boolean }): Promise<unknown>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
};

type LedgerRow = {
  records?: unknown;
  updated_at?: unknown;
};

const ledgerId = "default";

export async function readLedgerFromSqlite(): Promise<LedgerDocument> {
  const { db } = await openLedgerDatabase();

  try {
    ensureLedgerTable(db);

    const row = db
      .prepare("SELECT records, updated_at FROM ledger_documents WHERE id = ?")
      .get(ledgerId) as LedgerRow | undefined;

    if (row) {
      return normalizeLedgerDocument({
        updatedAt: typeof row.updated_at === "string" ? row.updated_at : "",
        records: parseStoredJson(row.records, []),
      });
    }

    const migrated = await readLegacyJsonLedger();
    if (migrated && hasLedgerData(migrated)) {
      writeLedgerToOpenSqlite(db, migrated);
      return migrated;
    }

    return createEmptyLedger();
  } finally {
    db.close();
  }
}

export class LedgerConflictError extends Error {
  constructor() {
    super("LEDGER_CONFLICT");
    this.name = "LedgerConflictError";
  }
}

export async function writeLedgerToSqlite(document: LedgerDocument, expectedUpdatedAt?: string) {
  const { db } = await openLedgerDatabase();

  try {
    ensureLedgerTable(db);
    if (!writeLedgerToOpenSqlite(db, document, expectedUpdatedAt)) throw new LedgerConflictError();
  } finally {
    db.close();
  }
}

export type AppUser = {
  id: string;
  username: string;
  passwordHash: string;
  sessionVersion: number;
};

export async function getRegisteredUser(): Promise<AppUser | null> {
  const { db } = await openLedgerDatabase();
  try {
    ensureUserTable(db);
    const row = db
      .prepare(
        "SELECT id, username, password_hash, session_version FROM app_users ORDER BY created_at LIMIT 1",
      )
      .get() as
      | {
          id?: unknown;
          username?: unknown;
          password_hash?: unknown;
          session_version?: unknown;
        }
      | undefined;
    if (
      !row ||
      typeof row.id !== "string" ||
      typeof row.username !== "string" ||
      typeof row.password_hash !== "string"
    )
      return null;
    return {
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash,
      sessionVersion:
        typeof row.session_version === "number" && Number.isInteger(row.session_version)
          ? row.session_version
          : 1,
    };
  } finally {
    db.close();
  }
}

export async function createRegisteredUser(user: AppUser) {
  const { db } = await openLedgerDatabase();
  try {
    ensureUserTable(db);
    if (db.prepare("SELECT id FROM app_users LIMIT 1").get()) throw new Error("OWNER_EXISTS");
    db.prepare(
      "INSERT INTO app_users (id, username, password_hash, session_version, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(user.id, user.username, user.passwordHash, user.sessionVersion, new Date().toISOString());
  } finally {
    db.close();
  }
}

export async function updateRegisteredUserPassword(passwordHash: string) {
  const { db } = await openLedgerDatabase();
  try {
    ensureUserTable(db);
    db.prepare(
      "UPDATE app_users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?",
    ).run(passwordHash, "owner");
  } finally {
    db.close();
  }
}

export type AppSettings = {
  siteTitle: string;
  avatarUrl: string;
  themeColor: string;
  showNintendoSwitch: boolean;
  showPlayStation: boolean;
  showPsPlusCatalog: boolean;
  showMemberships: boolean;
  aiBaseUrl: string;
  aiModel: string;
  aiApiKey: string;
  psPlusEnabled: boolean;
  psPlusExpiresAt: string;
  psPlusAutoAddMonthly: boolean;
  nsOnlineEnabled: boolean;
  nsOnlineExpiresAt: string;
  membershipPeriods: MembershipPeriod[];
};

export type MembershipService = "Nintendo Switch Online" | "PlayStation Plus";

export type MembershipPeriod = {
  id: string;
  service: MembershipService;
  startDate: string;
  endDate: string;
  price: number;
  currency: Currency;
};

export async function readAppSettings(): Promise<AppSettings> {
  const { db } = await openLedgerDatabase();
  try {
    ensureSettingsTable(db);
    const row = db.prepare("SELECT value FROM app_settings WHERE id = ?").get("default") as
      | { value?: unknown }
      | undefined;
    return normalizeAppSettings(parseStoredJson(row?.value, {}));
  } finally {
    db.close();
  }
}

export async function writeAppSettings(settings: AppSettings) {
  const { db } = await openLedgerDatabase();
  try {
    ensureSettingsTable(db);
    db.prepare(
      `INSERT INTO app_settings (id, value) VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET value = excluded.value`,
    ).run("default", JSON.stringify(settings));
  } finally {
    db.close();
  }
}

export type AppCacheEntry = {
  value: unknown;
  expiresAt: string;
  updatedAt: string;
};

export async function readAppCache(key: string): Promise<AppCacheEntry | null> {
  const { db } = await openLedgerDatabase();
  try {
    ensureCacheTable(db);
    const row = db
      .prepare("SELECT value, expires_at, updated_at FROM app_cache WHERE id = ?")
      .get(key) as { value?: unknown; expires_at?: unknown; updated_at?: unknown } | undefined;
    if (!row || typeof row.expires_at !== "string" || typeof row.updated_at !== "string")
      return null;
    return {
      value: parseStoredJson(row.value, null),
      expiresAt: row.expires_at,
      updatedAt: row.updated_at,
    };
  } finally {
    db.close();
  }
}

export async function writeAppCache(key: string, value: unknown, expiresAt: string) {
  const { db } = await openLedgerDatabase();
  try {
    ensureCacheTable(db);
    db.prepare(
      `INSERT INTO app_cache (id, value, expires_at, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET value = excluded.value,
        expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
    ).run(key, JSON.stringify(value), expiresAt, new Date().toISOString());
  } finally {
    db.close();
  }
}

function ensureLedgerTable(db: DatabaseSync) {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS ledger_documents (
      id TEXT PRIMARY KEY NOT NULL,
      records TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    )`,
  ).run();
}

function ensureUserTable(db: DatabaseSync) {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS app_users (
      id TEXT PRIMARY KEY NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      session_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )`,
  ).run();
  const columns = db.prepare("PRAGMA table_info(app_users)").all?.() as
    | Array<{ name?: unknown }>
    | undefined;
  if (!columns?.some((column) => column.name === "session_version")) {
    try {
      db.prepare(
        "ALTER TABLE app_users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1",
      ).run();
    } catch (error) {
      if (!String(error).toLowerCase().includes("duplicate column")) throw error;
    }
  }
}

function ensureSettingsTable(db: DatabaseSync) {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS app_settings (
    id TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL DEFAULT '{}'
  )`,
  ).run();
}

function ensureCacheTable(db: DatabaseSync) {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS app_cache (
    id TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  ).run();
}

export function normalizeAppSettings(value: unknown): AppSettings {
  const source = value && typeof value === "object" ? (value as Partial<AppSettings>) : {};
  const membershipPeriods = normalizeMembershipPeriods(source.membershipPeriods, source);
  const today = new Date().toISOString().slice(0, 10);
  const activePsPlus = activeMembershipPeriods(membershipPeriods, "PlayStation Plus", today);
  const activeNsOnline = activeMembershipPeriods(
    membershipPeriods,
    "Nintendo Switch Online",
    today,
  );
  return {
    siteTitle:
      typeof source.siteTitle === "string" && source.siteTitle.trim()
        ? source.siteTitle.trim().slice(0, 40)
        : "GameNote",
    avatarUrl: typeof source.avatarUrl === "string" ? source.avatarUrl : "",
    themeColor:
      typeof source.themeColor === "string" && isAccessibleThemeColor(source.themeColor)
        ? source.themeColor
        : defaultThemeColor,
    showNintendoSwitch: source.showNintendoSwitch !== false,
    showPlayStation: source.showPlayStation !== false,
    showPsPlusCatalog: source.showPsPlusCatalog !== false,
    showMemberships: source.showMemberships !== false,
    aiBaseUrl:
      typeof source.aiBaseUrl === "string" && source.aiBaseUrl
        ? source.aiBaseUrl
        : "https://api.openai.com/v1",
    aiModel: typeof source.aiModel === "string" && source.aiModel ? source.aiModel : "gpt-4.1-mini",
    aiApiKey: typeof source.aiApiKey === "string" ? source.aiApiKey : "",
    psPlusEnabled: activePsPlus.length > 0,
    psPlusExpiresAt: latestMembershipEndDate(activePsPlus),
    psPlusAutoAddMonthly: source.psPlusAutoAddMonthly !== false,
    nsOnlineEnabled: activeNsOnline.length > 0,
    nsOnlineExpiresAt: latestMembershipEndDate(activeNsOnline),
    membershipPeriods,
  };
}

export function normalizeMembershipPeriods(
  value: unknown,
  legacy?: Partial<AppSettings>,
): MembershipPeriod[] {
  if (Array.isArray(value)) {
    const periods = value
      .slice(0, 200)
      .flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const source = item as Partial<MembershipPeriod>;
        if (source.service !== "Nintendo Switch Online" && source.service !== "PlayStation Plus")
          return [];
        const startDate = normalizeMembershipDate(source.startDate);
        const endDate = normalizeMembershipDate(source.endDate);
        if (
          (typeof source.startDate === "string" && source.startDate && !startDate) ||
          !endDate ||
          (startDate && startDate > endDate)
        )
          return [];
        const currency = currencies.includes(source.currency as Currency)
          ? (source.currency as Currency)
          : "CNY";
        return [
          {
            id:
              typeof source.id === "string" && source.id.trim()
                ? source.id.trim().slice(0, 100)
                : crypto.randomUUID(),
            service: source.service,
            startDate,
            endDate,
            price: validLedgerNumber(source.price),
            currency,
          },
        ];
      })
      .sort((left, right) => right.endDate.localeCompare(left.endDate));
    return periods.filter(
      (period, index) => periods.findIndex((candidate) => candidate.id === period.id) === index,
    );
  }

  const migrated: MembershipPeriod[] = [];
  if (legacy?.nsOnlineEnabled && normalizeMembershipDate(legacy.nsOnlineExpiresAt)) {
    migrated.push({
      id: "legacy-ns-online",
      service: "Nintendo Switch Online",
      startDate: "",
      endDate: normalizeMembershipDate(legacy.nsOnlineExpiresAt),
      price: 0,
      currency: "CNY",
    });
  }
  if (legacy?.psPlusEnabled && normalizeMembershipDate(legacy.psPlusExpiresAt)) {
    migrated.push({
      id: "legacy-ps-plus",
      service: "PlayStation Plus",
      startDate: "",
      endDate: normalizeMembershipDate(legacy.psPlusExpiresAt),
      price: 0,
      currency: "CNY",
    });
  }
  return migrated;
}

export function activeMembershipPeriods(
  periods: MembershipPeriod[],
  service: MembershipService,
  today = new Date().toISOString().slice(0, 10),
) {
  return periods.filter(
    (period) =>
      period.service === service &&
      (!period.startDate || period.startDate <= today) &&
      period.endDate >= today,
  );
}

function normalizeMembershipDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  try {
    return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value ? value : "";
  } catch {
    return "";
  }
}

function latestMembershipEndDate(periods: MembershipPeriod[]) {
  return periods.reduce(
    (latest, period) => (period.endDate > latest ? period.endDate : latest),
    "",
  );
}

function writeLedgerToOpenSqlite(
  db: DatabaseSync,
  document: LedgerDocument,
  expectedUpdatedAt?: string,
) {
  if (expectedUpdatedAt === undefined) {
    db.prepare(
      `INSERT INTO ledger_documents (id, records, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         records = excluded.records,
         updated_at = excluded.updated_at`,
    ).run(ledgerId, JSON.stringify(document.records), document.updatedAt);
    return true;
  }

  const result = db
    .prepare(
      `INSERT INTO ledger_documents (id, records, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         records = excluded.records,
         updated_at = excluded.updated_at
       WHERE ledger_documents.updated_at = ?`,
    )
    .run(
      ledgerId,
      JSON.stringify(document.records),
      document.updatedAt,
      expectedUpdatedAt,
    ) as StatementRunResult;
  return Number(result.changes ?? 0) > 0;
}

export async function openLedgerDatabase() {
  const [sqlite, fs] = await Promise.all([loadNodeSqlite(), loadFsPromises()]);
  const filePath = databaseFilePath();
  const directory = dirnamePath(filePath);

  try {
    await fs.mkdir(directory, { recursive: true });
  } catch (error) {
    throw new Error(describeDatabaseDirectoryError(directory, error));
  }

  return {
    db: new sqlite.DatabaseSync(filePath),
    filePath,
  };
}

async function readLegacyJsonLedger() {
  const fs = await loadFsPromises();

  try {
    const raw = await fs.readFile(legacyJsonFilePath(), "utf8");
    const source = stripJsonBom(raw).trim();

    if (!source) {
      return null;
    }

    return normalizeLedgerDocument(JSON.parse(source) as unknown);
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }

    console.error("Failed to migrate legacy JSON ledger", error);
    return null;
  }
}

function databaseFilePath() {
  const configured = process.env.APP_DATABASE_FILE || process.env.SWITCH_LEDGER_DATABASE_FILE;

  if (configured) {
    return normalizeDataPath(configured, "records.sqlite");
  }

  const legacyDataFile = process.env.APP_DATA_FILE || process.env.SWITCH_LEDGER_DATA_FILE;

  if (legacyDataFile) {
    return deriveDatabasePath(legacyDataFile);
  }

  return defaultDatabaseFilePath();
}

function legacyJsonFilePath() {
  const legacyDataFile = process.env.APP_DATA_FILE || process.env.SWITCH_LEDGER_DATA_FILE;

  if (legacyDataFile) {
    return normalizeDataPath(legacyDataFile, "records.json");
  }

  return deriveLegacyJsonPath(databaseFilePath());
}

function deriveDatabasePath(dataFilePath: string) {
  const normalized = dataFilePath.replace(/\\/g, "/");
  const databasePath = normalized.endsWith(".json")
    ? `${normalized.slice(0, -".json".length)}.sqlite`
    : `${normalized}.sqlite`;

  return normalizeDataPath(databasePath, "records.sqlite");
}

function deriveLegacyJsonPath(databasePath: string) {
  if (databasePath.endsWith(".sqlite")) {
    return `${databasePath.slice(0, -".sqlite".length)}.json`;
  }

  const directory = dirnamePath(databasePath);

  if (directory === ".") {
    return "records.json";
  }

  return `${directory}/records.json`;
}

function normalizeDataPath(configured: string, fallbackFileName: string) {
  if (!configured) {
    return joinDataPath(fallbackFileName);
  }

  if (isAbsolutePath(configured)) {
    return configured;
  }

  const relativePath = configured
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/^data\//, "");

  if (relativePath.split("/").includes("..")) {
    return joinDataPath(fallbackFileName);
  }

  return joinDataPath(relativePath || fallbackFileName);
}

function parseStoredJson(value: unknown, fallback: unknown) {
  if (typeof value !== "string" || !value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fallback;
  }
}

function hasLedgerData(document: LedgerDocument) {
  return document.records.length > 0;
}

async function loadNodeSqlite(): Promise<LedgerSqliteModule> {
  return import("node:sqlite") as unknown as Promise<LedgerSqliteModule>;
}

async function loadFsPromises(): Promise<FsPromises> {
  return import("node:fs/promises") as unknown as Promise<FsPromises>;
}

function isAbsolutePath(path: string) {
  return path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path);
}

function dirnamePath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");

  if (index < 0) {
    return ".";
  }

  if (index === 0) {
    return "/";
  }

  return normalized.slice(0, index);
}

function joinDataPath(fileName: string) {
  return `data/${fileName}`;
}

function defaultDatabaseFilePath() {
  if (process.env.NODE_ENV === "production") {
    return "/data/records.sqlite";
  }

  return joinDataPath("records.sqlite");
}

function describeDatabaseDirectoryError(directory: string, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  const hint = "Docker 运行请确认 APP_DATABASE_FILE=/data/records.sqlite，并挂载 ./data:/data";

  return [`无法创建数据库目录 ${directory}`, hint, detail && `原始错误：${detail}`]
    .filter(Boolean)
    .join("；");
}

function isNotFoundError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function stripJsonBom(value: string) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}
