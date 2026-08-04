import type { TwitchRequestor } from "../twitch-requestor";
import type {
  PaginatedResult,
  PaginationOptions,
  TwitchApiResponse,
  TwitchApiVideo,
} from "../twitch-types";

/**
 * Get videos by user ID
 */
export async function getVideosByUser(
  client: TwitchRequestor,
  userId: string,
  options: PaginationOptions & { type?: "archive" | "highlight" | "upload" } = {}
): Promise<PaginatedResult<TwitchApiVideo>> {
  const params = new URLSearchParams({
    user_id: userId,
    first: String(options.first || 20),
  });

  if (options.after) {
    params.set("after", options.after);
  }
  if (options.type) {
    params.set("type", options.type);
  }

  const data = await client.request<TwitchApiResponse<TwitchApiVideo>>(
    `/videos?${params.toString()}`
  );

  const first = options.first || 20;

  return {
    data: data.data,
    // Only return cursor if we got a full page (might be more data)
    cursor: data.data.length >= first ? data.pagination?.cursor : undefined,
  };
}

/** Get videos by native Twitch game/category ID. */
export async function getVideosByGame(
  client: TwitchRequestor,
  gameId: string,
  options: PaginationOptions & { sort?: "time" | "views" } = {}
): Promise<PaginatedResult<TwitchApiVideo>> {
  const params = new URLSearchParams({
    game_id: gameId,
    first: String(options.first || 20),
  });

  if (options.after) params.set("after", options.after);
  if (options.sort) params.set("sort", options.sort);

  const data = await client.request<TwitchApiResponse<TwitchApiVideo>>(
    `/videos?${params.toString()}`
  );
  const first = options.first || 20;

  return {
    data: data.data,
    cursor: data.data.length >= first ? data.pagination?.cursor : undefined,
  };
}

/**
 * Get a single video by ID
 */
export async function getVideoById(
  client: TwitchRequestor,
  videoId: string
): Promise<TwitchApiVideo | null> {
  const data = await client.request<TwitchApiResponse<TwitchApiVideo>>(`/videos?id=${videoId}`);

  return data.data[0] || null;
}
