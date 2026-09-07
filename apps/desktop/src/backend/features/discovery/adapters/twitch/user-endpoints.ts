import type { TwitchHelixRequestPort } from "@backend/api/platforms/twitch/twitch-transport";
import { logger } from "@backend/logging/logger";
import { z } from "zod";
import type { TwitchUser } from "../../../../../shared/auth-types";
import {
  helixResponseSchema,
  twitchUserSchema,
} from "../../../../api/platforms/twitch/twitch-helix-schemas";

/**
 * Get users by their IDs
 */
export async function getUsersById(
  client: TwitchHelixRequestPort,
  ids: string[]
): Promise<TwitchUser[]> {
  if (ids.length === 0) return [];
  if (ids.length > 100) {
    throw new Error("Cannot fetch more than 100 users at once");
  }

  const queryString = ids.map((id) => `id=${id}`).join("&");
  const data = helixResponseSchema(twitchUserSchema).parse(
    await client.request(`/users?${queryString}`)
  );

  return data.data.map((u) => ({
    id: u.id,
    login: u.login,
    displayName: u.display_name,
    profileImageUrl: u.profile_image_url,
    email: u.email,
    createdAt: u.created_at,
    broadcasterType: u.broadcaster_type,
  }));
}

/**
 * Get users by their login names
 */
export async function getUsersByLogin(
  client: TwitchHelixRequestPort,
  logins: string[]
): Promise<TwitchUser[]> {
  if (logins.length === 0) return [];
  if (logins.length > 100) {
    throw new Error("Cannot fetch more than 100 users at once");
  }

  const queryString = logins.map((login) => `login=${login}`).join("&");
  const data = helixResponseSchema(twitchUserSchema).parse(
    await client.request(`/users?${queryString}`)
  );

  return data.data.map((u) => ({
    id: u.id,
    login: u.login,
    displayName: u.display_name,
    profileImageUrl: u.profile_image_url,
    email: u.email,
    createdAt: u.created_at,
    broadcasterType: u.broadcaster_type,
  }));
}

/**
 * Get follower count for a broadcaster
 * Uses the /channels/followers endpoint which returns total count
 *
 * Note: This endpoint requires a user access token with moderator:read:followers scope.
 * Returns null on auth failures (401/403) to distinguish from legitimate 0 followers.
 */
async function getFollowerCount(
  client: TwitchHelixRequestPort,
  broadcasterId: string
): Promise<number | null> {
  try {
    const data = helixResponseSchema(z.unknown()).parse(
      await client.request(`/channels/followers?broadcaster_id=${broadcasterId}&first=1`)
    );
    return data.total ?? 0;
  } catch (error: unknown) {
    // Check for auth failures - return null to distinguish from 0 followers
    const status =
      typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
    const responseStatus =
      typeof error === "object" &&
      error !== null &&
      "response" in error &&
      typeof error.response === "object" &&
      error.response !== null &&
      "status" in error.response
        ? error.response.status
        : undefined;
    if (status === 401 || status === 403 || responseStatus === 401 || responseStatus === 403) {
      logger.debug("Twitch:Endpoints:User", "getFollowerCount auth failure", {
        broadcasterId,
      });
      return null;
    }
    logger.warn("Twitch:Endpoints:User", "Failed to get follower count", {
      broadcasterId,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    });
    return null;
  }
}

/**
 * Get follower counts for multiple broadcasters (batch)
 * Returns a Map of broadcasterId -> followerCount
 * Note: IDs with auth failures (null counts) are omitted from the result
 */
export async function getFollowerCounts(
  client: TwitchHelixRequestPort,
  broadcasterIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();

  // Twitch API doesn't support batch follower count requests.
  // We make individual requests in parallel, capped at a concurrency limit.
  // Helix /channels/followers consumes 1 rate-limit point per call;
  // per-token bucket is 800/min, so 25 concurrent is well within budget.
  // The 429 retry path in twitch-requestor absorbs any overshoot.
  const concurrencyLimit = 25;

  for (let i = 0; i < broadcasterIds.length; i += concurrencyLimit) {
    const batch = broadcasterIds.slice(i, i + concurrencyLimit);
    const results = await Promise.all(
      batch.map(async (id) => {
        const count = await getFollowerCount(client, id);
        return { id, count };
      })
    );

    for (const result of results) {
      // Only set count if we got a valid number (not null/auth failure)
      if (result.count !== null) {
        counts.set(result.id, result.count);
      }
    }
  }

  return counts;
}
