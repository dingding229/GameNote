import { describe, expect, it } from "vitest";
import {
  activeMembershipPeriods,
  normalizeAppSettings,
  normalizeMembershipPeriods,
} from "../lib/ledger/repository";

describe("membership periods", () => {
  it("keeps expired periods and derives the active membership", () => {
    const settings = normalizeAppSettings({
      membershipPeriods: [
        {
          id: "expired",
          service: "PlayStation Plus",
          startDate: "2025-01-01",
          endDate: "2025-12-31",
          price: 200,
          currency: "HKD",
        },
        {
          id: "active",
          service: "PlayStation Plus",
          startDate: "2026-01-01",
          endDate: "2099-12-31",
          price: 300,
          currency: "HKD",
        },
      ],
    });

    expect(settings.membershipPeriods).toHaveLength(2);
    expect(
      activeMembershipPeriods(settings.membershipPeriods, "PlayStation Plus", "2026-08-24"),
    ).toMatchObject([{ id: "active", price: 300 }]);
    expect(settings.psPlusEnabled).toBe(true);
    expect(settings.psPlusExpiresAt).toBe("2099-12-31");
  });

  it("migrates legacy expiry settings without inventing a start date", () => {
    expect(
      normalizeMembershipPeriods(undefined, {
        nsOnlineEnabled: true,
        nsOnlineExpiresAt: "2027-01-31",
      }),
    ).toEqual([
      {
        id: "legacy-ns-online",
        service: "Nintendo Switch Online",
        startDate: "",
        endDate: "2027-01-31",
        price: 0,
        currency: "CNY",
      },
    ]);
  });

  it("rejects invalid dates and duplicate record identifiers", () => {
    expect(
      normalizeMembershipPeriods([
        {
          id: "duplicate",
          service: "PlayStation Plus",
          startDate: "2026-02-30",
          endDate: "2027-01-31",
          price: 100,
          currency: "HKD",
        },
        {
          id: "duplicate",
          service: "PlayStation Plus",
          startDate: "2027-01-01",
          endDate: "2027-12-31",
          price: 200,
          currency: "HKD",
        },
      ]),
    ).toEqual([
      {
        id: "duplicate",
        service: "PlayStation Plus",
        startDate: "2027-01-01",
        endDate: "2027-12-31",
        price: 200,
        currency: "HKD",
      },
    ]);
  });
});
