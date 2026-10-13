import type { Platform } from "@streamfusion/core/platform";
import type { SafeNotificationPayload } from "@streamfusion/core/relay";

export type BackgroundObservation = {
  readonly platform: Platform;
  readonly channelId: string;
  readonly observedAtMs: number;
} & (
  | { readonly kind: "offline" }
  | { readonly kind: "live"; readonly streamId: string; readonly title: string }
);

export type ForegroundObservation = BackgroundObservation & (
  | { readonly kind: "offline" }
  | { readonly kind: "live"; readonly channelLogin: string }
);

export type BackgroundSnapshot = {
  readonly schemaVersion: 1;
  readonly channels: readonly {
    readonly platform: Platform;
    readonly channelId: string;
    readonly channelLogin: string;
    readonly displayName: string;
  }[];
  readonly policy: {
    readonly historyEnabled: boolean;
    readonly systemAlerts: boolean;
    readonly toastAlerts: boolean;
    readonly sound: boolean;
    readonly restartGraceMinutes: 0 | 5 | 15 | 30;
  };
  readonly observations: readonly BackgroundObservation[];
};

export type BackgroundStatus = {
  readonly schemaVersion: 1;
  readonly scheduled: boolean;
  readonly intervalMinutes: 15;
  readonly channelCount: number;
  readonly lastCheckedAtMs: number | null;
  readonly failure: null | "provider-unavailable" | "inbox-full" | "storage-unavailable";
};

export interface BackgroundLiveAlerts {
  configure(snapshot: BackgroundSnapshot): Promise<BackgroundStatus>;
  status(): Promise<BackgroundStatus>;
  pending(): Promise<readonly SafeNotificationPayload[]>;
  acknowledge(eventIds: readonly string[]): Promise<void>;
}
