"use client";

import { useEffect, useMemo, useState } from "react";
import { eligibleHistoricalMonths } from "@/lib/game/ps-plus-history";
import type { HistoricalMonthlyGame, MembershipPeriod } from "../types";

type PsPlusHistoryProps = {
  periods: MembershipPeriod[];
  onCompleted: () => Promise<void>;
};

export function PsPlusHistory({ periods, onCompleted }: PsPlusHistoryProps) {
  const months = useMemo(() => eligibleHistoricalMonths(periods), [periods]);
  const [month, setMonth] = useState(months[0] || "");
  const [games, setGames] = useState<HistoricalMonthlyGame[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<"idle" | "loading" | "saving">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!months.includes(month)) {
      setMonth(months[0] || "");
      setGames([]);
      setSelected(new Set());
      setMessage("");
    }
  }, [month, months]);

  function changeMonth(value: string) {
    setMonth(value);
    setGames([]);
    setSelected(new Set());
    setMessage("");
  }

  async function loadMonth() {
    if (!month) return;
    setStatus("loading");
    setMessage("");
    setGames([]);
    setSelected(new Set());
    try {
      const response = await fetch(`/api/ps-plus?month=${encodeURIComponent(month)}`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        games?: HistoricalMonthlyGame[];
        error?: string;
      };
      if (!response.ok || !Array.isArray(payload.games))
        throw new Error(payload.error || "无法读取该月会免阵容");
      setGames(payload.games);
      setMessage(payload.games.length ? "请选择当月实际领取过的游戏" : "该月没有可补录游戏");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "历史会免查询失败");
    } finally {
      setStatus("idle");
    }
  }

  function toggleGame(sourceTitle: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(sourceTitle)) next.delete(sourceTitle);
      else next.add(sourceTitle);
      return next;
    });
  }

  async function backfillSelected() {
    if (!month || !selected.size) return;
    setStatus("saving");
    setMessage("");
    try {
      const response = await fetch("/api/ps-plus", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ month, sourceTitles: [...selected] }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "历史会免补录失败");
      setGames((current) =>
        current.map((game) =>
          selected.has(game.sourceTitle) ? { ...game, alreadyAdded: true } : game,
        ),
      );
      setSelected(new Set());
      setMessage(payload.message || "历史会免已补录");
      await onCompleted();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "历史会免补录失败");
    } finally {
      setStatus("idle");
    }
  }

  return (
    <section className="ps-plus-history" aria-labelledby="ps-plus-history-title">
      <div className="ps-plus-history-heading">
        <div>
          <h4 id="ps-plus-history-title">历史会免补录</h4>
          <p>按月份查看阵容，只勾选当时实际领取过的游戏</p>
        </div>
        <div className="ps-plus-history-controls">
          <label className="field">
            <span>会员月份</span>
            <select
              aria-label="会员月份"
              value={month}
              disabled={!months.length}
              onChange={(event) => changeMonth(event.target.value)}
            >
              {months.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <button
            className="ghost-button"
            type="button"
            disabled={!month || status !== "idle"}
            onClick={loadMonth}
          >
            {status === "loading" ? "查询中…" : "查询该月阵容"}
          </button>
        </div>
      </div>

      {!months.length ? <p className="ps-plus-history-empty">暂无可补录的历史会员月份</p> : null}
      {games.length ? (
        <div className="ps-plus-history-games">
          {games.map((game) => (
            <label className="ps-plus-history-game" key={game.officialUrl}>
              <input
                type="checkbox"
                checked={game.alreadyAdded || selected.has(game.sourceTitle)}
                disabled={game.alreadyAdded || status !== "idle"}
                onChange={() => toggleGame(game.sourceTitle)}
              />
              {game.coverUrl ? <img src={game.coverUrl} alt="" loading="lazy" /> : null}
              <span>
                <strong>{game.title}</strong>
                <small>{game.alreadyAdded ? "已在记录中" : game.sourceTitle}</small>
              </span>
              <a
                href={game.officialUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                官网
              </a>
            </label>
          ))}
        </div>
      ) : null}
      {games.length ? (
        <button
          className="primary-button ps-plus-history-submit"
          type="button"
          disabled={!selected.size || status !== "idle"}
          onClick={backfillSelected}
        >
          {status === "saving"
            ? "补录中…"
            : `补录已选游戏${selected.size ? `（${selected.size}）` : ""}`}
        </button>
      ) : null}
      {message ? (
        <p className="settings-message ps-plus-history-message" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
    </section>
  );
}
