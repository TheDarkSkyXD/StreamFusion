import {
  toSerializedTimestamp,
  type Channel,
  type Clip,
  type Video,
} from "@streamfusion/core/content";
import type { ChannelIdentity, Platform } from "@streamfusion/core/platform";

import type {
  ChannelDetailView,
  ChannelPageOutcome,
  DiscoveryFixtureMode,
} from "../capabilities/platform-reads";
import { composeChannelDetail, unsupportedMedia } from "./channel-detail";
import { fixtureStream } from "./discovery-fixture";

export type ChannelFixtureMode =
  | DiscoveryFixtureMode
  | "channel-empty"
  | "channel-failed"
  | "kick-unsupported";

export function fixtureChannel(
  platform: Platform,
  live: boolean,
): Channel {
  return {
    avatarUrl: "",
    bio: `${platform} channel about card`,
    categoryName: "Just Chatting",
    displayName: platform === "twitch" ? "Twitch Live" : "Kick Live",
    followerCount: 1200,
    id: `${platform}-c1`,
    isLive: live,
    isPartner: false,
    isVerified: false,
    lastStreamTitle: live ? `${platform} catalog proof stream` : "Last broadcast",
    platform,
    username: `${platform}-live`,
  };
}

export function fixtureVideo(platform: Platform): Video {
  return {
    channelAvatar: "",
    channelDisplayName: fixtureChannel(platform, false).displayName,
    channelId: `${platform}-c1`,
    channelName: `${platform}-live`,
    duration: 3600,
    id: `${platform}-v1`,
    platform,
    publishedAt: toSerializedTimestamp("2026-09-11T00:00:00.000Z"),
    thumbnailUrl: "",
    title: `${platform} recent broadcast`,
    type: "archive",
    url: "https://example.com/video",
    viewCount: 80,
  };
}

export function fixtureClip(platform: Platform): Clip {
  return {
    channelAvatar: "",
    channelDisplayName: fixtureChannel(platform, false).displayName,
    channelId: `${platform}-c1`,
    channelName: `${platform}-live`,
    clipUrl: "https://example.com/clip",
    createdAt: toSerializedTimestamp("2026-09-11T00:00:00.000Z"),
    creatorName: "viewer",
    duration: 20,
    id: `${platform}-clip1`,
    platform,
    thumbnailUrl: "",
    title: `${platform} clip`,
    viewCount: 12,
  };
}

export function fixtureChannelPage(
  platform: Platform,
  mode: ChannelFixtureMode,
): ChannelPageOutcome {
  if (mode === "loading") {
    return {
      cache: { kind: "miss" },
      channel: null,
      live: null,
      path: { kind: "relay", platform },
      platform,
      status: "partial",
    };
  }
  if (mode === "channel-empty" || mode === "cache-miss") {
    return {
      cache: { kind: "miss" },
      channel: null,
      live: null,
      path: { kind: "relay", platform },
      platform,
      status: "complete",
    };
  }
  if (mode === "channel-failed" || mode === "twitch-fail" || mode === "kick-fail") {
    return {
      cache: { kind: "miss" },
      channel: null,
      error: { code: `${platform}-failed`, retry: "manual" },
      live: null,
      path: { kind: "relay", platform },
      platform,
      status: "failed",
    };
  }
  if (mode === "stale-cache") {
    return {
      cache: { ageMilliseconds: 3_600_000, kind: "hit", stale: true },
      channel: fixtureChannel(platform, false),
      live: null,
      path: { kind: "unavailable", platform, reason: "offline" },
      platform,
      status: "stale",
    };
  }
  const live = fixtureStream(platform, `${platform}-ready`, 40);
  return {
    cache: { kind: "miss" },
    channel: fixtureChannel(platform, true),
    live,
    path: { kind: "relay", platform },
    platform,
    status: "complete",
  };
}

export function fixtureChannelDetail(
  channel: ChannelIdentity,
  mode: ChannelFixtureMode,
): ChannelDetailView {
  const platform = channel.platform;
  if (mode === "kick-unsupported" || platform === "kick") {
    return composeChannelDetail({
      clips: unsupportedMedia("kick", "clips"),
      loading: mode === "loading",
      page: fixtureChannelPage(platform, mode === "kick-unsupported" ? "ready" : mode),
      videos: unsupportedMedia("kick", "videos"),
    });
  }
  return composeChannelDetail({
    clips: {
      kind: "page",
      outcome: {
        cache: { kind: "miss" },
        items: mode === "channel-empty" ? [] : [fixtureClip(platform)],
        path: { kind: "relay", platform },
        platform,
        status: "complete",
      },
    },
    loading: mode === "loading",
    page: fixtureChannelPage(platform, mode),
    videos: {
      kind: "page",
      outcome: {
        cache: { kind: "miss" },
        items: mode === "channel-empty" ? [] : [fixtureVideo(platform)],
        path: { kind: "relay", platform },
        platform,
        status: "complete",
      },
    },
  });
}
