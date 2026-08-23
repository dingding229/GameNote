export const ledgerLimits = {
  maxRecords: 2_000,
  maxRequestBytes: 5 * 1024 * 1024,
  title: 200,
  seller: 120,
  notes: 2_000,
  url: 2_048,
  id: 120,
} as const;

export function limitText(value: unknown, maximumLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
}

export function validLedgerNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100_000_000 ? number : 0;
}
