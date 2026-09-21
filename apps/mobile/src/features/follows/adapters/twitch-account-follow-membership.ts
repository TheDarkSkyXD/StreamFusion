import {
  parseGuestFollowWrite,
  type GuestFollow,
} from "@streamfusion/core/follows";

import { createTwitchHelixReader } from "@mobile/features/discovery/adapters/twitch/twitch-helix-reader";
import type { HelixFollowedChannel } from "@mobile/features/discovery/adapters/twitch/helix-catalog-map";

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
      const reader = createTwitchHelixReader({
        clientId,
        fetch: input.fetch ?? globalThis.fetch,
        readAccessToken: async () => credential.accessToken,
        readUserId: async () => credential.userId,
      });
      const outcome = await reader.getFollowedChannels();
      if (outcome.status !== "complete" && outcome.status !== "partial") {
        return {
          kind: "unavailable",
          reason: outcome.error?.code ?? "twitch-followed-channels-failed",
        };
      }
      return {
        kind: "available",
        follows: helixFollowedChannelsToGuestFollows(outcome.items),
      };
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
