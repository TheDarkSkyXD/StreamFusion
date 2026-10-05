import type { Platform } from "@streamfusion/core/platform";

export type WatchChatBadge = {
  readonly setId: string;
  readonly version: string;
  readonly imageUrl: string;
  readonly title: string;
};

export type WatchChatMessage = {
  readonly displayName: string;
  readonly id: string;
  readonly text: string;
  readonly badges: readonly WatchChatBadge[];
  /** Platform name color (`#rrggbb`) from IRC `color` / Kick `identity.color`. */
  readonly color?: string;
  /** Login/slug for deterministic uncolored fallback hashing. */
  readonly username?: string;
  readonly userId?: string;
  readonly parts?: readonly WatchChatMessagePart[];
  readonly offsetSeconds?: number;
};

export type WatchChatMessagePart =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "emote";
      readonly text: string;
      readonly imageUrl: string;
    };

export interface ChatReplayReader {
  read(
    target: WatchChatConnectInput,
    offsetSeconds: number,
    cursor: string | null,
    signal: AbortSignal,
  ): Promise<
    | {
        readonly kind: "page";
        readonly messages: readonly WatchChatMessage[];
        readonly cursor: string | null;
      }
    | { readonly kind: "unavailable"; readonly detail: string }
  >;
}

export type WatchChatAvailability =
  | {
      readonly detail: string;
      readonly kind: "connecting";
    }
  | {
      readonly detail: string;
      readonly kind: "empty";
    }
  | {
      readonly detail: string;
      readonly kind: "live";
      readonly messages: readonly WatchChatMessage[];
    }
  | {
      readonly detail: string;
      readonly kind: "failed";
      readonly retry: "manual";
    }
  | {
      readonly detail: string;
      readonly kind: "unavailable";
      readonly reason: "recorded" | "platform";
    };

export type WatchChatSocket = {
  readonly close: () => void;
  readonly send: (data: string) => void;
  onclose: ((event: { readonly code: number }) => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { readonly data: string }) => void) | null;
  onopen: (() => void) | null;
};

export type WatchChatSocketFactory = (url: string) => WatchChatSocket;

export interface WatchChatSession {
  attach(target: WatchChatConnectInput): void;
  dispose(): void;
  retry(): void;
  snapshot(): WatchChatAvailability;
  subscribe(listener: () => void): () => void;
  syncPlayback?(positionMs: number): void;
  seekPlayback?(positionMs: number): void;
}

export type WatchChatConnectInput = {
  readonly channelId: string;
  readonly channelName: string;
  readonly platform: Platform;
  readonly media?: {
    readonly id: string;
    readonly kind: "video" | "clip";
    readonly resumePositionSeconds?: number;
  };
};

export const RECORDED_COMMENTS: WatchChatAvailability = {
  detail: "Recorded comments are unavailable for this media.",
  kind: "unavailable",
  reason: "recorded",
};
