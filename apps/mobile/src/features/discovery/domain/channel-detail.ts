import type { Clip, Stream, Video } from "@streamfusion/core/content";
import type { GuestFollow } from "@streamfusion/core/follows";
import type { ChannelIdentity, Platform } from "@streamfusion/core/platform";

import type {
  ChannelDetailPhase,
  ChannelDetailView,
  ChannelMediaRead,
  ChannelPageOutcome,
  FollowView,
  WatchAvailability,
} from "../capabilities/platform-reads";
import { composeGuestFollowView } from "./channel-follow";

export function composeChannelDetail(input: {
  readonly clips?: ChannelMediaRead<Clip>;
  readonly follow?: FollowView;
  readonly loading: boolean;
  readonly membership?: readonly GuestFollow[];
  readonly page?: ChannelPageOutcome;
  readonly videos?: ChannelMediaRead<Video>;
}): ChannelDetailView {
  const page = input.page ?? emptyPage("twitch");
  const videos = input.videos ?? pendingMedia(page.platform, "videos");
  const clips = input.clips ?? pendingMedia(page.platform, "clips");
  return {
    channel: page.channel,
    clips,
    follow:
      input.follow ??
      composeGuestFollowView({
        channel: channelIdentity(page),
        membership: input.membership ?? [],
        pending: false,
      }),
    live: page.live,
    page,
    phase: channelPhase({
      loading: input.loading,
      page,
    }),
    videos,
    watch: composeWatchAvailability(page),
  };
}

export function composeWatchAvailability(
  page: ChannelPageOutcome,
): WatchAvailability {
  const live = page.live;
  const stale =
    page.status === "stale" ||
    (page.cache.kind === "hit" && page.cache.stale);
  if (live && live.isLive && !stale) {
    return {
      kind: "available",
      target: {
        channelId: live.channelId,
        channelName: live.channelName,
        platform: live.platform,
      },
    };
  }
  if (live && live.isLive && stale) {
    return { kind: "unavailable", reason: "live-state-unverified" };
  }
  return { kind: "unavailable", reason: "channel-offline" };
}

export function watchAvailabilityCopy(watch: WatchAvailability): string {
  if (watch.kind === "available") return "Opens live Watch for this channel.";
  if (watch.reason === "live-state-unverified") {
    return "Live state is not verified. Refresh the channel.";
  }
  return "This channel is not live.";
}

function channelIdentity(page: ChannelPageOutcome): ChannelIdentity {
  return {
    id: page.channel?.id ?? "",
    platform: page.platform,
    username: page.channel?.username ?? "",
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
  if (platform === "kick" && media === "clips") {
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
