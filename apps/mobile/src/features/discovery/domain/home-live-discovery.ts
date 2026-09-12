import {
  settleDiscoveryProviders,
  type DiscoveryProviderOutcome,
} from "@streamfusion/core/discovery";
import type { Stream } from "@streamfusion/core/content";
import { PLATFORMS, type Platform } from "@streamfusion/core/platform";

import type {
  HomeLiveDiscoveryPhase,
  HomeLiveDiscoveryView,
  PlatformReadOutcome,
} from "../capabilities/platform-reads";

const emptyOutcome = (
  platform: Platform,
): PlatformReadOutcome<Stream> => ({
  cache: { kind: "miss" },
  items: [],
  path: { kind: "unavailable", platform, reason: "cancelled" },
  platform,
  status: "failed",
});

export function composeHomeLiveDiscovery(input: {
  readonly kick?: PlatformReadOutcome<Stream>;
  readonly loading: boolean;
  readonly twitch?: PlatformReadOutcome<Stream>;
}): HomeLiveDiscoveryView {
  const twitch = input.twitch ?? emptyOutcome("twitch");
  const kick = input.kick ?? emptyOutcome("kick");
  const providers = { kick, twitch };
  const outcomes: DiscoveryProviderOutcome<Stream>[] = [twitch, kick].map(
    (outcome) => ({
      data: outcome.items,
      platform: outcome.platform,
      status: outcome.status,
      ...(outcome.cursor === undefined ? {} : { cursor: outcome.cursor }),
      ...(outcome.error === undefined ? {} : { error: outcome.error.code }),
    }),
  );
  const settled = settleDiscoveryProviders({
    compare: compareLiveStreams,
    outcomes,
    requestedPlatforms: PLATFORMS,
  });
  const streams = settled.success ? settled.data : [];
  return {
    phase: homePhase({
      kick,
      loading: input.loading,
      streams,
      twitch,
    }),
    providers,
    retryablePlatforms: retryablePlatforms(providers),
    streams,
  };
}

function homePhase(input: {
  readonly kick: PlatformReadOutcome<Stream>;
  readonly loading: boolean;
  readonly streams: readonly Stream[];
  readonly twitch: PlatformReadOutcome<Stream>;
}): HomeLiveDiscoveryPhase {
  if (input.loading && input.streams.length === 0) return "loading";
  const usable = [input.twitch, input.kick].filter(
    (outcome) => outcome.status !== "failed",
  );
  if (usable.length === 0) {
    return [input.twitch, input.kick].some(
      (outcome) => outcome.cache.kind === "hit",
    )
      ? "offline-cache"
      : "failed";
  }
  if (input.streams.length === 0) return "empty";
  if (
    [input.twitch, input.kick].some(
      (outcome) =>
        outcome.status === "stale" ||
        (outcome.cache.kind === "hit" && outcome.cache.stale),
    )
  ) {
    return "offline-cache";
  }
  return "ready";
}

function retryablePlatforms(providers: {
  readonly kick: PlatformReadOutcome<Stream>;
  readonly twitch: PlatformReadOutcome<Stream>;
}): readonly Platform[] {
  return PLATFORMS.filter((platform) => {
    const outcome = providers[platform];
    if (outcome.error?.retry === "none") return false;
    return (
      outcome.error?.retry === "manual" ||
      outcome.error?.retry === "after" ||
      outcome.status === "failed" ||
      outcome.status === "partial"
    );
  });
}

function compareLiveStreams(left: Stream, right: Stream): number {
  return right.viewerCount - left.viewerCount;
}
