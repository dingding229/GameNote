import { NextRequest, NextResponse } from "next/server";
import { hasValidAccessCookie } from "@/lib/auth/access";
import { createLedgerDocument, type GameRecord } from "@/lib/ledger/schema";
import { enrichMonthlyGames, parsePsPlusMonthlyFeed } from "@/lib/game/ps-plus-monthly";
import { reconcileMonthlyGames } from "@/lib/game/ps-plus-monthly-sync";
import {
  LedgerConflictError,
  readAppSettings,
  readLedgerFromSqlite,
  writeLedgerToSqlite,
} from "@/lib/ledger/repository";

export const runtime = "nodejs";
const feedUrl = "https://blog.playstation.com/category/ps-plus/feed/";

export async function POST(request: NextRequest) {
  if (!(await hasValidAccessCookie(request)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const settings = await readAppSettings();
  if (!settings.psPlusEnabled)
    return NextResponse.json({ added: 0, games: [], message: "PS Plus 会员未开启" });
  if (!settings.psPlusAutoAddMonthly)
    return NextResponse.json({ added: 0, games: [], message: "PS Plus 会免自动入库未开启" });
  if (
    settings.psPlusExpiresAt &&
    settings.psPlusExpiresAt < new Date().toISOString().slice(0, 10)
  ) {
    return NextResponse.json({ added: 0, games: [], message: "PS Plus 会员已到期" });
  }

  try {
    const response = await fetch(feedUrl, {
      headers: { "user-agent": "GameNote/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const monthly = parsePsPlusMonthlyFeed(await response.text());
    if (!monthly)
      return NextResponse.json({ added: 0, games: [], message: "暂未找到当月 PS Plus 会免阵容" });
    const official = await enrichMonthlyGames(monthly.games);
    if (!official.games.length) throw new Error("未能从 PlayStation Store 匹配到当月游戏");
    let additions: GameRecord[] = [];
    let updated = 0;
    let removedDuplicates = 0;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const ledger = await readLedgerFromSqlite();
      const reconciliation = reconcileMonthlyGames(
        ledger.records,
        official.games,
        monthly.month,
        new Date().toISOString().slice(0, 10),
        () => crypto.randomUUID(),
      );
      additions = reconciliation.additions;
      updated = reconciliation.updated;
      removedDuplicates = reconciliation.removedDuplicates;
      if (!additions.length && !updated && !removedDuplicates) break;
      try {
        await writeLedgerToSqlite(createLedgerDocument(reconciliation.records), ledger.updatedAt);
        break;
      } catch (error) {
        if (!(error instanceof LedgerConflictError) || attempt === 2) throw error;
      }
    }
    return NextResponse.json({
      added: additions.length,
      updated,
      removedDuplicates,
      games: additions.map((game) => game.title),
      month: monthly.month,
      records: additions,
      unresolved: official.unresolved,
      message: syncMessage(additions.length, updated, removedDuplicates, official.unresolved),
    });
  } catch (error) {
    return NextResponse.json(
      { error: `PS Plus 会免同步失败：${error instanceof Error ? error.message : String(error)}` },
      { status: 502 },
    );
  }
}

function syncMessage(added: number, updated: number, removed: number, unresolved: string[]) {
  const changes = [
    added ? `新增 ${added} 款` : "",
    updated ? `更新 ${updated} 款` : "",
    removed ? `清理 ${removed} 条重复记录` : "",
  ].filter(Boolean);
  const result = changes.length ? changes.join("，") : "当月会免已同步";
  return unresolved.length ? `${result}；${unresolved.join("、")} 暂未匹配到港区 Store` : result;
}
