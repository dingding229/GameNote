import { NextRequest, NextResponse } from "next/server";
import { hasValidAccessCookie } from "@/lib/access";
import { readLedgerFromSqlite, writeLedgerToSqlite } from "@/lib/ledger-sqlite";
import { createLedgerDocument, normalizeRecords } from "@/lib/ledger";
import { normalizeChineseGameTitle } from "@/lib/chinese";
import { resolveChineseGameTitle } from "@/lib/game-title";
import type { GameRecord, LedgerDocument } from "@/lib/ledger";

type SavePayload = {
  records?: unknown;
};

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!(await hasValidAccessCookie(request))) {
    return unauthorized();
  }

  try {
    const document = await localizeLedgerDocument(await readLedgerFromSqlite());
    return NextResponse.json(document, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return storageFailure("读取数据库记录失败", error);
  }
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

  const records = await localizeRecords(normalizeRecords(payload.records));

  try {
    const document = createLedgerDocument(records);

    await writeLedgerToSqlite(document);

    return NextResponse.json(document, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return storageFailure("保存数据库记录失败", error);
  }
}

async function localizeLedgerDocument(
  document: LedgerDocument,
): Promise<LedgerDocument> {
  return { ...document, records: await localizeRecords(document.records) };
}

async function localizeRecords(records: GameRecord[]) {
  const localizedTitles = new Map<string, string>();
  const localizedRecords: GameRecord[] = [];

  for (const record of records) {
    if (/[\u3400-\u9fff]/u.test(record.title)) {
      localizedRecords.push(record);
      continue;
    }

    let localizedTitle = localizedTitles.get(record.title);
    if (localizedTitle === undefined) {
      const resolvedTitle = await resolveChineseGameTitle(record.title);
      localizedTitle = resolvedTitle
        ? normalizeChineseGameTitle(resolvedTitle)
        : record.title;
      localizedTitles.set(record.title, localizedTitle);
    }

    localizedRecords.push({ ...record, title: localizedTitle });
  }

  return localizedRecords;
}

function unauthorized() {
  return NextResponse.json(
    { error: "unauthorized" },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

function storageFailure(action: string, error: unknown) {
  console.error(action, error);

  return NextResponse.json(
    { error: describeStorageError(action, error) },
    { status: 500, headers: { "cache-control": "no-store" } },
  );
}

function describeStorageError(action: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (message) {
    return `${action}：${message}`;
  }

  return action;
}
