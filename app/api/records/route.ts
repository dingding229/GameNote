import { NextRequest, NextResponse } from "next/server";
import { hasValidAccessCookie } from "@/lib/auth/access";
import { readLedgerFromSqlite, writeLedgerToSqlite } from "@/lib/ledger/repository";
import { createLedgerDocument, normalizeRecords } from "@/lib/ledger/schema";
import { normalizeChineseGameTitle } from "@/lib/game/title-normalization";
import { resolveChineseGameTitle } from "@/lib/game/title-resolution";
import type { GameRecord, LedgerDocument } from "@/lib/ledger/schema";

type SavePayload = {
  records?: unknown;
};

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
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
    return NextResponse.json({ error: "records must be an array" }, { status: 400 });
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

async function localizeLedgerDocument(document: LedgerDocument): Promise<LedgerDocument> {
  return { ...document, records: await localizeRecords(document.records) };
}

async function localizeRecords(records: GameRecord[]) {
  const titles = [
    ...new Set(
      records.map((record) => record.title).filter((title) => !/[\u3400-\u9fff]/u.test(title)),
    ),
  ];
  const localizedTitles = new Map<string, string>();

  await mapWithConcurrency(titles, 4, async (title) => {
    const resolvedTitle = await resolveChineseGameTitle(title);
    localizedTitles.set(title, resolvedTitle ? normalizeChineseGameTitle(resolvedTitle) : title);
  });

  return records.map((record) => {
    const localizedTitle = localizedTitles.get(record.title);
    return localizedTitle && localizedTitle !== record.title
      ? { ...record, title: localizedTitle }
      : record;
  });
}

async function mapWithConcurrency<T>(
  values: T[],
  concurrency: number,
  task: (value: T) => Promise<void>,
) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const value = values[nextIndex];
      nextIndex += 1;
      await task(value);
    }
  });
  await Promise.all(workers);
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
