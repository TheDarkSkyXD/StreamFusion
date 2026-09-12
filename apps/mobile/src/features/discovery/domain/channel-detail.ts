import type { Clip, Stream, Video } from "@streamfusion/core/content";
import type { Platform } from "@streamfusion/core/platform";

import type {
  ChannelDetailPhase,
  ChannelDetailView,
  ChannelMediaRead,
  ChannelPageOutcome,
  WatchAvailability,
} from "../capabilities/platform-reads";
import { guestFollowView } from "./channel-follow";

export const WATCH_UNAVAILABLE: WatchAvailability = {
  kind: "unavailable",
  reason: "Watch is not available yet.",
};

export function composeChannelDetail(input: {
  readonly clips?: ChannelMediaRead<Clip>;
  readonly loading: boolean;
  readonly page?: ChannelPageOutcome;
  readonly videos?: ChannelMediaRead<Video>;
}): ChannelDetailView {
  const page = input.page ?? emptyPage("twitch");
  const videos = input.videos ?? pendingMedia(page.platform, "videos");
  const clips = input.clips ?? pendingMedia(page.platform, "clips");
  return {
    channel: page.channel,
    clips,
    follow: guestFollowView(),
    live: page.live,
    page,
    phase: channelPhase({
      loading: input.loading,
      page,
    }),
    videos,
    watch: WATCH_UNAVAILABLE,
  };
}

export function unsupportedMedia(
  platform: Platform,
  media: "videos" | "clips",
): ChannelMediaRead<never> {
  return { kind: "unsupported", media, platform };
}

export function mediaItems<T>(lane: ChannelMediaRead<T>): readonly T[] {
  return lane.kind === "page" ? lane.outcome.items : [];
}

export function channelFromStream(stream: Stream): {
  readonly platform: Platform;
  readonly id: string;
  readonly username: string;
} {
  return {
    id: stream.channelId,
    platform: stream.platform,
    username: stream.channelName,
  };
}

function channelPhase(input: {
  readonly loading: boolean;
  readonly page: ChannelPageOutcome;
}): ChannelDetailPhase {
  if (input.loading && input.page.channel === null) return "loading";
  if (input.page.channel !== null) {
    if (
      input.page.status === "stale" ||
      (input.page.cache.kind === "hit" && input.page.cache.stale)
    ) {
      return "offline-cache";
    }
    return "ready";
  }
  if (input.page.cache.kind === "hit") return "offline-cache";
  if (input.page.status === "failed") return "failed";
  return "empty";
}

function emptyPage(platform: Platform): ChannelPageOutcome {
  return {
    cache: { kind: "miss" },
    channel: null,
    live: null,
    path: { kind: "unavailable", platform, reason: "cancelled" },
    platform,
    status: "failed",
  };
}

function pendingMedia<T>(
  platform: Platform,
  media: "videos" | "clips",
): ChannelMediaRead<T> {
  if (platform === "kick") {
    return unsupportedMedia(platform, media);
  }
  return {
    kind: "page",
    outcome: {
      cache: { kind: "miss" },
      items: [],
      path: { kind: "relay", platform },
      platform,
      status: "partial",
    },
  };
}
