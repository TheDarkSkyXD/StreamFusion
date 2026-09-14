import type {
  Channel,
  Stream,
} from "@streamfusion/core/content";
import type { Platform, StreamChannelIdentity } from "@streamfusion/core/platform";

export type WatchTarget = StreamChannelIdentity;

export type WatchTab = "chat" | "info" | "related";

export type WatchChatAvailability = {
  readonly detail: string;
  readonly kind: "not-connected";
};

export type WatchContextFailure =
  | { readonly kind: "cancelled" }
  | {
      readonly detail: string;
      readonly kind: "offline";
      readonly retry: "manual";
    }
  | {
      readonly detail: string;
      readonly kind: "provider-unavailable";
      readonly retry: "manual";
    };

export type WatchInfo =
  | {
      readonly channel: Channel;
      readonly kind: "live";
      readonly stream: Stream;
    }
  | {
      readonly channel: Channel;
      readonly kind: "ended";
    }
  | {
      readonly failure: WatchContextFailure;
      readonly kind: "unavailable";
    };

export type WatchRelated =
  | {
      readonly items: readonly Stream[];
      readonly kind: "ready";
    }
  | { readonly kind: "empty" }
  | {
      readonly failure: WatchContextFailure;
      readonly kind: "unavailable";
    };

export type WatchInspection = {
  readonly info: WatchInfo;
  readonly related: WatchRelated;
  readonly target: WatchTarget;
};

export interface WatchInspectionReader {
  read(input: {
    readonly signal: AbortSignal;
    readonly target: WatchTarget;
  }): Promise<WatchInspection>;
}

export const PLAYBACK_COMPATIBILITY_CAPABILITY = {
  kick: "compat.playback.kick-v1",
  twitch: "compat.playback.twitch-gql-usher",
} as const satisfies Readonly<Record<Platform, string>>;

export type PlaybackIntegration = "kick-v1-playback-url" | "twitch-gql-usher";

export type PlaybackCompatibilityDecision =
  | { readonly kind: "enabled"; readonly sequence: number }
  | {
      readonly kind: "disabled";
      readonly reason: "expired" | "no-valid-policy" | "not-allowed";
    };

export interface PlaybackCompatibilityPolicy {
  read(platform: Platform): Promise<PlaybackCompatibilityDecision>;
}

declare const hlsSourceUri: unique symbol;

export type HlsSourceUri = string & {
  readonly [hlsSourceUri]: "validated-https-hls";
};

export type LivePlaybackSourceFailure =
  | { readonly kind: "cancelled" }
  | { readonly detail: string; readonly kind: "offline" }
  | { readonly detail: string; readonly kind: "channel-offline" }
  | {
      readonly detail: string;
      readonly kind: "provider-rejected";
      readonly status: number;
    }
  | { readonly detail: string; readonly kind: "invalid-response" };

export type LivePlaybackSourceResolution =
  | {
      readonly integration: PlaybackIntegration;
      readonly kind: "resolved";
      readonly sourceUri: HlsSourceUri;
    }
  | {
      readonly failure: LivePlaybackSourceFailure;
      readonly integration: PlaybackIntegration;
      readonly kind: "unavailable";
    };

export interface LivePlaybackSourceResolver<
  TPlatform extends Platform = Platform,
> {
  readonly integration: PlaybackIntegration;
  readonly platform: TPlatform;
  resolve(input: {
    readonly signal: AbortSignal;
    readonly target: WatchTarget & { readonly platform: TPlatform };
  }): Promise<LivePlaybackSourceResolution>;
}

export type LivePlaybackSources = {
  readonly [TPlatform in Platform]: LivePlaybackSourceResolver<TPlatform>;
};

export type NativePlaybackFailureCode =
  | "PLAYBACK_DECODER_UNSUPPORTED"
  | "PLAYBACK_NETWORK_FAILED"
  | "PLAYBACK_SOURCE_REJECTED"
  | "PLAYBACK_UNKNOWN";

export type NativePlaybackEvent =
  | { readonly kind: "buffering"; readonly sessionId: string }
  | { readonly kind: "playing"; readonly sessionId: string }
  | {
      readonly kind: "paused";
      readonly reason: "background" | "user";
      readonly sessionId: string;
    }
  | { readonly kind: "ended"; readonly sessionId: string }
  | {
      readonly code: NativePlaybackFailureCode;
      readonly detail: string;
      readonly kind: "failed";
      readonly sessionId: string;
    };

