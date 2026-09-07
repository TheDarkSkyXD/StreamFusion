import type { UnifiedStream } from "../../../../../shared/platform-types";
import type { TwitchHelixRequestPort } from "@backend/api/platforms/twitch/twitch-transport";
import { helixResponseSchema, twitchStreamSchema } from "../../../../api/platforms/twitch/twitch-helix-schemas";
import { transformTwitchStream } from "../../../../api/platforms/twitch/twitch-transformers";
import type { PaginatedResult, PaginationOptions, TwitchApiStream } from "../../../../api/platforms/twitch/twitch-types";

import { getUser } from "@backend/features/authentication/adapters/twitch/account-endpoints";
import { getUsersById } from "./user-endpoints";

function applyUserMetadata(
  stream: UnifiedStream,
  user?: { profileImageUrl?: string; broadcasterType?: string }
): UnifiedStream {
  if (!user) return stream;

  if (user.profileImageUrl) {
    stream.channelAvatar = user.profileImageUrl;
  }
  stream.channelIsVerified = user.broadcasterType === "partner";
  return stream;
}

async function enrichStreamsWithUsers(
  client: TwitchHelixRequestPort,
  streams: TwitchApiStream[]
): Promise<UnifiedStream[]> {
  const unifiedStreams = streams.map(transformTwitchStream);
  const userIds = streams.map((s) => s.user_id);
  const users = await getUsersById(client, userIds);
  const userMap = new Map(users.map((u) => [u.id, u]));

  return unifiedStreams.map((stream, index) =>
    applyUserMetadata(stream, userMap.get(streams[index].user_id))
  );
}

/**
 * Get live streams for specific user IDs
 */
export async function getStreamsByUserIds(
  client: TwitchHelixRequestPort,
  userIds: string[],
  options: PaginationOptions = {}
): Promise<PaginatedResult<UnifiedStream>> {
  if (userIds.length === 0) return { data: [] };
  if (userIds.length > 100) {
    throw new Error("Cannot fetch more than 100 streams at once");
  }

  const params = new URLSearchParams({
    first: String(options.first || 100),
  });

  userIds.forEach((id) => params.append("user_id", id));

  if (options.after) {
    params.set("after", options.after);
  }

  const data = helixResponseSchema(twitchStreamSchema).parse(
    await client.request(`/streams?${params.toString()}`)
  );

  return {
    data: await enrichStreamsWithUsers(client, data.data),
    cursor: data.pagination?.cursor,
  };
}

/**
 * Get live streams for followed channels
 */
export async function getFollowedStreams(
  client: TwitchHelixRequestPort,
  options: PaginationOptions = {}
): Promise<PaginatedResult<UnifiedStream>> {
  const user = await getUser(client);
  if (!user) {
    throw new Error("Must be authenticated to get followed streams");
  }

  const params = new URLSearchParams({
    user_id: user.id,
    first: String(options.first || 100),
  });

  if (options.after) {
    params.set("after", options.after);
  }

  const data = helixResponseSchema(twitchStreamSchema).parse(
    await client.request(`/streams/followed?${params.toString()}`)
  );

  return {
    data: await enrichStreamsWithUsers(client, data.data),
    cursor: data.pagination?.cursor,
  };
}

/**
 * Get top live streams
 */
export async function getTopStreams(
  client: TwitchHelixRequestPort,
  options: PaginationOptions & { gameId?: string; language?: string } = {}
): Promise<PaginatedResult<UnifiedStream>> {
  const params = new URLSearchParams({
    first: String(options.first || 20),
  });

  if (options.after) {
    params.set("after", options.after);
  }
  if (options.gameId) {
    params.set("game_id", options.gameId);
  }
  if (options.language) {
    params.set("language", options.language);
  }

  const data = helixResponseSchema(twitchStreamSchema).parse(
    await client.request(`/streams?${params.toString()}`)
  );

  return {
    data: await enrichStreamsWithUsers(client, data.data),
    cursor: data.pagination?.cursor,
  };
}

/**
 * Get a specific stream by user login
 */
export async function getStreamByLogin(
  client: TwitchHelixRequestPort,
  login: string
): Promise<UnifiedStream | null> {
  const params = new URLSearchParams({ user_login: login });
  const data = helixResponseSchema(twitchStreamSchema).parse(
    await client.request(`/streams?${params.toString()}`)
  );

  if (data.data && data.data.length > 0) {
    const [stream] = await enrichStreamsWithUsers(client, data.data);
    return stream;
  }
  return null;
}
