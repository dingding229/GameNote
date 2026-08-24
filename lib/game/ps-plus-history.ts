export type PsPlusMembershipPeriod = {
  service: string;
  startDate: string;
  endDate: string;
};

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isPastOrCurrentMonth(month: string, now = new Date()) {
  return monthPattern.test(month) && month <= now.toISOString().slice(0, 7);
}

export function membershipCoversMonth(periods: PsPlusMembershipPeriod[], month: string) {
  if (!monthPattern.test(month)) return false;
  const monthStart = `${month}-01`;
  const monthEnd = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
    .toISOString()
    .slice(0, 10);
  return periods.some(
    (period) =>
      period.service === "PlayStation Plus" &&
      (!period.startDate || period.startDate <= monthEnd) &&
      period.endDate >= monthStart,
  );
}

export function eligibleHistoricalMonths(periods: PsPlusMembershipPeriod[], now = new Date()) {
  const currentMonth = now.toISOString().slice(0, 7);
  const months = new Set<string>();
  for (const period of periods) {
    if (period.service !== "PlayStation Plus" || !period.endDate) continue;
    const startMonth = (period.startDate || period.endDate).slice(0, 7);
    const endMonth =
      period.endDate.slice(0, 7) < currentMonth ? period.endDate.slice(0, 7) : currentMonth;
    if (!monthPattern.test(startMonth) || !monthPattern.test(endMonth)) continue;
    let cursor = new Date(`${startMonth}-01T00:00:00Z`);
    const end = new Date(`${endMonth}-01T00:00:00Z`);
    while (cursor <= end) {
      const month = cursor.toISOString().slice(0, 7);
      if (month < currentMonth && membershipCoversMonth([period], month)) months.add(month);
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    }
  }
  return [...months].sort().reverse();
}

export function historicalFeedUrl(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const monthName = new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleString("en-US", {
    month: "long",
    timeZone: "UTC",
  });
  const url = new URL("https://blog.playstation.com/");
  url.searchParams.set("s", `PlayStation Plus Monthly Games for ${monthName}`);
  url.searchParams.set("feed", "rss2");
  return url;
}
