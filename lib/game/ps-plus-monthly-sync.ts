import type { GameRecord } from "@/lib/ledger/schema";
import type { OfficialMonthlyGame } from "./ps-plus-monthly";

const sourceLabel = "PS Plus 原名：";

export type MonthlyReconciliation = {
  records: GameRecord[];
  additions: GameRecord[];
  updated: number;
  removedDuplicates: number;
};

export function reconcileMonthlyGames(
  records: GameRecord[],
  games: OfficialMonthlyGame[],
  month: string,
  purchaseDate: string,
  createId: () => string,
): MonthlyReconciliation {
  const monthLabel = `PS Plus 会免 ${month}`;
  const sourcePrefix = `ps-plus:${month}:`;
  const candidates = records.filter(
    (record) =>
      record.platform === "PlayStation" &&
      (record.sourceKey?.startsWith(sourcePrefix) || record.notes.includes(monthLabel)),
  );
  const removals = new Set<string>();
  const consumed = new Set<string>();
  const replacements = new Map<string, GameRecord>();
  const additions: GameRecord[] = [];
  let updated = 0;

  for (const game of games) {
    const matches = candidates.filter(
      (record) =>
        !removals.has(record.id) &&
        !consumed.has(record.id) &&
        recordMatchesGame(record, game, month),
    );
    const existing = matches[0];
    if (!existing) {
      const addition = createMonthlyRecord(game, month, purchaseDate, createId());
      additions.push(addition);
      continue;
    }

    const refreshed = {
      ...existing,
      sourceKey: monthlySourceKey(month, game),
      title: game.title,
      region: "港版" as const,
      format: "数字版" as const,
      coverUrl: game.coverUrl,
      officialUrl: game.officialUrl,
      notes: monthlyNotes(month),
    };
    if (!recordsEqual(existing, refreshed)) updated += 1;
    replacements.set(existing.id, refreshed);
    consumed.add(existing.id);
    for (const duplicate of matches.slice(1)) removals.add(duplicate.id);
  }

  const reconciled = records
    .filter((record) => !removals.has(record.id))
    .map((record) => replacements.get(record.id) ?? record);
  return {
    records: [...additions, ...reconciled],
    additions,
    updated,
    removedDuplicates: removals.size,
  };
}

function createMonthlyRecord(
  game: OfficialMonthlyGame,
  month: string,
  purchaseDate: string,
  id: string,
): GameRecord {
  return {
    id,
    sourceKey: monthlySourceKey(month, game),
    platform: "PlayStation",
    title: game.title,
    price: 0,
    currency: "CNY",
    purchaseDate,
    region: "港版",
    format: "数字版",
    seller: "PlayStation Plus",
    coverUrl: game.coverUrl,
    officialUrl: game.officialUrl,
    notes: monthlyNotes(month),
    soldDate: "",
    soldPrice: 0,
    soldCurrency: "CNY",
  };
}

function monthlyNotes(month: string) {
  return `PS Plus 会免 ${month}`;
}

function recordMatchesGame(record: GameRecord, game: OfficialMonthlyGame, month: string) {
  if (record.sourceKey === monthlySourceKey(month, game)) {
    return true;
  }
  const sourceTitle = record.notes
    .split(/\r?\n/)
    .find((line) => line.startsWith(sourceLabel))
    ?.slice(sourceLabel.length);
  if (sourceTitle) return normalizeTitle(sourceTitle) === normalizeTitle(game.sourceTitle);

  // 兼容旧版自动记录：旧解析器可能把平台和正文拼进标题，因此允许完整原名作为前缀。
  const recordTitle = normalizeTitle(record.title);
  const gameTitle = normalizeTitle(game.title);
  const sourceGameTitle = normalizeTitle(game.sourceTitle);
  if (recordTitle === gameTitle || recordTitle === sourceGameTitle) return true;
  if (
    (gameTitle.length >= 6 && recordTitle.startsWith(gameTitle)) ||
    (sourceGameTitle.length >= 6 && recordTitle.startsWith(sourceGameTitle))
  )
    return true;
  return record.officialUrl === game.officialUrl;
}

function monthlySourceKey(month: string, game: OfficialMonthlyGame) {
  const productId =
    game.officialUrl.match(/\/product\/([^/?#]+)/i)?.[1] || normalizeTitle(game.title);
  return `ps-plus:${month}:${productId}`;
}

function normalizeTitle(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, "");
}

function recordsEqual(left: GameRecord, right: GameRecord) {
  return JSON.stringify(left) === JSON.stringify(right);
}
