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
};

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
}

export type WatchChatConnectInput = {
  readonly channelId: string;
  readonly channelName: string;
  readonly platform: Platform;
};

export const RECORDED_COMMENTS: WatchChatAvailability = {
  detail:
    "Recorded comments are not wired on this device. Twitch and Kick VOD comment APIs stay on desktop.",
  kind: "unavailable",
  reason: "recorded",
};
