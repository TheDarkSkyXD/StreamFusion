import type { SearchIntent } from "@streamfusion/core/discovery";
import type { Category, Channel, Clip, Video } from "@streamfusion/core/content";
import type { Platform } from "@streamfusion/core/platform";

import type {
  DiscoveryFixtureMode,
  SearchCatalogPage,
  SearchReadOutcome,
} from "../capabilities/platform-reads";

import { fixtureStream } from "./discovery-fixture";
import { emptySearchCatalog } from "./search-catalog";

export function fixtureSearchIntent(query = "arcade"): SearchIntent {
  return {
    liveOnly: false,
    limits: { resultLimit: 20 },
    query,
    resultType: "all",
  };
}

export function fixtureChannel(platform: Platform, id: string): Channel {
  return {
    avatarUrl: "",
    displayName: platform === "twitch" ? "Twitch Live" : "Kick Live",
    id,
    isLive: true,
    isPartner: false,
    isVerified: false,
    platform,
    username: `${platform}-live`,
  };
}

export function fixtureCategory(platform: Platform, id: string): Category {
  return {
    boxArtUrl: "",
    id,
    name: platform === "twitch" ? "Just Chatting" : "Slots",
    platform,
  };
}

export function fixtureVideo(platform: Platform, id: string): Video {
  return {
    channelAvatar: "",
    channelDisplayName: platform === "twitch" ? "Twitch Live" : "Kick Live",
    channelId: `${platform}-channel`,
    channelName: `${platform}-live`,
    duration: 96,
    id,
    platform,
    publishedAt: "2026-09-11T00:00:00.000Z" as Video["publishedAt"],
    thumbnailUrl: "",
    title: `${platform} catalog proof video`,
    type: "archive",
    url: `https://example.com/${platform}/${id}`,
    viewCount: 12,
  };
}

export function fixtureClip(platform: Platform, id: string): Clip {
  return {
    channelAvatar: "",
    channelDisplayName: platform === "twitch" ? "Twitch Live" : "Kick Live",
    channelId: `${platform}-channel`,
    channelName: `${platform}-live`,
    clipUrl: `https://example.com/${platform}/clip/${id}`,
    createdAt: "2026-09-11T00:00:00.000Z" as Clip["createdAt"],
    creatorName: "Proof",
    duration: 32,
    id,
    platform,
    thumbnailUrl: "",
    title: `${platform} catalog proof clip`,
    viewCount: 8,
  };
}

export function fixtureSearchCatalog(
  platform: Platform,
): SearchCatalogPage {
  return {
    categories: [fixtureCategory(platform, `${platform}-cat`)],
    channels: [fixtureChannel(platform, `${platform}-channel`)],
    clips: [fixtureClip(platform, `${platform}-clip`)],
    streams: [fixtureStream(platform, `${platform}-ready`, platform === "twitch" ? 90 : 40)],
    videos: [fixtureVideo(platform, `${platform}-video`)],
  };
}

export function fixtureSearchOutcome(
  platform: Platform,
  mode: DiscoveryFixtureMode,
): SearchReadOutcome {
  if (mode === "loading") {
    return {
      cache: { kind: "miss" },
      catalog: emptySearchCatalog(),
      path: { kind: "relay", platform },
      platform,
      status: "partial",
    };
  }
  if (mode === "cache-miss") {
    return failedSearch(platform, "direct", "cache-miss", "none");
  }
  if (mode === "cancelled") {
    return {
      cache: { kind: "miss" },
      catalog: emptySearchCatalog(),
      error: { code: "cancelled", retry: "none" },
      path: { kind: "unavailable", platform, reason: "cancelled" },
      platform,
      status: "failed",
    };
  }
  if (mode === "auth-lost") {
    return {
      cache: { kind: "miss" },
      catalog: emptySearchCatalog(),
      error: { code: "auth-lost", retry: "manual" },
      path: { kind: "unavailable", platform, reason: "auth-lost" },
      platform,
      status: "failed",
    };
  }
  if (mode === "relay-unavailable") {
    return failedSearch(platform, "relay", "relay-unavailable", "manual");
  }
  if (mode === "retry-exhausted") {
    return failedSearch(platform, "relay", "retry-exhausted", "manual");
  }
  if (mode === "stale-cache") {
    return {
      cache: { ageMilliseconds: 3_600_000, kind: "hit", stale: true },
      catalog: fixtureSearchCatalog(platform),
      path: { kind: "unavailable", platform, reason: "offline" },
      platform,
      status: "stale",
    };
  }
  if (
    (mode === "twitch-fail" && platform === "twitch") ||
    (mode === "kick-fail" && platform === "kick")
  ) {
    return failedSearch(platform, "relay", `${platform}-failed`, "manual");
  }
  return {
    cache: { kind: "miss" },
    catalog: fixtureSearchCatalog(platform),
    path: { kind: "relay", platform },
    platform,
    status: "complete",
  };
}

function failedSearch(
  platform: Platform,
  pathKind: "direct" | "relay",
  code: string,
  retry: "none" | "manual",
): SearchReadOutcome {
  return {
    cache: { kind: "miss" },
    catalog: emptySearchCatalog(),
    error: { code, retry },
    path: { kind: pathKind, platform },
    platform,
    status: "failed",
  };
}
