import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
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

export const runtime = "nodejs";

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
  try {
    const raw = await readFile(dataFilePath(), "utf8");
    return normalizeLedgerDocument(JSON.parse(raw) as unknown);
  } catch (error) {
    if (isNotFoundError(error)) {
      return createEmptyLedger();
    }

    throw error;
  }
}

async function writeLedger(document: LedgerDocument) {
  const filePath = dataFilePath();
  const directory = dirname(filePath);
  const tempPath = join(
    directory,
    `.${Date.now()}-${Math.random().toString(16).slice(2)}.records.tmp`,
  );

  await mkdir(directory, { recursive: true });
  await writeFile(tempPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

function dataFilePath() {
  const configured =
    process.env.APP_DATA_FILE || process.env.SWITCH_LEDGER_DATA_FILE;

  if (!configured) {
    return join("data", "records.json");
  }

  if (isAbsolute(configured)) {
    return configured;
  }

  const relativePath = configured
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/^data\//, "");

  if (relativePath.split("/").includes("..")) {
    return join("data", "records.json");
  }

  return join("data", relativePath);
}

function isNotFoundError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
