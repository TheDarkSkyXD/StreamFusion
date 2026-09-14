import { findGuestFollow, type GuestFollow } from "@streamfusion/core/follows";
import type { ChannelIdentity } from "@streamfusion/core/platform";

import type { FollowView } from "../capabilities/platform-reads";

export function composeGuestFollowView(input: {
  readonly channel: ChannelIdentity;
  readonly error?: string | null;
  readonly membership: readonly GuestFollow[];
  readonly pending: boolean;
}): FollowView {
  if (input.pending) return { kind: "pending" };
  if (input.error) return { kind: "failed", reason: input.error };
  const existing = findGuestFollow(input.membership, {
    platform: input.channel.platform,
    channelId: input.channel.id,
    channelLogin: input.channel.username,
  });
  return existing === undefined
    ? { kind: "guest-absent" }
    : { kind: "guest-present" };
}

export function followCopy(follow: FollowView): string {
  if (follow.kind === "pending") return "Updating Guest Follow state.";
  if (follow.kind === "failed") return follow.reason;
  if (follow.kind === "guest-present") {
    return "This channel is a Guest Follow on this device.";
  }
  return "Save this channel as a Guest Follow on this device.";
}

export function followActionLabel(follow: FollowView): string {
  return follow.kind === "guest-present" ? "Unfollow" : "Follow";
}

export function providerPageLabel(platform: ChannelIdentity["platform"]): string {
  return platform === "twitch" ? "Open on Twitch" : "Open on Kick";
}
