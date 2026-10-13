import {
  parseGuestFollowWrite,
  type GuestFollow,
} from "@streamfusion/core/follows";

import { createTwitchHelixReader } from "@mobile/features/discovery/adapters/twitch/twitch-helix-reader";
import {
  helixFollowedChannels,
  type HelixFollowedChannel,
} from "@mobile/features/discovery/adapters/twitch/helix-catalog-map";

import type {
  AccountFollowMembershipOutcome,
  AccountFollowMembershipSource,
  AccountLiveStreamsSource,
} from "../capabilities/account-follow-membership";

export type TwitchAccountCredentialRead = {
  readonly accessToken: string;
  readonly userId: string;
};

/**
 * Twitch Helix /channels/followed → GuestFollow-shaped membership.
 * Requires a Twitch client id and a ready credential. Missing either degrades
 * to unavailable so Guest Follows keep working.
 */
export function createTwitchAccountFollowMembership(input: {
  readonly clientId: () => string | null;
  readonly fetch?: typeof globalThis.fetch;
  readonly readCredential: () => Promise<TwitchAccountCredentialRead | null>;
}): AccountFollowMembershipSource {
  return {
    async read(): Promise<AccountFollowMembershipOutcome> {
      const clientId = input.clientId();
      if (clientId === null) {
        return {
          kind: "unavailable",
          reason: "twitch-client-id-missing",
        };
      }
      const credential = await input.readCredential();
      if (credential === null) {
        return {
          kind: "unavailable",
          reason: "twitch-signed-out",
        };
      }
      try {
        const response = await (input.fetch ?? globalThis.fetch)(
          `https://api.twitch.tv/helix/channels/followed?user_id=${encodeURIComponent(credential.userId)}&first=100`,
          {
            headers: {
              Authorization: `Bearer ${credential.accessToken}`,
              "Client-Id": clientId,
            },
          },
        );
        if (!response.ok)
          return {
            kind: "unavailable",
            reason: "twitch-followed-channels-failed",
          };
        const payload: unknown = await response.json();
        if (
          typeof payload !== "object" ||
          payload === null ||
          !("data" in payload) ||
          !Array.isArray(payload.data)
        ) {
          return {
            kind: "unavailable",
            reason: "twitch-followed-channels-invalid",
          };
        }
        const channels = helixFollowedChannels(payload);
        const follows = helixFollowedChannelsToGuestFollows(channels);
        if (follows.length !== payload.data.length)
          return {
            kind: "unavailable",
            reason: "twitch-followed-channels-invalid",
          };
        const pagination = "pagination" in payload ? payload.pagination : null;
        if (
          pagination !== null &&
          (typeof pagination !== "object" || Array.isArray(pagination))
        ) {
          return {
            kind: "unavailable",
            reason: "twitch-followed-channels-invalid",
          };
        }
        const cursor =
          pagination !== null && "cursor" in pagination
            ? pagination.cursor
            : undefined;
        if (cursor !== undefined && typeof cursor !== "string")
          return {
            kind: "unavailable",
            reason: "twitch-followed-channels-invalid",
          };
        const total = "total" in payload ? payload.total : undefined;
        if (
          total !== undefined &&
          (typeof total !== "number" ||
            !Number.isSafeInteger(total) ||
            total < 0)
        ) {
          return {
            kind: "unavailable",
            reason: "twitch-followed-channels-invalid",
          };
        }
        const partial =
          pagination === null ||
          (typeof cursor === "string" && cursor.length > 0) ||
          (typeof total === "number" && total > follows.length);
        return { kind: partial ? "partial" : "available", follows };
      } catch {
        return {
          kind: "unavailable",
          reason: "twitch-followed-channels-failed",
        };
      }
    },
  };
}

export function createTwitchAccountLiveStreamsSource(input: {
  readonly clientId: () => string | null;
  readonly fetch?: typeof globalThis.fetch;
  readonly readCredential: () => Promise<TwitchAccountCredentialRead | null>;
}): AccountLiveStreamsSource {
  return {
    async read() {
      const clientId = input.clientId();
      if (clientId === null) return [];
      const credential = await input.readCredential();
      if (credential === null) return [];
      const reader = createTwitchHelixReader({
        clientId,
        fetch: input.fetch ?? globalThis.fetch,
        readAccessToken: async () => credential.accessToken,
        readUserId: async () => credential.userId,
      });
      const outcome = await reader.getFollowedStreams();
      if (outcome.status !== "complete" && outcome.status !== "partial") {
        return [];
      }
      return outcome.items;
    },
  };
}

/** @deprecated Import from kick-account-follow-membership instead. */
export { createKickAccountFollowMembershipUnavailable } from "./kick-account-follow-membership";

export function helixFollowedChannelsToGuestFollows(
  channels: readonly HelixFollowedChannel[],
): readonly GuestFollow[] {
  const follows: GuestFollow[] = [];
  for (const channel of channels) {
    const followedAtMs = Date.parse(channel.followedAt);
    const followedAt = Number.isNaN(followedAtMs)
      ? new Date(0).toISOString()
      : new Date(followedAtMs).toISOString();
    const follow = parseGuestFollowWrite({
      channelId: channel.channelId,
      channelLogin: channel.channelLogin,
      displayName: channel.displayName,
      followedAt,
      platform: "twitch",
    });
    if (follow) follows.push(follow);
  }
  return follows;
}
