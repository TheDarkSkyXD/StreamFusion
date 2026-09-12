import { toSerializedTimestamp } from "@streamfusion/core/content";
import type { Channel, Stream, Video } from "@streamfusion/core/content";
import {
  parseGuestFollowWrite,
  type GuestFollow,
} from "@streamfusion/core/follows";
import type { Platform } from "@streamfusion/core/platform";

import type {
  FollowedReadOutcome,
  FollowedRecordedOutcome,
} from "../capabilities/following-session";

export function guestFollow(input: {
  readonly platform?: Platform;
  readonly channelId?: string;
  readonly channelLogin?: string;
  readonly displayName?: string;
} = {}): GuestFollow {
  const platform = input.platform ?? "twitch";
  const parsed = parseGuestFollowWrite({
    channelId: input.channelId ?? `${platform}-1`,
    channelLogin: input.channelLogin ?? `${platform}live`,
    displayName: input.displayName ?? "Alice",
    followedAt: "2026-09-11T00:00:00.000Z",
    platform,
  });
  if (parsed === null) throw new RangeError("invalid Guest Follow fixture");
  return parsed;
}

export function followedStream(input: {
  readonly platform?: Platform;
  readonly channelId?: string;
  readonly channelName?: string;
  readonly categoryId?: string;
  readonly categoryName?: string;
  readonly viewerCount?: number;
}): Stream {
  const platform = input.platform ?? "twitch";
  const channelName = input.channelName ?? `${platform}live`;
  return {
    channelAvatar: "https://example.com/a.png",
    channelDisplayName: input.channelName ?? "Alice",
    channelId: input.channelId ?? `${platform}-1`,
    channelName,
    id: `${platform}-stream`,
    isLive: true,
    language: "en",
    platform,
    startedAt: toSerializedTimestamp("2026-09-11T00:00:00.000Z"),
    tags: ["irl"],
    thumbnailUrl: "https://example.com/t.png",
    title: `${platform} live`,
    viewerCount: input.viewerCount ?? 12,
    ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
    ...(input.categoryName === undefined
      ? {}
      : { categoryName: input.categoryName }),
  };
}

export function followedChannel(input: {
  readonly platform?: Platform;
  readonly id?: string;
  readonly username?: string;
} = {}): Channel {
  const platform = input.platform ?? "twitch";
  return {
    avatarUrl: "https://example.com/a.png",
    displayName: "Alice",
    id: input.id ?? `${platform}-1`,
    isLive: true,
    isPartner: false,
    isVerified: false,
    platform,
    username: input.username ?? `${platform}live`,
  };
}

export function liveOutcome(
  platform: Platform,
  status: FollowedReadOutcome<Stream>["status"],
  items: readonly Stream[] = [],
): FollowedReadOutcome<Stream> {
  return {
    items,
    missing: [],
    offline: status === "failed",
    platform,
    retryable: status === "failed" || status === "stale",
    stale: status === "stale",
    status,
    ...(status === "failed" ? { error: "relay-unavailable" } : {}),
  };
}

export function recordedOutcome(input: {
  readonly platform: Platform;
  readonly supported?: boolean;
  readonly failed?: boolean;
  readonly items?: readonly Video[];
}): FollowedRecordedOutcome<Video> {
  return {
    channelId: `${input.platform}-1`,
    failed: input.failed === true,
    items: input.items ?? [],
    offline: false,
    platform: input.platform,
    stale: false,
    supported: input.supported ?? true,
  };
}
