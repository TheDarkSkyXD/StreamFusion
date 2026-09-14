import type { Platform } from "@streamfusion/core/platform";

export type AppLinkIntent =
  | { readonly kind: "activity-item"; readonly eventId: string }
  | {
      readonly kind: "watch-channel";
      readonly platform: Platform;
      readonly channelId: string;
      readonly channelLogin: string;
      readonly media?: {
        readonly durationSeconds: number;
        readonly id: string;
        readonly kind: "clip" | "video";
        readonly title: string;
      };
    };

export interface AppLinkSource {
  initialIntent(): Promise<AppLinkIntent | null>;
  subscribe(listener: (intent: AppLinkIntent) => void): () => void;
}
