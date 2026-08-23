import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLedgerDocument } from "../lib/ledger/schema";
import {
  LedgerConflictError,
  readLedgerFromSqlite,
  writeLedgerToSqlite,
} from "../lib/ledger/repository";

let testDirectory = "";

beforeEach(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), "gamenote-repository-"));
  process.env.APP_DATABASE_FILE = join(testDirectory, "records.sqlite");
});

afterEach(async () => {
  delete process.env.APP_DATABASE_FILE;
  await rm(testDirectory, { recursive: true, force: true });
});

describe("ledger optimistic concurrency", () => {
  it("rejects a write based on an outdated document version", async () => {
    const initial = await readLedgerFromSqlite();
    const firstWrite = createLedgerDocument([]);
    await writeLedgerToSqlite(firstWrite, initial.updatedAt);

    await expect(
      writeLedgerToSqlite(createLedgerDocument([]), initial.updatedAt),
    ).rejects.toBeInstanceOf(LedgerConflictError);
    await expect(readLedgerFromSqlite()).resolves.toEqual(firstWrite);
  });
});
