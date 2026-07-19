import {
  createEmptyLedger,
  type LedgerDocument,
  normalizeLedgerDocument,
} from "./ledger";

export type StatementSync = {
  get(...values: unknown[]): unknown;
  run(...values: unknown[]): unknown;
  all?(...values: unknown[]): unknown[];
};

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
      .prepare(
        "SELECT records, updated_at FROM ledger_documents WHERE id = ?",
      )
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

export async function writeLedgerToSqlite(document: LedgerDocument) {
  const { db } = await openLedgerDatabase();

  try {
    ensureLedgerTable(db);
    writeLedgerToOpenSqlite(db, document);
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

function writeLedgerToOpenSqlite(db: DatabaseSync, document: LedgerDocument) {
  db.prepare(
    `INSERT INTO ledger_documents (id, records, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       records = excluded.records,
       updated_at = excluded.updated_at`,
  ).run(
    ledgerId,
    JSON.stringify(document.records),
    document.updatedAt,
  );
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
  const configured =
    process.env.APP_DATABASE_FILE || process.env.SWITCH_LEDGER_DATABASE_FILE;

  if (configured) {
    return normalizeDataPath(configured, "records.sqlite");
  }

  const legacyDataFile =
    process.env.APP_DATA_FILE || process.env.SWITCH_LEDGER_DATA_FILE;

  if (legacyDataFile) {
    return deriveDatabasePath(legacyDataFile);
  }

  return defaultDatabaseFilePath();
}

function legacyJsonFilePath() {
  const legacyDataFile =
    process.env.APP_DATA_FILE || process.env.SWITCH_LEDGER_DATA_FILE;

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
  const nodeImport = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<LedgerSqliteModule>;

  return nodeImport(["node:", "sqlite"].join(""));
}

async function loadFsPromises(): Promise<FsPromises> {
  const nodeImport = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<FsPromises>;

  return nodeImport(["node:", "fs", "/", "promises"].join(""));
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
  const hint =
    "Docker 运行请确认 APP_DATABASE_FILE=/data/records.sqlite，并挂载 ./data:/data";

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
