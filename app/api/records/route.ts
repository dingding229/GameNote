import { NextRequest, NextResponse } from "next/server";
import { hasValidAccessCookie } from "@/lib/access";
import {
  createEmptyLedger,
  createLedgerDocument,
  type LedgerDocument,
  normalizeAccount,
  normalizeLedgerDocument,
  normalizeRecords,
} from "@/lib/ledger";

type SavePayload = {
  account?: unknown;
  records?: unknown;
};

export async function GET(request: NextRequest) {
  if (!(await hasValidAccessCookie(request))) {
    return unauthorized();
  }

  return NextResponse.json(await readLedger(), {
    headers: { "cache-control": "no-store" },
  });
}

export async function PUT(request: NextRequest) {
  if (!(await hasValidAccessCookie(request))) {
    return unauthorized();
  }

  const payload = (await request.json().catch(() => ({}))) as SavePayload;

  if (!Array.isArray(payload.records)) {
    return NextResponse.json(
      { error: "records must be an array" },
      { status: 400 },
    );
  }

  const records = normalizeRecords(payload.records);
  const previous = await readLedger();
  const nextAccount = Object.hasOwn(payload, "account")
    ? normalizeAccount(payload.account)
    : previous.account;
  const document = createLedgerDocument(nextAccount, records);

  await writeLedger(document);

  return NextResponse.json(document, {
    headers: { "cache-control": "no-store" },
  });
}

function unauthorized() {
  return NextResponse.json(
    { error: "unauthorized" },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

async function readLedger(): Promise<LedgerDocument> {
  const { readFile } = await loadFsPromises();

  try {
    const raw = await readFile(await dataFilePath(), "utf8");
    return normalizeLedgerDocument(JSON.parse(raw) as unknown);
  } catch (error) {
    if (isNotFoundError(error)) {
      return createEmptyLedger();
    }

    throw error;
  }
}

async function writeLedger(document: LedgerDocument) {
  const { mkdir, rename, writeFile } = await loadFsPromises();
  const filePath = await dataFilePath();
  const directory = dirnamePath(filePath);
  const tempPath = joinPath(
    directory,
    `.${Date.now()}-${Math.random().toString(16).slice(2)}.records.tmp`,
  );

  await mkdir(directory, { recursive: true });
  await writeFile(tempPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

async function loadFsPromises(): Promise<{
  mkdir(path: string, options: { recursive: boolean }): Promise<unknown>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  rename(oldPath: string, newPath: string): Promise<unknown>;
  writeFile(path: string, data: string, encoding: "utf8"): Promise<unknown>;
}> {
  const nodeImport = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<{
    mkdir(path: string, options: { recursive: boolean }): Promise<unknown>;
    readFile(path: string, encoding: "utf8"): Promise<string>;
    rename(oldPath: string, newPath: string): Promise<unknown>;
    writeFile(path: string, data: string, encoding: "utf8"): Promise<unknown>;
  }>;

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

function joinPath(directory: string, fileName: string) {
  return directory.endsWith("/")
    ? `${directory}${fileName}`
    : `${directory}/${fileName}`;
}

function joinDataPath(fileName: string) {
  return `data/${fileName}`;
}

async function dataFilePath() {
  const configured =
    process.env.APP_DATA_FILE || process.env.SWITCH_LEDGER_DATA_FILE;

  if (!configured) {
    return joinDataPath("records.json");
  }

  if (isAbsolutePath(configured)) {
    return configured;
  }

  const relativePath = configured
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/^data\//, "");

  if (relativePath.split("/").includes("..")) {
    return joinDataPath("records.json");
  }

  return joinDataPath(relativePath);
}

function isNotFoundError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
