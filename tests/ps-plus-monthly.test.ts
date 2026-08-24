import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enrichMonthlyGames,
  parsePsPlusMonthlyFeed,
  selectStoreProduct,
} from "../lib/game/ps-plus-monthly";
import { findChineseGameTitle, resolveChineseGameTitle } from "../lib/game/title-resolution";

describe("PS Plus monthly feed", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses a Chinese display name for monthly games", async () => {
    await expect(resolveChineseGameTitle("Big Walk")).resolves.toBe("大步走");
    expect(
      findChineseGameTitle("Dying Light 2 Stay Human: Reloaded Edition", [
        {
          englishTitle: "Dying Light 2 Stay Human",
          chineseTitle: "消逝的光芒2：保持人性",
        },
      ]),
    ).toBe("消逝的光芒2：保持人性：重装上阵版");
  });

  it("writes the Chinese title together with Store cover and product URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              universalSearch: {
                results: [
                  {
                    __typename: "Product",
                    id: "UP3971-PPSA33764_00-WALKWALKWALKWALK",
                    name: "Big Walk",
                    platforms: ["PS5"],
                    media: [
                      {
                        role: "MASTER",
                        type: "IMAGE",
                        url: "https://image.api.playstation.com/big-walk.jpg",
                      },
                    ],
                  },
                ],
              },
            },
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(enrichMonthlyGames([{ title: "Big Walk" }])).resolves.toMatchObject({
      unresolved: [],
      games: [
        {
          title: "大步走",
          sourceTitle: "Big Walk",
          coverUrl: "https://image.api.playstation.com/big-walk.jpg?w=960",
          officialUrl:
            "https://store.playstation.com/zh-hant-hk/product/UP3971-PPSA33764_00-WALKWALKWALKWALK",
        },
      ],
    });
  });

  it("extracts exact titles without using Blog images or links as game metadata", () => {
    const feed = `
      <rss><channel><item>
        <title><![CDATA[PlayStation Plus Monthly Games for August: Alpha, Bravo and Charlie]]></title>
        <link>https://blog.playstation.com/monthly-august/</link>
        <content:encoded><![CDATA[
          <img src="https://blog.playstation.com/header.jpg" />
          <p><strong>Alpha | PS5</strong></p>
          <p>Alpha introduction.</p>
          <img src="https://blog.playstation.com/alpha.jpg" />
          <p><strong>Bravo | PS4, PS5</strong></p>
          <img src="https://blog.playstation.com/bravo.jpg" />
          <p><strong>Charlie | PS5</strong></p>
          <img src="https://blog.playstation.com/charlie.jpg" />
        ]]></content:encoded>
      </item></channel></rss>`;

    expect(parsePsPlusMonthlyFeed(feed, new Date("2026-08-24T00:00:00Z"))).toEqual({
      month: "2026-08",
      url: "https://blog.playstation.com/monthly-august/",
      games: [{ title: "Alpha" }, { title: "Bravo" }, { title: "Charlie" }],
    });
  });

  it("keeps commas inside a game title by reading article headings", () => {
    const feed = `<rss><channel><item>
      <title>PlayStation Plus Monthly Games for August: Warhammer 40,000: Darktide, Alpha, Bravo</title>
      <link>https://blog.playstation.com/monthly-august/</link>
      <content:encoded><![CDATA[
        <p><strong>Warhammer 40,000: Darktide | PS5</strong></p>
        <img src="https://blog.playstation.com/darktide.jpg" />
        <p><strong>Alpha | PS4</strong></p><img src="https://blog.playstation.com/alpha.jpg" />
        <p><strong>Bravo | PS5</strong></p><img src="https://blog.playstation.com/bravo.jpg" />
      ]]></content:encoded>
    </item></channel></rss>`;

    expect(parsePsPlusMonthlyFeed(feed, new Date("2026-08-24T00:00:00Z"))?.games).toHaveLength(3);
    expect(parsePsPlusMonthlyFeed(feed, new Date("2026-08-24T00:00:00Z"))?.games[0]).toMatchObject({
      title: "Warhammer 40,000: Darktide",
    });
  });

  it("handles the real heading markup where the platform sits outside strong", () => {
    const feed = `<rss><channel><item>
      <title>PlayStation Plus Monthly Games for August &#8211; Dying Light 2 Stay Human: Reloaded Edition, Big Walk, Signalis</title>
      <link>https://blog.playstation.com/monthly-august/</link>
      <content:encoded><![CDATA[
        <svg><path d="M1 1"></path></svg>
        <span>Close</span><a>Download this image</a>
        <h2 class="wp-block-heading"><strong>Dying Light 2 Stay Human: Reloaded Edition</strong> | PS5, PS4</h2>
        <p>Long introduction with other game names.</p>
        <h2 class="wp-block-heading"><strong>Big Walk | PS5</strong></h2>
        <h2 class="wp-block-heading"><strong>Signalis | PS4</strong></h2>
      ]]></content:encoded>
    </item></channel></rss>`;

    expect(parsePsPlusMonthlyFeed(feed, new Date("2026-08-24T00:00:00Z"))?.games).toEqual([
      { title: "Dying Light 2 Stay Human: Reloaded Edition" },
      { title: "Big Walk" },
      { title: "Signalis" },
    ]);
  });

  it("prefers the base Store game over extras when the named edition is unavailable", () => {
    const products = [
      {
        __typename: "Product",
        id: "extras",
        name: "Dying Light 2 Stay Human: Digital Extras Edition PS5",
        platforms: ["PS4", "PS5"],
      },
      {
        __typename: "Product",
        id: "base-game",
        name: "Dying Light 2 Stay Human PS4&PS5",
        platforms: ["PS4", "PS5"],
      },
    ];
    expect(selectStoreProduct(products, "Dying Light 2 Stay Human: Reloaded Edition")?.id).toBe(
      "base-game",
    );
  });

  it("matches a traditional Chinese Store title with a simplified Chinese alias", () => {
    const products = [
      {
        __typename: "Product",
        id: "wuchang",
        name: "明末：淵虛之羽 (簡體中文, 繁體中文)",
        platforms: ["PS5"],
      },
    ];
    expect(selectStoreProduct(products, "Wuchang: Fallen Feathers", ["明末：渊虚之羽"])?.id).toBe(
      "wuchang",
    );
  });

  it("ignores catalog posts and non-current monthly posts", () => {
    const feed = `<rss><channel>
      <item><title>PlayStation Plus Game Catalog for August: Alpha</title></item>
      <item><title>PlayStation Plus Monthly Games for July: Bravo</title></item>
    </channel></rss>`;
    expect(parsePsPlusMonthlyFeed(feed, new Date("2026-08-24T00:00:00Z"))).toBeNull();
  });

  it("selects the requested historical year when RSS search returns repeated month names", () => {
    const feed = `<rss><channel>
      <item>
        <title>PlayStation Plus Monthly Games for May: Old One, Old Two and Old Three</title>
        <pubDate>Tue, 02 May 2023 10:00:00 +0000</pubDate>
        <content:encoded><![CDATA[<h2>Old One | PS5</h2>]]></content:encoded>
      </item>
      <item>
        <title>PlayStation Plus Monthly Games for May: New One, New Two and New Three</title>
        <pubDate>Thu, 30 Apr 2026 10:00:00 +0000</pubDate>
        <content:encoded><![CDATA[
          <h2>New One | PS5</h2><h2>New Two | PS4</h2><h2>New Three | PS5</h2>
        ]]></content:encoded>
      </item>
    </channel></rss>`;

    expect(parsePsPlusMonthlyFeed(feed, new Date("2026-08-24T00:00:00Z"), "2026-05")).toMatchObject(
      {
        month: "2026-05",
        games: [{ title: "New One" }, { title: "New Two" }, { title: "New Three" }],
      },
    );
  });
});
