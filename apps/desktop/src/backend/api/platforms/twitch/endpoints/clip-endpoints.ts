import type { TwitchRequestor } from "../twitch-requestor";
import type {
  PaginatedResult,
  PaginationOptions,
  TwitchApiClip,
  TwitchApiResponse,
} from "../twitch-types";

/**
 * Get clips by broadcaster ID
 */
export async function getClipsByBroadcaster(
  client: TwitchRequestor,
  broadcasterId: string,
  options: PaginationOptions = {}
): Promise<PaginatedResult<TwitchApiClip>> {
  const params = new URLSearchParams({
    broadcaster_id: broadcasterId,
    first: String(options.first || 20),
  });

  if (options.after) {
    params.set("after", options.after);
  }

  // Time range filtering for clips
  if (options.started_at) {
    params.set("started_at", options.started_at);
  }

  if (options.ended_at) {
    params.set("ended_at", options.ended_at);
  }

  const data = await client.request<TwitchApiResponse<TwitchApiClip>>(
    `/clips?${params.toString()}`
  );

  const first = options.first || 20;

  return {
    data: data.data,
    // Only return cursor if we got a full page (might be more data)
    cursor: data.data.length >= first ? data.pagination?.cursor : undefined,
  };
}

/** Get clips by native Twitch game/category ID. */
export async function getClipsByGame(
  client: TwitchRequestor,
  gameId: string,
  options: PaginationOptions = {}
): Promise<PaginatedResult<TwitchApiClip>> {
  const params = new URLSearchParams({
    game_id: gameId,
    first: String(options.first || 20),
  });

  if (options.after) params.set("after", options.after);
  if (options.started_at) params.set("started_at", options.started_at);
  if (options.ended_at) params.set("ended_at", options.ended_at);

  const data = await client.request<TwitchApiResponse<TwitchApiClip>>(
    `/clips?${params.toString()}`
  );
  const first = options.first || 20;

  return {
    data: data.data,
    cursor: data.data.length >= first ? data.pagination?.cursor : undefined,
  };
}
