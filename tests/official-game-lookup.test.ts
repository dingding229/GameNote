import { describe, expect, it, vi } from "vitest";
import { enrichRecognizedGameWithOfficialData } from "../features/ledger/official-game-lookup";

const recognizedGame = {
  title: "ASTRO BOT",
  price: 298,
  currency: "HKD" as const,
  platform: "PlayStation" as const,
  region: "港版" as const,
  format: "实体光盘" as const,
  seller: "商店",
  purchaseDate: "2026-08-24",
  notes: "",
  confidence: 0.95,
  warning: "",
  selected: true,
};

describe("purchase recognition official lookup", () => {
  it("adds the localized title, cover and official URL from the platform lookup", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              id: "product-1",
              title: "ASTRO BOT",
              displayTitle: "宇宙机器人",
              coverUrl: "https://image.example/astro.jpg",
              officialUrl: "https://store.playstation.com/product/product-1",
              platform: "PS5",
              releaseDate: null,
              price: null,
              currency: null,
              source: "playstation-hong-kong",
            },
          ],
        }),
      ),
    );

    await expect(
      enrichRecognizedGameWithOfficialData(recognizedGame, fetcher),
    ).resolves.toMatchObject({
      title: "宇宙机器人",
      coverUrl: "https://image.example/astro.jpg",
      officialUrl: "https://store.playstation.com/product/product-1",
      officialLookupStatus: "found",
    });
    expect(fetcher).toHaveBeenCalledWith("/api/playstation-game?q=ASTRO+BOT");
  });

  it("keeps the recognition result when the official lookup has no match", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ results: [] })));

    await expect(
      enrichRecognizedGameWithOfficialData(recognizedGame, fetcher),
    ).resolves.toMatchObject({
      title: "ASTRO BOT",
      coverUrl: "",
      officialUrl: "",
      officialLookupStatus: "not-found",
    });
  });
});
