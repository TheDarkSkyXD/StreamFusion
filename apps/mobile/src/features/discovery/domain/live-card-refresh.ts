export const LIVE_CARD_REFRESH_MS = 300_000;

export function isLiveCardQueryKey(key: readonly unknown[]): boolean {
  if (key[0] === "follows") return key[1] === "live";
  if (key[0] !== "discovery") return false;
  if (key[1] === "top-streams") return true;
  if (key[1] === "search-page") return key[3] === "streams";
  if (key[1] === "category-media") return key[3] === "live";
  return key[1] === "channel";
}
