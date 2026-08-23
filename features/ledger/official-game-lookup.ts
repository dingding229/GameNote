import type { NintendoCoverResult, RecognizedGame } from "./types";

type OfficialLookupGame = Omit<RecognizedGame, "coverUrl" | "officialUrl" | "officialLookupStatus">;

type OfficialLookupPayload = {
  results?: NintendoCoverResult[];
};

export async function enrichRecognizedGameWithOfficialData(
  game: OfficialLookupGame,
  fetcher: typeof fetch = fetch,
): Promise<RecognizedGame> {
  const endpoint =
    game.platform === "PlayStation" ? "/api/playstation-game" : "/api/nintendo-cover";

  try {
    const response = await fetcher(`${endpoint}?${new URLSearchParams({ q: game.title })}`);
    if (!response.ok) return withoutOfficialMatch(game);

    const payload = (await response.json()) as OfficialLookupPayload;
    const match = payload.results?.[0];
    if (!match) return withoutOfficialMatch(game);

    return {
      ...game,
      title: match.displayTitle || match.title || game.title,
      coverUrl: match.coverUrl || "",
      officialUrl: match.officialUrl || match.nintendoUrl || "",
      officialLookupStatus: "found",
    };
  } catch {
    return withoutOfficialMatch(game);
  }
}

function withoutOfficialMatch(game: OfficialLookupGame): RecognizedGame {
  return {
    ...game,
    coverUrl: "",
    officialUrl: "",
    officialLookupStatus: "not-found",
  };
}
