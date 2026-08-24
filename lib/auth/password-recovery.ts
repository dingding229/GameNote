import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getLedgerDatabaseFilePath } from "@/lib/ledger/repository";

const recoveryFileName = "password";

export function generateTemporaryPassword() {
  return randomBytes(18).toString("base64url");
}

export function passwordRecoveryFilePath() {
  return join(dirname(getLedgerDatabaseFilePath()), recoveryFileName);
}

export async function writePasswordRecoveryFile(password: string) {
  const filePath = passwordRecoveryFilePath();
  await mkdir(dirname(filePath), { recursive: true });
  const handle = await open(
    filePath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.chmod(0o600);
    await handle.writeFile(`${password}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return filePath;
}

export async function removePasswordRecoveryFile() {
  await rm(passwordRecoveryFilePath(), { force: true });
}