export type PlaybackSessionState = {
  readonly pictureInPictureEligible: boolean;
  readonly sessionId: string;
};

export type FocusedPlaybackFailure = {
  readonly code:
    | "BINDING_UNAVAILABLE"
    | "CONTRACT_UNSUPPORTED"
    | "INVOCATION_FAILED"
    | "OPERATION_UNSUPPORTED"
    | "RESULT_INVALID";
  readonly detail: string;
};

export type FocusedPlaybackStartResult =
  | { readonly kind: "started"; readonly session: PlaybackSessionState }
  | { readonly failure: FocusedPlaybackFailure; readonly kind: "unavailable" };

export type FocusedPlaybackEndResult =
  | { readonly kind: "ended"; readonly sessionId: string }
  | { readonly kind: "missing"; readonly sessionId: string }
  | { readonly failure: FocusedPlaybackFailure; readonly kind: "unavailable" };

export interface FocusedPlaybackPort {
  end(sessionId: string): Promise<FocusedPlaybackEndResult>;
  start(input: {
    readonly sessionId: string;
    readonly sourceUri: HlsSourceUri;
  }): Promise<FocusedPlaybackStartResult>;
  subscribe(listener: (event: NativePlaybackEvent) => void): () => void;
}

export type FocusedPlaybackProtection =
  | { readonly kind: "normal" }
  | {
      readonly detail: string;
      readonly kind: "degraded";
      readonly recoveryCondition: string;
      readonly stage: 1 | 2 | 3 | 4 | 5;
    };

export interface FocusedPlaybackProtectionLease {
  release(): void;
}

export interface FocusedPlaybackProtectionPort {
  acquire(sessionId: string): FocusedPlaybackProtectionLease;
  snapshot(): FocusedPlaybackProtection;
  subscribe(listener: () => void): () => void;
}

export type PlaybackPhase = "buffering" | "paused" | "playing";

export type WatchRecovery = "open-provider" | "refresh-policy" | "retry";

export type WatchPlaybackFailure =
  | {
      readonly integration: PlaybackIntegration;
      readonly kind: "compatibility-disabled";
      readonly lastSuccessfulStage: "none";
      readonly platform: Platform;
      readonly reason: "expired" | "no-valid-policy" | "not-allowed";
      readonly recovery: readonly WatchRecovery[];
    }
  | {
      readonly code: Exclude<LivePlaybackSourceFailure["kind"], "cancelled">;
      readonly detail: string;
      readonly integration: PlaybackIntegration;
      readonly kind: "source-unavailable";
      readonly lastSuccessfulStage: "policy-authorized";
      readonly platform: Platform;
      readonly recovery: readonly WatchRecovery[];
    }
  | {
      readonly detail: string;
      readonly integration: PlaybackIntegration;
      readonly kind: "native-unavailable";
      readonly lastSuccessfulStage: "source-resolved";
      readonly platform: Platform;
      readonly recovery: readonly WatchRecovery[];
    }
  | {
      readonly code: NativePlaybackFailureCode;
      readonly detail: string;
      readonly integration: PlaybackIntegration;
      readonly kind: "playback-failed";
      readonly lastSuccessfulStage: "native-session-started";
      readonly platform: Platform;
      readonly recovery: readonly WatchRecovery[];
    };

export type FocusedWatchState =
  | { readonly kind: "ready"; readonly target: WatchTarget }
  | { readonly kind: "resolving"; readonly target: WatchTarget }
  | {
      readonly integration: PlaybackIntegration;
      readonly kind: "active";
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

export type WatchStartResult =
  | { readonly kind: "started"; readonly session: PlaybackSessionState }
  | { readonly kind: "cancelled" }
  | { readonly failure: WatchPlaybackFailure; readonly kind: "failed" };

export interface FocusedWatchSession {
  dispose(): Promise<void>;
  leave(target: WatchTarget): Promise<void>;
  snapshot(target: WatchTarget): FocusedWatchState;
  start(target: WatchTarget): Promise<WatchStartResult>;
  subscribe(listener: () => void): () => void;
}

export type WatchProviderFallbackResult =
  | { readonly kind: "opened" }
  | { readonly detail: string; readonly kind: "unavailable" };

export interface WatchProviderPagePort {
  open(target: WatchTarget): Promise<WatchProviderFallbackResult>;
}

export interface WatchSessionIdSource {
  create(): string;
}

export interface WatchRuntime {
  readonly inspection: WatchInspectionReader;
  readonly session: FocusedWatchSession;
}
