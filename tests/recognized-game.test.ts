import { describe, expect, it } from "vitest";
import { createFormFromRecognizedGame } from "../features/ledger/recognized-game";

describe("recognized game handoff", () => {
  it("keeps the AI title editable and leaves official data unselected", () => {
    const form = createFormFromRecognizedGame(
      {
        title: "  ASTRO BOT  ",
        price: 398,
        currency: "HKD",
        platform: "PlayStation",
        region: "港版",
        format: "实体光盘",
        seller: "  淘宝 · 游戏店  ",
        purchaseDate: "",
        notes: "  PS5  ",
        confidence: 0.92,
        warning: "",
      },
      "2026-08-24",
    );

    expect(form).toMatchObject({
      title: "ASTRO BOT",
      seller: "淘宝 · 游戏店",
      notes: "PS5",
      purchaseDate: "2026-08-24",
      coverUrl: "",
      officialUrl: "",
    });
  });
});
