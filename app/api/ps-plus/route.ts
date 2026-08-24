import { NextRequest, NextResponse } from "next/server";
import { hasValidAccessCookie } from "@/lib/auth/access";
import { createLedgerDocument, type GameRecord } from "@/lib/ledger/schema";
import { enrichMonthlyGames, parsePsPlusMonthlyFeed } from "@/lib/game/ps-plus-monthly";
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
    const enrichedGames = await enrichMonthlyGames(monthly.games);
    let additions: GameRecord[] = [];
    let updated = 0;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const ledger = await readLedgerFromSqlite();
      updated = 0;
      const refreshedRecords = ledger.records.map((record) => {
        if (!record.notes.includes(`PS Plus 会免 ${monthly.month}`)) return record;
        const gameIndex = enrichedGames.findIndex((game, index) =>
          [game.title, monthly.games[index]?.title].some(
            (title) => normalizeTitle(record.title) === normalizeTitle(title || ""),
          ),
        );
        const game = enrichedGames[gameIndex];
        if (!game) return record;
        const refreshed = {
          ...record,
          title: game.title,
          region: "港版" as const,
          coverUrl: game.coverUrl || record.coverUrl,
          officialUrl: game.officialUrl || record.officialUrl,
        };
        if (JSON.stringify(refreshed) !== JSON.stringify(record)) updated += 1;
        return refreshed;
      });
      additions = enrichedGames
        .filter(
          (game, gameIndex) =>
            !ledger.records.some(
              (record) =>
                record.notes.includes(`PS Plus 会免 ${monthly.month}`) &&
                [game.title, monthly.games[gameIndex]?.title].some(
                  (title) => normalizeTitle(record.title) === normalizeTitle(title || ""),
                ),
            ),
        )
        .map(
          (game): GameRecord => ({
            id: crypto.randomUUID(),
            platform: "PlayStation",
            title: game.title,
            price: 0,
            currency: "CNY",
            purchaseDate: new Date().toISOString().slice(0, 10),
            region: "港版",
            format: "数字版",
            seller: "PlayStation Plus",
            coverUrl: game.coverUrl,
            officialUrl: game.officialUrl,
            notes: `PS Plus 会免 ${monthly.month}`,
            soldDate: "",
            soldPrice: 0,
            soldCurrency: "CNY",
          }),
        );
      if (!additions.length && !updated) break;
      try {
        await writeLedgerToSqlite(
          createLedgerDocument([...additions, ...refreshedRecords]),
          ledger.updatedAt,
        );
        break;
      } catch (error) {
        if (!(error instanceof LedgerConflictError) || attempt === 2) throw error;
      }
    }
    return NextResponse.json({
      added: additions.length,
      updated,
      games: additions.map((game) => game.title),
      month: monthly.month,
      records: additions,
      message: updated ? `已补全 ${updated} 款会免游戏的中文名、封面和官方链接` : "当月会免已同步",
    });
  } catch (error) {
    return NextResponse.json(
      { error: `PS Plus 会免同步失败：${error instanceof Error ? error.message : String(error)}` },
      { status: 502 },
    );
  }
}

function normalizeTitle(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, "");
}
