import { describe, expect, it } from "vitest";
import { parsePsPlusMonthlyFeed } from "../lib/game/ps-plus-monthly";

describe("PS Plus monthly feed", () => {
  it("extracts the current lineup and per-game fallback images", () => {
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
      games: [
        {
          title: "Alpha",
          coverUrl: "https://blog.playstation.com/alpha.jpg",
          officialUrl: "https://blog.playstation.com/monthly-august/",
        },
        {
          title: "Bravo",
          coverUrl: "https://blog.playstation.com/bravo.jpg",
          officialUrl: "https://blog.playstation.com/monthly-august/",
        },
        {
          title: "Charlie",
          coverUrl: "https://blog.playstation.com/charlie.jpg",
          officialUrl: "https://blog.playstation.com/monthly-august/",
        },
      ],
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
      coverUrl: "https://blog.playstation.com/darktide.jpg",
    });
  });

  it("ignores catalog posts and non-current monthly posts", () => {
    const feed = `<rss><channel>
      <item><title>PlayStation Plus Game Catalog for August: Alpha</title></item>
      <item><title>PlayStation Plus Monthly Games for July: Bravo</title></item>
    </channel></rss>`;
    expect(parsePsPlusMonthlyFeed(feed, new Date("2026-08-24T00:00:00Z"))).toBeNull();
  });
});
