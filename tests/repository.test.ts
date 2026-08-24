import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLedgerDocument } from "../lib/ledger/schema";
import {
  createRegisteredUser,
  getRegisteredUser,
  LedgerConflictError,
  readLedgerFromSqlite,
  updateRegisteredUserPassword,
  writeLedgerToSqlite,
} from "../lib/ledger/repository";
import {
  generateTemporaryPassword,
  passwordRecoveryFilePath,
  removePasswordRecoveryFile,
  writePasswordRecoveryFile,
} from "../lib/auth/password-recovery";

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

describe("account recovery storage", () => {
  it("migrates an existing user table without forcing a password change", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(process.env.APP_DATABASE_FILE!);
    database.exec(`CREATE TABLE app_users (
      id TEXT PRIMARY KEY NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      session_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )`);
    database
      .prepare(
        "INSERT INTO app_users (id, username, password_hash, session_version, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("owner", "admin", "existing-hash", 4, new Date().toISOString());
    database.close();

    await expect(getRegisteredUser()).resolves.toMatchObject({
      username: "admin",
      sessionVersion: 4,
      passwordChangeRequired: false,
    });
  });

  it("persists the forced password-change state and revokes existing sessions", async () => {
    await createRegisteredUser({
      id: "owner",
      username: "admin",
      passwordHash: "old-hash",
      sessionVersion: 1,
      passwordChangeRequired: false,
    });
    await updateRegisteredUserPassword("temporary-hash", true);

    await expect(getRegisteredUser()).resolves.toMatchObject({
      passwordHash: "temporary-hash",
      sessionVersion: 2,
      passwordChangeRequired: true,
    });

    await updateRegisteredUserPassword("new-hash");
    await expect(getRegisteredUser()).resolves.toMatchObject({
      passwordHash: "new-hash",
      sessionVersion: 3,
      passwordChangeRequired: false,
    });
  });

  it("writes a restricted temporary password file beside the database and removes it", async () => {
    const password = generateTemporaryPassword();
    expect(password).toMatch(/^[A-Za-z0-9_-]{24}$/);

    await writePasswordRecoveryFile(password);
    await expect(readFile(passwordRecoveryFilePath(), "utf8")).resolves.toBe(`${password}\n`);
    expect((await stat(passwordRecoveryFilePath())).mode & 0o777).toBe(0o600);

    await removePasswordRecoveryFile();
    await expect(stat(passwordRecoveryFilePath())).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses to follow a password-file symbolic link", async () => {
    const target = join(testDirectory, "protected-file");
    await writeFile(target, "keep-me", "utf8");
    await symlink(target, passwordRecoveryFilePath());

    await expect(writePasswordRecoveryFile("temporary-password")).rejects.toBeTruthy();
    await expect(readFile(target, "utf8")).resolves.toBe("keep-me");
  });
});
