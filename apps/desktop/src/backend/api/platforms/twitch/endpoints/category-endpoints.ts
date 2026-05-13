import type { UnifiedCategory } from "../../../unified/platform-types";
import type { TwitchRequestor } from "../twitch-requestor";
import { transformTwitchCategory } from "../twitch-transformers";
import type {
  PaginatedResult,
  PaginationOptions,
  TwitchApiGame,
  TwitchApiResponse,
} from "../twitch-types";

/**
 * Get top categories/games
 */
export async function getTopCategories(
  client: TwitchRequestor,
  options: PaginationOptions = {}
): Promise<PaginatedResult<UnifiedCategory>> {
  const params = new URLSearchParams({
    first: String(options.first || 20),
  });

  if (options.after) {
    params.set("after", options.after);
  }

  const data = await client.request<TwitchApiResponse<TwitchApiGame>>(
    `/games/top?${params.toString()}`
  );

  return {
    data: data.data.map(transformTwitchCategory),
    cursor: data.pagination?.cursor,
  };
}

/**
 * Get category/game by ID
 */
export async function getCategoryById(
  client: TwitchRequestor,
  id: string
): Promise<UnifiedCategory | null> {
  const data = await client.request<TwitchApiResponse<TwitchApiGame>>(`/games?id=${id}`);

  if (data.data && data.data.length > 0) {
    return transformTwitchCategory(data.data[0]);
  }
  return null;
}

/**
 * Get categories/games by multiple IDs
 */
export async function getCategoriesByIds(
  client: TwitchRequestor,
  ids: string[]
): Promise<UnifiedCategory[]> {
  if (ids.length === 0) return [];

  // Twitch API supports up to 100 IDs per request
  // For now, assuming we won't exceed this for a single page of clips (12 clips)
  // If we do, we might need chunking, but for this use case it's fine.

  // Construct query string with multiple id parameters
  const params = new URLSearchParams();
  ids.forEach((id) => params.append("id", id));

  const data = await client.request<TwitchApiResponse<TwitchApiGame>>(
    `/games?${params.toString()}`
  );

  if (data.data) {
    return data.data.map(transformTwitchCategory);
  }
  return [];
}

/**
 * Get ALL top categories with automatic pagination until exhausted
 * No artificial limits - fetches every category available from Twitch
 */
export async function getAllTopCategories(client: TwitchRequestor): Promise<UnifiedCategory[]> {
  const allCategories: UnifiedCategory[] = [];
  let cursor: string | undefined;
  const perPage = 100; // Twitch max per request

  while (true) {
    const result = await getTopCategories(client, {
      first: perPage,
      after: cursor,
    });

    allCategories.push(...result.data);
    cursor = result.cursor;

    // Helix /games/top returns `pagination.cursor` only while more pages
    // exist, so the cursor alone is authoritative. Do NOT short-circuit on
    // `data.length < perPage`: Helix occasionally returns a partial page in
    // the middle of the list (post-cap filtering), and bailing on that
    // truncated the long tail of categories.
    if (!cursor || result.data.length === 0) {
      break;
    }

    // Safety valve to prevent runaway loops if the API misbehaves.
    if (allCategories.length >= 5000) {
      console.warn("⚠️ Twitch category fetch hit safety limit (5000)");
      break;
    }
  }

  return allCategories;
}
