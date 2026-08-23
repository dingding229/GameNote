import type { FormState, RecognizedGame } from "./types";
import { createEmptyForm, normalizeFormatForPlatform } from "./utils";

export function createFormFromRecognizedGame(
  game: RecognizedGame,
  fallbackPurchaseDate: string,
): FormState {
  return {
    ...createEmptyForm(game.platform),
    platform: game.platform,
    title: game.title.trim(),
    price: Number(game.price) || 0,
    currency: game.currency,
    purchaseDate: game.purchaseDate || fallbackPurchaseDate,
    region: game.region,
    format: normalizeFormatForPlatform(game.format, game.platform),
    seller: game.seller.trim(),
    notes: game.notes.trim(),
    soldCurrency: game.currency,
  };
}
