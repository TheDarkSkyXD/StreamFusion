import type { TwitchHelixRequestPort } from "@backend/api/platforms/twitch/twitch-transport";
import { logger } from "@backend/logging/logger";
import type { TwitchUser } from "../../../../../shared/auth-types";
import type { UnifiedChannel } from "../../../../../shared/platform-types";
import {
  helixResponseSchema,
  twitchFollowedChannelSchema,
  twitchUserSchema,
} from "../../../../api/platforms/twitch/twitch-helix-schemas";
import type {
  PaginatedResult,
  PaginationOptions,
} from "../../../../api/platforms/twitch/twitch-types";
export async function getUser(client: TwitchHelixRequestPort): Promise<TwitchUser | null> {
  try {
    const data = helixResponseSchema(twitchUserSchema).parse(await client.request("/users"));
    if (data.data && data.data.length > 0) {
      const apiUser = data.data[0];
      return {
        id: apiUser.id,
        login: apiUser.login,
        displayName: apiUser.display_name,
        profileImageUrl: apiUser.profile_image_url,
        email: apiUser.email,
        createdAt: apiUser.created_at,
        broadcasterType: apiUser.broadcaster_type,
      };
    }
    return null;
  } catch (error) {
    logger.error("Twitch:Endpoints:User", "Failed to get Twitch user", {
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    });
    return null;
  }
}

export async function getFollowedChannels(
  client: TwitchHelixRequestPort,
  options: PaginationOptions = {}
): Promise<PaginatedResult<UnifiedChannel>> {
  const user = await getUser(client);
  if (!user) {
    throw new Error("Must be authenticated to get followed channels");
  }

  const params = new URLSearchParams({
    user_id: user.id,
    first: String(options.first || 100),
  });

  if (options.after) {
    params.set("after", options.after);
  }

  const data = helixResponseSchema(twitchFollowedChannelSchema).parse(
    await client.request(`/channels/followed?${params.toString()}`)
  );

  // Get full channel info for each followed channel
  const channelIds = data.data.map((f) => f.broadcaster_id);
  const { getChannelsById } =
    await import("@backend/features/discovery/adapters/twitch/channel-endpoints");
  const enrichedChannels = await getChannelsById(client, channelIds);
  const enrichedById = new Map(enrichedChannels.map((channel) => [channel.id, channel]));
  const channels = data.data.map(
    (follow): UnifiedChannel =>
      enrichedById.get(follow.broadcaster_id) ?? {
        id: follow.broadcaster_id,
        platform: "twitch",
        username: follow.broadcaster_login,
        displayName: follow.broadcaster_name,
        avatarUrl: "",
        isLive: false,
        isVerified: false,
        isPartner: false,
      }
  );

  return {
    data: channels,
    cursor: data.pagination?.cursor,
    total: data.total,
  };
}

const followedChannelScans = new WeakMap<TwitchHelixRequestPort, Promise<UnifiedChannel[]>>();

async function fetchAllFollowedChannels(client: TwitchHelixRequestPort): Promise<UnifiedChannel[]> {
  const allChannels: UnifiedChannel[] = [];
  let cursor: string | undefined;

  do {
    const result = await getFollowedChannels(client, { after: cursor, first: 100 });
    allChannels.push(...result.data);
    cursor = result.cursor;
  } while (cursor);

  return allChannels;
}

export function getAllFollowedChannels(client: TwitchHelixRequestPort): Promise<UnifiedChannel[]> {
  const inFlight = followedChannelScans.get(client);
  if (inFlight) return inFlight;

  const scan = fetchAllFollowedChannels(client);
  const trackedScan = scan.finally(() => {
    if (followedChannelScans.get(client) === trackedScan) {
      followedChannelScans.delete(client);
    }
  });
  followedChannelScans.set(client, trackedScan);
  return trackedScan;
}
