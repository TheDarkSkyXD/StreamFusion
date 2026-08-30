import type { UnifiedChannel } from "../../../../../shared/platform-types";
import type { TwitchRequestor } from "../twitch-requestor";
import {
  helixResponseSchema,
  twitchChannelSchema,
  twitchUserSchema,
} from "../twitch-helix-schemas";
import { transformTwitchChannel } from "../twitch-transformers";

/**
 * Get channel information by broadcaster IDs
 */
export async function getChannelsById(
  client: TwitchRequestor,
  ids: string[]
): Promise<UnifiedChannel[]> {
  if (ids.length === 0) return [];
  if (ids.length > 100) {
    throw new Error("Cannot fetch more than 100 channels at once");
  }

  const params = new URLSearchParams();
  ids.forEach((id) => params.append("broadcaster_id", id));

  const data = helixResponseSchema(twitchChannelSchema).parse(
    await client.request(`/channels?${params.toString()}`)
  );

  // Get user info for profile images (raw API format)
  const userQueryString = ids.map((id) => `id=${id}`).join("&");
  const userData = helixResponseSchema(twitchUserSchema).parse(
    await client.request(`/users?${userQueryString}`)
  );
  const userMap = new Map(userData.data.map((u) => [u.id, u]));

  return data.data.map((channel) => {
    const apiUser = userMap.get(channel.broadcaster_id);
    return transformTwitchChannel(channel, apiUser);
  });
}
