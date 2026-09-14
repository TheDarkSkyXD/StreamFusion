import { streamsMatchChannelIdentity } from "@streamfusion/core/platform";

import type {
  FocusedPlaybackPort,
  FocusedPlaybackProtection,
  FocusedPlaybackProtectionPort,
  FocusedWatchSession,
  FocusedWatchState,
  LivePlaybackSourceResolution,
  LivePlaybackSources,
  NativePlaybackEvent,
  PlaybackCompatibilityPolicy,
  PlaybackIntegration,
  PlaybackPhase,
  PlaybackSessionState,
  WatchPlaybackFailure,
  WatchSessionIdSource,
  WatchStartResult,
  WatchTarget,
} from "../capabilities/watch";

export function createFocusedWatchSession(input: {
  readonly playback: FocusedPlaybackPort;
  readonly policy: PlaybackCompatibilityPolicy;
  readonly protection: FocusedPlaybackProtectionPort;
  readonly sessionIds: WatchSessionIdSource;
  readonly sources: LivePlaybackSources;
}): FocusedWatchSession {
  const listeners = new Set<() => void>();
  let generation = 0;
  let current: CurrentSession | null = null;
  const notify = () => listeners.forEach((listener) => listener());
  const unsubscribeNative = input.playback.subscribe((event) => {
    applyNativeEvent(event);
  });
  const unsubscribeProtection = input.protection.subscribe(() => {
    if (current?.kind === "active") {
      current = { ...current, protection: input.protection.snapshot() };
      notify();
    }
  });

  function applyNativeEvent(event: NativePlaybackEvent): void {
    if (current?.kind !== "active" || current.session.sessionId !== event.sessionId) {
      return;
    }
    if (event.kind === "ended") {
      current.lease.release();
      current = {
        integration: current.integration,
        kind: "ended",
        sessionId: event.sessionId,
        target: current.target,
      };
      notify();
      return;
    }
    if (event.kind === "failed") {
      current.lease.release();
      current = {
        failure: {
          code: event.code,
          detail: event.detail,
          integration: current.integration,
          kind: "playback-failed",
          lastSuccessfulStage: "native-session-started",
          platform: current.target.platform,
          recovery: ["retry", "open-provider"],
        },
        kind: "failed",
        target: current.target,
      };
      notify();
      return;
    }
    current = { ...current, phase: phaseFrom(event) };
    notify();
  }

  async function abandon(sessionId: string): Promise<void> {
    const result = await input.playback.end(sessionId);
    if (result.kind === "unavailable") return;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot(target) {
      if (current && streamsMatchChannelIdentity(current.target, target)) {
        return toState(current);
      }
      return { kind: "ready", target };
    },
    async start(target): Promise<WatchStartResult> {
      const attempt = ++generation;
      const previous = current;
      current = { kind: "resolving", target };
      notify();
      if (previous?.kind === "active") {
        previous.lease.release();
        await abandon(previous.session.sessionId);
      }
      if (attempt !== generation) return { kind: "cancelled" };
      const integration: PlaybackIntegration =
        target.platform === "twitch" ? "twitch-gql-usher" : "kick-v1-playback-url";
      const controller = new AbortController();
      const policy = await input.policy.read(target.platform);
      if (attempt !== generation) {
        controller.abort();
        return { kind: "cancelled" };
      }
      if (policy.kind === "disabled") {
        const failed: WatchStartResult = {
          failure: {
            integration,
            kind: "compatibility-disabled",
            lastSuccessfulStage: "none",
            platform: target.platform,
            reason: policy.reason,
            recovery: ["refresh-policy", "open-provider"],
          },
          kind: "failed",
        };
        current = { failure: failed.failure, kind: "failed", target };
        notify();
        return failed;
      }
      const resolved = await resolveSource(input.sources, target, controller.signal);
      if (attempt !== generation) return { kind: "cancelled" };
      if (resolved.kind === "unavailable") {
        if (resolved.failure.kind === "cancelled") return { kind: "cancelled" };
        const failed: WatchStartResult = {
          failure: {
            code: resolved.failure.kind,
            detail: resolved.failure.detail,
            integration,
            kind: "source-unavailable",
            lastSuccessfulStage: "policy-authorized",
            platform: target.platform,
            recovery: ["retry", "open-provider"],
          },
          kind: "failed",
        };
        current = { failure: failed.failure, kind: "failed", target };
        notify();
        return failed;
      }
      const sessionId = input.sessionIds.create();
      const started = await input.playback.start({
        sessionId,
        sourceUri: resolved.sourceUri,
      });
      if (attempt !== generation) {
        void abandon(sessionId);
        return { kind: "cancelled" };
      }
      if (started.kind === "unavailable") {
        const failed: WatchStartResult = {
          failure: {
            detail: started.failure.detail,
            integration,
            kind: "native-unavailable",
            lastSuccessfulStage: "source-resolved",
            platform: target.platform,
            recovery: ["retry", "open-provider"],
          },
          kind: "failed",
        };
        current = { failure: failed.failure, kind: "failed", target };
        notify();
        return failed;
      }
      current = {
        integration,
        kind: "active",
        lease: input.protection.acquire(started.session.sessionId),
        phase: "buffering",
        policySequence: policy.sequence,
        protection: input.protection.snapshot(),
        session: started.session,
        target,
      };
      notify();
      return { kind: "started", session: started.session };
    },
    async leave(target) {
      if (!current || !streamsMatchChannelIdentity(current.target, target)) {
        return;
      }
      generation += 1;
      if (current.kind === "active") {
        const sessionId = current.session.sessionId;
        current.lease.release();
        current = { kind: "ready", target };
        notify();
        await abandon(sessionId);
        return;
      }
      current = { kind: "ready", target };
      notify();
    },
    async dispose() {
      generation += 1;
      unsubscribeNative();
      unsubscribeProtection();
      listeners.clear();
      if (current?.kind === "active") {
        current.lease.release();
        await abandon(current.session.sessionId);
      }
      current = null;
    },
  };
}

type CurrentSession =
  | { readonly kind: "ready"; readonly target: WatchTarget }
  | { readonly kind: "resolving"; readonly target: WatchTarget }
  | {
      readonly integration: PlaybackIntegration;
      readonly kind: "active";
      readonly lease: { release(): void };
      readonly phase: PlaybackPhase;
      readonly policySequence: number;
      readonly protection: FocusedPlaybackProtection;
      readonly session: PlaybackSessionState;
      readonly target: WatchTarget;
    }
  | {
      readonly integration: PlaybackIntegration;
      readonly kind: "ended";
      readonly sessionId: string;
      readonly target: WatchTarget;
    }
  | {
      readonly failure: WatchPlaybackFailure;
      readonly kind: "failed";
      readonly target: WatchTarget;
    };

function toState(current: CurrentSession): FocusedWatchState {
  if (current.kind === "active") {
    const { lease: _lease, ...state } = current;
    return state;
  }
  return current;
}

async function resolveSource(
  sources: LivePlaybackSources,
  target: WatchTarget,
  signal: AbortSignal,
): Promise<LivePlaybackSourceResolution> {
  if (target.platform === "kick") {
    return sources.kick.resolve({
      signal,
      target: { ...target, platform: "kick" },
    });
  }
  return sources.twitch.resolve({
    signal,
    target: { ...target, platform: "twitch" },
  });
}

function phaseFrom(event: NativePlaybackEvent): PlaybackPhase {
  if (event.kind === "paused") return "paused";
  if (event.kind === "playing") return "playing";
  return "buffering";
}
