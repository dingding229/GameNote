import { describe, expect, it } from "vitest";
import type { GameRecord } from "../lib/ledger/schema";
import { reconcileMonthlyGames } from "../lib/game/ps-plus-monthly-sync";

const game = {
  title: "Dying Light 2 Stay Human: Reloaded Edition",
  coverUrl: "https://image.api.playstation.com/dying.jpg",
  officialUrl:
    "https://store.playstation.com/zh-hant-hk/product/UP3050-PPSA02261_00-DL2GAME0000000US",
};

function record(id: string): GameRecord {
  return {
    id,
    platform: "PlayStation",
    title:
      "Dying Light 2 Stay Human: Reloaded Edition | PS5, PS4 In Dying Light 2, survival meets action adventure",
    price: 0,
    currency: "CNY",
    purchaseDate: "2026-08-24",
    region: "港版",
    format: "数字版",
    seller: "PlayStation Plus",
    coverUrl: "https://blog.playstation.com/wrong.jpg",
    officialUrl: "https://blog.playstation.com/monthly-august/",
    notes: "PS Plus 会免 2026-08",
    soldDate: "",
    soldPrice: 0,
    soldCurrency: "CNY",
  };
}

describe("PS Plus monthly reconciliation", () => {
  it("repairs one legacy record and removes repeated automatic records", () => {
    const result = reconcileMonthlyGames(
      [record("one"), record("two"), record("three")],
      [game],
      "2026-08",
      "2026-08-24",
      () => "new",
    );
    expect(result.additions).toHaveLength(0);
    expect(result.removedDuplicates).toBe(2);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      id: "one",
      title: game.title,
      coverUrl: game.coverUrl,
      officialUrl: game.officialUrl,
    });
    expect(result.records[0].notes).toContain("PS Plus 原名：Dying Light 2");
  });

  it("is idempotent after the first reconciliation", () => {
    const first = reconcileMonthlyGames([], [game], "2026-08", "2026-08-24", () => "stable");
    const second = reconcileMonthlyGames(
      first.records,
      [game],
      "2026-08",
      "2026-08-24",
      () => "unused",
    );
    expect(second.additions).toHaveLength(0);
    expect(second.updated).toBe(0);
    expect(second.removedDuplicates).toBe(0);
    expect(second.records).toEqual(first.records);
  });
});
