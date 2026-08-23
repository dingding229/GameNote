import { NextResponse } from "next/server";

const supportedCurrencies = ["JPY", "HKD", "USD", "EUR", "BRL"] as const;

type FrankfurterResponse = {
  date?: unknown;
  quote?: unknown;
  rate?: unknown;
  rates?: Record<string, unknown>;
};

export const runtime = "edge";

export async function GET() {
  try {
    const response = await fetch(
      `https://api.frankfurter.dev/v2/rates?base=CNY&quotes=${supportedCurrencies.join(",")}`,
      {
        headers: { accept: "application/json" },
        next: { revalidate: 60 * 60 * 12 },
      },
    );

    if (!response.ok) {
      throw new Error(`Frankfurter returned HTTP ${response.status}`);
    }

    const payload = (await response.json()) as FrankfurterResponse | FrankfurterResponse[];
    const rates: Record<string, number> = { CNY: 1 };
    const sourceRates = normalizeFrankfurterRates(payload);

    for (const currency of supportedCurrencies) {
      const cnyToCurrency = Number(sourceRates[currency]);

      if (!Number.isFinite(cnyToCurrency) || cnyToCurrency <= 0) {
        throw new Error(`Missing exchange rate for ${currency}`);
      }

      rates[currency] = 1 / cnyToCurrency;
    }

    return NextResponse.json(
      {
        base: "CNY",
        date: getFrankfurterDate(payload),
        rates,
        source: "Frankfurter",
      },
      {
        headers: {
          "cache-control": "public, max-age=3600, stale-while-revalidate=43200",
        },
      },
    );
  } catch (error) {
    console.error("Failed to load exchange rates", error);

    return NextResponse.json(
      { error: "无法更新汇率" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}

function normalizeFrankfurterRates(payload: FrankfurterResponse | FrankfurterResponse[]) {
  if (!Array.isArray(payload)) {
    return payload.rates ?? {};
  }

  return Object.fromEntries(
    payload
      .map((entry) => [entry.quote, entry.rate])
      .filter(
        (entry): entry is [string, unknown] => typeof entry[0] === "string" && entry[0].length > 0,
      ),
  );
}

function getFrankfurterDate(payload: FrankfurterResponse | FrankfurterResponse[]) {
  if (Array.isArray(payload)) {
    const firstDate = payload.find((entry) => typeof entry.date === "string")?.date;
    return typeof firstDate === "string" ? firstDate : "";
  }

  return typeof payload.date === "string" ? payload.date : "";
}
