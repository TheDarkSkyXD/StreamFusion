import type {
  Category,
  Clip,
  SerializedTimestamp,
  Stream,
  Video,
} from "@streamfusion/core/content";
import type { Platform } from "@streamfusion/core/platform";

import type {
  DiscoveryFixtureMode,
  PlatformReadOutcome,
} from "../capabilities/platform-reads";

export function fixtureStream(
  platform: Platform,
  id: string,
  viewers: number,
): Stream {
  return {
    channelAvatar: "",
    channelDisplayName: platform === "twitch" ? "Twitch Live" : "Kick Live",
    channelId: `${platform}-${id}`,
    channelName: `${platform}-live`,
    id,
    isLive: true,
    language: "en",
    platform,
    startedAt: null,
    tags: ["proof"],
    thumbnailUrl: "",
    title:
      platform === "twitch"
        ? "Twitch catalog proof stream"
        : "Kick catalog proof stream",
    viewerCount: viewers,
  };
}

export function fixtureCategory(
  platform: Platform,
  id: string,
  name: string,
  viewers?: number,
): Category {
  return {
    boxArtUrl: "https://example.com/box.png",
    id,
    name,
    platform,
    ...(viewers === undefined ? {} : { viewerCount: viewers }),
  };
}

export function fixtureClip(
  platform: Platform,
  id: string,
  views: number,
): Clip {
  return {
    channelAvatar: "",
    channelDisplayName: "Clip Creator",
    channelId: `${platform}-${id}`,
    channelName: `${platform}-clip`,
    clipUrl: `https://example.com/clip/${id}`,
    createdAt: "2026-09-11T00:00:00.000Z" as SerializedTimestamp,
    creatorName: "Creator",
    duration: 12,
    id,
    platform,
    thumbnailUrl: "",
    title: `${platform} clip ${id}`,
    viewCount: views,
  };
}

export function fixtureVideo(
  platform: Platform,
  id: string,
  views: number,
  publishedAt = "2026-09-11T00:00:00.000Z" as SerializedTimestamp,
): Video {
  return {
    channelAvatar: "",
    channelDisplayName: "VOD Channel",
    channelId: `${platform}-${id}`,
    channelName: `${platform}-vod`,
    duration: 3600,
    id,
    platform,
    publishedAt,
    thumbnailUrl: "",
    title: `${platform} video ${id}`,
    type: "archive",
    url: `https://example.com/video/${id}`,
    viewCount: views,
  };
}

export function fixtureOutcome(
  platform: Platform,
  mode: DiscoveryFixtureMode,
): PlatformReadOutcome<Stream> {
  if (mode === "loading") {
    return pending(platform);
  }
  if (mode === "cache-miss") {
    return failed(platform, "direct", "cache-miss", "none", { kind: "miss" });
  }
  if (mode === "cancelled") {
    return {
      cache: { kind: "miss" },
      error: { code: "cancelled", retry: "none" },
      items: [],
      path: { kind: "unavailable", platform, reason: "cancelled" },
      platform,
      status: "failed",
    };
  }
  if (mode === "auth-lost") {
    return {
      cache: { kind: "miss" },
      error: { code: "auth-lost", retry: "manual" },
      items: [],
      path: { kind: "unavailable", platform, reason: "auth-lost" },
      platform,
      status: "failed",
    };
  }
  if (mode === "relay-unavailable") {
    return failed(platform, "relay", "relay-unavailable", "manual", {
      kind: "miss",
    });
  }
  if (mode === "retry-exhausted") {
    return failed(platform, "relay", "retry-exhausted", "manual", {
      kind: "miss",
    });
  }
  if (mode === "stale-cache") {
    return {
      cache: { ageMilliseconds: 3_600_000, kind: "hit", stale: true },
      items: [fixtureStream(platform, `${platform}-stale`, 11)],
      path: { kind: "unavailable", platform, reason: "offline" },
      platform,
      status: "stale",
    };
  }
  if (
    (mode === "twitch-fail" && platform === "twitch") ||
    (mode === "kick-fail" && platform === "kick")
  ) {
    return failed(platform, "relay", `${platform}-failed`, "manual", {
      kind: "miss",
    });
  }
  return {
    cache: { kind: "miss" },
    items: [
      fixtureStream(
        platform,
        `${platform}-ready`,
        platform === "twitch" ? 90 : 40,
      ),
    ],
    path: { kind: "relay", platform },
    platform,
    status: "complete",
  };
}

function pending(platform: Platform): PlatformReadOutcome<Stream> {
  return {
    cache: { kind: "miss" },
    items: [],
    path: { kind: "relay", platform },
    platform,
    status: "partial",
  };
}

function failed(
  platform: Platform,
  pathKind: "direct" | "relay",
  code: string,
  retry: "none" | "manual",
  cache: PlatformReadOutcome<Stream>["cache"],
): PlatformReadOutcome<Stream> {
  return {
    cache,
    error: { code, retry },
    items: [],
    path: { kind: pathKind, platform },
    platform,
    status: "failed",
  };
}
