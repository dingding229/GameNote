import type { GamePlatform } from "./ledger";

export type StatsPlatformScope = "all" | "nintendo-switch" | "playstation";

export function getStatsPlatformScope(): StatsPlatformScope {
  return normalizeStatsPlatformScope(process.env.APP_STATS_PLATFORMS);
}

export function normalizeStatsPlatformScope(
  value: string | undefined,
): StatsPlatformScope {
  const normalized = (value || "all")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[+,/]+/g, "-");

  if (["all", "both", "ns-ps", "ps-ns"].includes(normalized)) {
    return "all";
  }

  if (["ns", "switch", "nintendo", "nintendo-switch"].includes(normalized)) {
    return "nintendo-switch";
  }

  if (["ps", "playstation", "play-station"].includes(normalized)) {
    return "playstation";
  }

  return "all";
}

export function statsPlatformsForScope(scope: StatsPlatformScope): GamePlatform[] {
  if (scope === "nintendo-switch") {
    return ["Nintendo Switch"];
  }

  if (scope === "playstation") {
    return ["PlayStation"];
  }

  return ["Nintendo Switch", "PlayStation"];
}
