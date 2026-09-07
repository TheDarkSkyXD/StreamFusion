import type { UnifiedCategory, UnifiedChannel } from "../../../../../shared/platform-types";
import type { TwitchHelixRequestPort } from "@backend/api/platforms/twitch/twitch-transport";
import {
  helixResponseSchema,
  twitchGameSchema,
  twitchSearchChannelSchema,
} from "../../../../api/platforms/twitch/twitch-helix-schemas";
import { transformTwitchCategory, transformTwitchSearchChannel } from "../../../../api/platforms/twitch/twitch-transformers";
import type { PaginatedResult, PaginationOptions } from "../../../../api/platforms/twitch/twitch-types";

/**
 * Search for channels
 */
export async function searchChannels(
  client: TwitchHelixRequestPort,
  query: string,
  options: PaginationOptions & { liveOnly?: boolean } = {}
): Promise<PaginatedResult<UnifiedChannel>> {
  const params = new URLSearchParams({
    query,
    first: String(options.first || 20),
  });

  if (options.after) {
    params.set("after", options.after);
  }
  if (options.liveOnly !== undefined) {
    params.set("live_only", String(options.liveOnly));
  }

  const data = helixResponseSchema(twitchSearchChannelSchema).parse(
    await client.request(`/search/channels?${params.toString()}`)
  );

  // Transform search results to unified channels
  const channels: UnifiedChannel[] = data.data.map(transformTwitchSearchChannel);

  return {
    data: channels,
    cursor: data.pagination?.cursor,
  };
}

/**
 * Search for categories/games
 */
export async function searchCategories(
  client: TwitchHelixRequestPort,
  query: string,
  options: PaginationOptions = {}
): Promise<PaginatedResult<UnifiedCategory>> {
  const params = new URLSearchParams({
    query,
    first: String(options.first || 20),
  });

  if (options.after) {
    params.set("after", options.after);
  }

  const data = helixResponseSchema(twitchGameSchema).parse(
    await client.request(`/search/categories?${params.toString()}`)
  );

  return {
    data: data.data.map(transformTwitchCategory),
    cursor: data.pagination?.cursor,
  };
}
