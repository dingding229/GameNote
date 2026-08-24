import { NextRequest, NextResponse } from "next/server";
import { hasValidAccessCookie } from "@/lib/auth/access";
import { createLedgerDocument, type GameRecord } from "@/lib/ledger/schema";
import {
  historicalFeedUrl,
  isPastOrCurrentMonth,
  membershipCoversMonth,
} from "@/lib/game/ps-plus-history";
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

export async function GET(request: NextRequest) {
  if (!(await hasValidAccessCookie(request)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const month = new URL(request.url).searchParams.get("month")?.trim() || "";
  if (!isPastOrCurrentMonth(month))
    return NextResponse.json({ error: "请选择有效的历史月份" }, { status: 400 });

  const settings = await readAppSettings();
  if (!membershipCoversMonth(settings.membershipPeriods, month))
    return NextResponse.json(
      { error: "所选月份不在已保存的 PS Plus 会员时间段内" },
      { status: 403 },
    );

  try {
    const monthly = await fetchMonthlyGames(month);
    if (!monthly)
      return NextResponse.json({ error: `暂未找到 ${month} 的 PS Plus 会免阵容` }, { status: 404 });
    const official = await enrichMonthlyGames(monthly.games);
    if (!official.games.length) throw new Error("未能从 PlayStation Store 匹配到该月游戏");
    const ledger = await readLedgerFromSqlite();
    const games = official.games.map((game) => ({
      ...game,
      alreadyAdded: !reconcileMonthlyGames(
        ledger.records,
        [game],
        month,
        `${month}-01`,
        () => "preview",
      ).additions.length,
    }));
    return NextResponse.json({ month, games, unresolved: official.unresolved });
  } catch (error) {
    return NextResponse.json(
      { error: `历史会免查询失败：${error instanceof Error ? error.message : String(error)}` },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await hasValidAccessCookie(request)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const payload = (await request.json().catch(() => ({}))) as {
    month?: unknown;
    sourceTitles?: unknown;
  };
  const requestedMonth = typeof payload.month === "string" ? payload.month.trim() : "";
  const historical = Boolean(requestedMonth);
  if (historical && !isPastOrCurrentMonth(requestedMonth))
    return NextResponse.json({ error: "请选择有效的历史月份" }, { status: 400 });
  const settings = await readAppSettings();
  if (historical && !membershipCoversMonth(settings.membershipPeriods, requestedMonth))
    return NextResponse.json(
      { error: "所选月份不在已保存的 PS Plus 会员时间段内" },
      { status: 403 },
    );
  if (!historical && !settings.psPlusEnabled)
    return NextResponse.json({ added: 0, games: [], message: "PS Plus 会员未开启" });
  if (!historical && !settings.psPlusAutoAddMonthly)
    return NextResponse.json({ added: 0, games: [], message: "PS Plus 会免自动入库未开启" });
  if (
    !historical &&
    settings.psPlusExpiresAt &&
    settings.psPlusExpiresAt < new Date().toISOString().slice(0, 10)
  ) {
    return NextResponse.json({ added: 0, games: [], message: "PS Plus 会员已到期" });
  }

  try {
    const monthly = await fetchMonthlyGames(requestedMonth);
    if (!monthly)
      return NextResponse.json({
        added: 0,
        games: [],
        message: historical
          ? `暂未找到 ${requestedMonth} 的 PS Plus 会免阵容`
          : "暂未找到当月 PS Plus 会免阵容",
      });
    const official = await enrichMonthlyGames(monthly.games);
    if (!official.games.length) throw new Error("未能从 PlayStation Store 匹配到当月游戏");
    const selectedSourceTitles = new Set(
      Array.isArray(payload.sourceTitles)
        ? payload.sourceTitles
            .filter((title): title is string => typeof title === "string")
            .map(normalizeSourceTitle)
        : [],
    );
    const selectedGames = historical
      ? official.games.filter((game) =>
          selectedSourceTitles.has(normalizeSourceTitle(game.sourceTitle)),
        )
      : official.games;
    if (historical && !selectedGames.length)
      return NextResponse.json({ error: "请至少选择一款需要补录的游戏" }, { status: 400 });
    let additions: GameRecord[] = [];
    let updated = 0;
    let removedDuplicates = 0;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const ledger = await readLedgerFromSqlite();
      const reconciliation = reconcileMonthlyGames(
        ledger.records,
        selectedGames,
        monthly.month,
        historical ? `${monthly.month}-01` : new Date().toISOString().slice(0, 10),
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
      message: syncMessage(
        additions.length,
        updated,
        removedDuplicates,
        official.unresolved,
        historical,
      ),
    });
  } catch (error) {
    return NextResponse.json(
      { error: `PS Plus 会免同步失败：${error instanceof Error ? error.message : String(error)}` },
      { status: 502 },
    );
  }
}

async function fetchMonthlyGames(month: string) {
  const url = month ? historicalFeedUrl(month) : feedUrl;
  const response = await fetch(url, {
    headers: { "user-agent": "GameNote/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`PlayStation Blog HTTP ${response.status}`);
  return parsePsPlusMonthlyFeed(await response.text(), new Date(), month);
}

function normalizeSourceTitle(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, "");
}

function syncMessage(
  added: number,
  updated: number,
  removed: number,
  unresolved: string[],
  historical = false,
) {
  const changes = [
    added ? `${historical ? "补录" : "新增"} ${added} 款` : "",
    updated ? `更新 ${updated} 款` : "",
    removed ? `清理 ${removed} 条重复记录` : "",
  ].filter(Boolean);
  const result = changes.length
    ? changes.join("，")
    : historical
      ? "所选会免已补录"
      : "当月会免已同步";
  return unresolved.length ? `${result}；${unresolved.join("、")} 暂未匹配到港区 Store` : result;
}
