import { describe, expect, it } from "vitest";
import {
  eligibleHistoricalMonths,
  historicalFeedUrl,
  isPastOrCurrentMonth,
  membershipCoversMonth,
} from "../lib/game/ps-plus-history";

const periods = [
  {
    service: "PlayStation Plus",
    startDate: "2026-05-15",
    endDate: "2026-09-14",
  },
];

describe("PS Plus history", () => {
  it("lists only completed membership months for manual backfill", () => {
    expect(eligibleHistoricalMonths(periods, new Date("2026-08-24T00:00:00Z"))).toEqual([
      "2026-07",
      "2026-06",
      "2026-05",
    ]);
  });

  it("accepts a membership period that overlaps part of a month", () => {
    expect(membershipCoversMonth(periods, "2026-05")).toBe(true);
    expect(membershipCoversMonth(periods, "2026-04")).toBe(false);
  });

  it("rejects future and malformed months", () => {
    const now = new Date("2026-08-24T00:00:00Z");
    expect(isPastOrCurrentMonth("2026-08", now)).toBe(true);
    expect(isPastOrCurrentMonth("2026-09", now)).toBe(false);
    expect(isPastOrCurrentMonth("2026-8", now)).toBe(false);
  });

  it("builds an official Blog RSS search URL for the requested month", () => {
    const url = historicalFeedUrl("2026-05");
    expect(url.hostname).toBe("blog.playstation.com");
    expect(url.searchParams.get("s")).toBe("PlayStation Plus Monthly Games for May");
    expect(url.searchParams.get("feed")).toBe("rss2");
  });
});
