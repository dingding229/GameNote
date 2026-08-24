import { describe, expect, it } from "vitest";
import { isFrozenPsPlusRecord, isPsPlusMonthlyRecord } from "../lib/game/ps-plus-record";

const monthlyRecord = {
  platform: "PlayStation",
  sourceKey: "ps-plus:2026-08:signalis",
  notes: "PS Plus 会免 2026-08",
};

describe("PS Plus monthly records", () => {
  it("freezes an automatically added monthly game while membership is inactive", () => {
    expect(isPsPlusMonthlyRecord(monthlyRecord)).toBe(true);
    expect(isFrozenPsPlusRecord(monthlyRecord, false)).toBe(true);
    expect(isFrozenPsPlusRecord(monthlyRecord, true)).toBe(false);
  });

  it("recognizes legacy monthly notes but leaves regular PlayStation games active", () => {
    expect(
      isPsPlusMonthlyRecord({
        platform: "PlayStation",
        notes: "收藏备注\nPS Plus 会免 2025-05",
      }),
    ).toBe(true);
    expect(isFrozenPsPlusRecord({ platform: "PlayStation", notes: "普通购买记录" }, false)).toBe(
      false,
    );
  });
});
