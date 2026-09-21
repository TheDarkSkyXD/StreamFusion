import type { PlaybackFiltering } from "@mobile/features/ad-blocking/capabilities/ad-blocking";
import type { TwitchPlaylistProxyPreferences } from "@mobile/features/ad-blocking/capabilities/twitch-playlist-proxy";
import type { PlaybackSessionPolicy } from "@mobile/features/settings/capabilities/settings";
import type {
  FocusedPlaybackPort,
  FocusedPlaybackProtectionPort,
  LivePlaybackSourceFailure,
  LivePlaybackSourceResolution,
  LivePlaybackSources,
  PlaybackCompatibilityPolicy,
  PlaybackIntegration,
  PlaybackSessionState,
  RecordedPlaybackSources,
  WatchPlaybackFailure,
  WatchSessionIdSource,
  WatchStartResult,
  WatchTarget,
} from "../capabilities/watch";
import { playlistProxyPlaybackAttempts } from "./twitch-playlist-proxy-routing";
import { integrationFor, resolveWatchSource } from "./watch-source-resolution";

export type FocusedWatchStartOutcome =
  | { readonly kind: "cancelled" }
  | {
      readonly kind: "failed";
      readonly failure: WatchPlaybackFailure;
    }
  | {
      readonly integration: PlaybackIntegration;
      readonly kind: "started";
      readonly lease: { release(): void };
      readonly policySequence: number;
      readonly session: PlaybackSessionState;
    };

type FocusedWatchStartInput = {
  readonly attempt: number;
  readonly filtering?: PlaybackFiltering;
  readonly generation: () => number;
  readonly playback: FocusedPlaybackPort;
  readonly playbackSettings?: { snapshot(): PlaybackSessionPolicy };
  readonly playlistProxy?: {
    snapshot(): Promise<TwitchPlaylistProxyPreferences>;
  };
  readonly policy: PlaybackCompatibilityPolicy;
  readonly protection: FocusedPlaybackProtectionPort;
  readonly recorded?: RecordedPlaybackSources;
  readonly sessionIds: WatchSessionIdSource;
  readonly sources: LivePlaybackSources;
  readonly target: WatchTarget;
};

type SourceFailure = Exclude<LivePlaybackSourceFailure, { kind: "cancelled" }>;
type ResolvedSource = Extract<LivePlaybackSourceResolution, { kind: "resolved" }>;

export async function runFocusedWatchStart(
  input: FocusedWatchStartInput,
): Promise<FocusedWatchStartOutcome> {
  const integration = integrationFor(input.target);
  const controller = new AbortController();
  const stale = () => input.attempt !== input.generation();
  const policy = await input.policy.read(input.target.platform);
  if (stale()) {
    controller.abort();
    return { kind: "cancelled" };
  }
  if (policy.kind === "disabled") {
    return compatibilityDisabled(integration, input.target.platform, policy.reason);
  }
  const resolved = await resolveWatchSource(
    input.sources,
    input.recorded,
    input.target,
    controller.signal,
  );
  if (stale()) return { kind: "cancelled" };
  if (resolved.kind === "unavailable") {
    if (resolved.failure.kind === "cancelled") return { kind: "cancelled" };
    return sourceUnavailable(integration, input.target.platform, resolved.failure);
  }
  return startAuthorizedSession(
    input,
    integration,
    resolved,
    controller,
    stale,
    policy.sequence,
  );
}

export function startResultFrom(
  outcome: FocusedWatchStartOutcome,
): WatchStartResult {
  if (outcome.kind === "cancelled") return { kind: "cancelled" };
  if (outcome.kind === "failed") {
    return { failure: outcome.failure, kind: "failed" };
  }
  return { kind: "started", session: outcome.session };
}

async function startAuthorizedSession(
  input: FocusedWatchStartInput,
  integration: PlaybackIntegration,
  resolved: ResolvedSource,
  controller: AbortController,
  stale: () => boolean,
  policySequence: number,
): Promise<FocusedWatchStartOutcome> {
  const filtering =
    input.filtering === undefined
      ? undefined
      : await input.filtering.effective(input.target.platform);
  if (stale()) {
    controller.abort();
    return { kind: "cancelled" };
  }
  const settings = input.playbackSettings?.snapshot();
  const proxyPreferences =
    input.playlistProxy === undefined
      ? undefined
      : await input.playlistProxy.snapshot();
  if (stale()) {
    controller.abort();
    return { kind: "cancelled" };
  }
  const attempts = playlistProxyPlaybackAttempts({
    direct: {
      requestHeaders: resolved.requestHeaders,
      sourceUri: resolved.sourceUri,
    },
    preferences: proxyPreferences,
    target: input.target,
  });
  let lastDetail = "Native playback could not start.";
  for (const attempt of attempts) {
    if (stale()) {
      controller.abort();
      return { kind: "cancelled" };
    }
    const sessionId = input.sessionIds.create();
    const started = await input.playback.start({
      ...(filtering === undefined ? {} : { filtering }),
      ...(settings === undefined
        ? {}
        : {
            allowHevc: settings.allowHevc,
            buffer: {
              liveSyncDurationCount: settings.liveSyncDurationCount,
              lowLatencyMode: settings.lowLatencyMode,
              maxBufferLengthSec: settings.forwardBufferSec,
              maxMaxBufferLengthSec: settings.maxBufferSec,
            },
          }),
      requestHeaders: attempt.requestHeaders,
      sessionId,
      sourceUri: attempt.sourceUri,
    });
    if (stale()) {
      void input.playback.end(sessionId);
      return { kind: "cancelled" };
    }
    if (started.kind === "unavailable") {
      lastDetail = started.failure.detail;
      continue;
    }
    if (settings && settings.quality !== "auto") {
      await input.playback.setQuality(sessionId, settings.quality);
    }
    return {
      integration,
      kind: "started",
      lease: input.protection.acquire(started.session.sessionId),
      policySequence,
      session: started.session,
    };
  }
  return nativeUnavailable(integration, input.target.platform, lastDetail);
}

function compatibilityDisabled(
  integration: PlaybackIntegration,
  platform: WatchTarget["platform"],
  reason: "expired" | "no-valid-policy" | "not-allowed",
): FocusedWatchStartOutcome {
  return {
    failure: {
      integration,
      kind: "compatibility-disabled",
      lastSuccessfulStage: "none",
      platform,
      reason,
      recovery: ["refresh-policy", "open-provider"],
    },
    kind: "failed",
  };
}

function sourceUnavailable(
  integration: PlaybackIntegration,
  platform: WatchTarget["platform"],
  failure: SourceFailure,
): FocusedWatchStartOutcome {
  return {
    failure: {
      code: failure.kind,
      detail: failure.detail,
      integration,
      kind: "source-unavailable",
      lastSuccessfulStage: "policy-authorized",
      platform,
      recovery: ["retry", "open-provider"],
    },
    kind: "failed",
  };
}

function nativeUnavailable(
  integration: PlaybackIntegration,
  platform: WatchTarget["platform"],
  detail: string,
): FocusedWatchStartOutcome {
  return {
    failure: {
      detail,
      integration,
      kind: "native-unavailable",
      lastSuccessfulStage: "source-resolved",
      platform,
      recovery: ["retry", "open-provider"],
    },
    kind: "failed",
  };
}
