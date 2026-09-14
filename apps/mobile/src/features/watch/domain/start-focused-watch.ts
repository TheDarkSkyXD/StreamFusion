import type {
  FocusedPlaybackPort,
  FocusedPlaybackProtectionPort,
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

export async function runFocusedWatchStart(input: {
  readonly attempt: number;
  readonly generation: () => number;
  readonly playback: FocusedPlaybackPort;
  readonly policy: PlaybackCompatibilityPolicy;
  readonly protection: FocusedPlaybackProtectionPort;
  readonly recorded?: RecordedPlaybackSources;
  readonly sessionIds: WatchSessionIdSource;
  readonly sources: LivePlaybackSources;
  readonly target: WatchTarget;
}): Promise<FocusedWatchStartOutcome> {
  const integration = integrationFor(input.target);
  const controller = new AbortController();
  const stale = () => input.attempt !== input.generation();
  const policy = await input.policy.read(input.target.platform);
  if (stale()) {
    controller.abort();
    return { kind: "cancelled" };
  }
  if (policy.kind === "disabled") {
    return {
      failure: {
        integration,
        kind: "compatibility-disabled",
        lastSuccessfulStage: "none",
        platform: input.target.platform,
        reason: policy.reason,
        recovery: ["refresh-policy", "open-provider"],
      },
      kind: "failed",
    };
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
    return {
      failure: {
        code: resolved.failure.kind,
        detail: resolved.failure.detail,
        integration,
        kind: "source-unavailable",
        lastSuccessfulStage: "policy-authorized",
        platform: input.target.platform,
        recovery: ["retry", "open-provider"],
      },
      kind: "failed",
    };
  }
  const sessionId = input.sessionIds.create();
  const started = await input.playback.start({
    requestHeaders: resolved.requestHeaders,
    sessionId,
    sourceUri: resolved.sourceUri,
  });
  if (stale()) {
    void input.playback.end(sessionId);
    return { kind: "cancelled" };
  }
  if (started.kind === "unavailable") {
    return {
      failure: {
        detail: started.failure.detail,
        integration,
        kind: "native-unavailable",
        lastSuccessfulStage: "source-resolved",
        platform: input.target.platform,
        recovery: ["retry", "open-provider"],
      },
      kind: "failed",
    };
  }
  return {
    integration,
    kind: "started",
    lease: input.protection.acquire(started.session.sessionId),
    policySequence: policy.sequence,
    session: started.session,
  };
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
