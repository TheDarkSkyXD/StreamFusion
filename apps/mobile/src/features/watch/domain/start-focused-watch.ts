import type {
  PlaybackFiltering,
  PlaybackFilterRequest,
} from "@mobile/features/ad-blocking/capabilities/ad-blocking";
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
      readonly candidateIndex: number;
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
type ResolvedSource = Extract<
  LivePlaybackSourceResolution,
  { kind: "resolved" }
>;

type SourcePreparationInput = Pick<
  FocusedWatchStartInput,
  "filtering" | "playlistProxy" | "target"
>;

export async function prepareWatchSourceAttempts(
  input: SourcePreparationInput,
  resolved: ResolvedSource,
) {
  const filtering = await input.filtering?.effective(input.target.platform);
  const targetFiltering: PlaybackFilterRequest | undefined =
    filtering === undefined
      ? undefined
      : input.target.media
        ? { ...filtering, enabled: false, mode: "passthrough" }
        : input.target.platform === "twitch"
          ? { ...filtering, channelName: input.target.channelName }
          : filtering;
  const proxyPreferences = resolved.protection
    ? undefined
    : await input.playlistProxy?.snapshot();
  const attempts = resolved.protection
    ? [
        {
          requestHeaders: resolved.requestHeaders,
          sourceUri: resolved.sourceUri,
        },
      ]
    : playlistProxyPlaybackAttempts({
        direct: {
          requestHeaders: resolved.requestHeaders,
          sourceUri: resolved.sourceUri,
        },
        preferences:
          targetFiltering?.enabled === true &&
          targetFiltering.mode !== "passthrough"
            ? undefined
            : proxyPreferences,
        target: input.target,
      });
  return attempts.map((attempt) => {
    const isProxyAttempt = attempt.sourceUri !== resolved.sourceUri;
    const attemptFiltering =
      targetFiltering === undefined
        ? undefined
        : isProxyAttempt
          ? {
              enabled: false,
              mode: "passthrough" as const,
              platform: input.target.platform,
            }
          : targetFiltering;
    return {
      ...(attemptFiltering === undefined
        ? {}
        : { filtering: attemptFiltering }),
      requestHeaders: attempt.requestHeaders,
      sourceUri: attempt.sourceUri,
      ...(resolved.protection === undefined
        ? {}
        : { protection: resolved.protection }),
    };
  });
}

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
    return compatibilityDisabled(
      integration,
      input.target.platform,
      policy.reason,
    );
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
    return sourceUnavailable(
      integration,
      input.target.platform,
      resolved.failure,
    );
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
  const settings = input.playbackSettings?.snapshot();
  const attempts = await prepareWatchSourceAttempts(input, resolved);
  if (stale()) {
    controller.abort();
    return { kind: "cancelled" };
  }
  let lastDetail = "Native playback could not start.";
  for (const [candidateIndex, attempt] of attempts.entries()) {
    if (stale()) {
      controller.abort();
      return { kind: "cancelled" };
    }
    const sessionId = input.sessionIds.create();
    const started = await input.playback.start({
      ...attempt,
      ...(input.target.media === undefined && input.playback.recoverSource
        ? { sourceRecovery: "resolve-live-source" as const }
        : {}),
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
      sessionId,
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
      candidateIndex,
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
