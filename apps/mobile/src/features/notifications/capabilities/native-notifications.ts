import type { ActivityItem } from "@streamfusion/core/activity";
import type { GuestFollow, LiveNotificationPreferences } from "@streamfusion/core/follows";
import type { SafeNotificationPayload } from "@streamfusion/core/relay";
import type { Platform } from "@streamfusion/core/platform";

import type { BackgroundLiveAlerts, ForegroundObservation, BackgroundStatus } from "./background-live-alerts";

export type NotificationOpenLocation =
  | { readonly kind: "watch"; readonly platform: Platform; readonly channelId: string; readonly channelLogin: string }
  | { readonly kind: "channel"; readonly platform: Platform; readonly id: string; readonly username: string }
  | { readonly kind: "activity"; readonly eventId: string }
  | { readonly kind: "job"; readonly jobId: string }
  | { readonly kind: "accounts" }
  | { readonly kind: "diagnostics" };

export type InAppNotificationBanner = {
  readonly eventId: string;
  readonly title: string;
  readonly body: string;
  readonly location: NotificationOpenLocation;
};

export type NativeNotificationSnapshot = {
  readonly status: BackgroundStatus | null;
  readonly copy: string;
};

export interface NativeNotificationChannels {
  ensure(): Promise<void>;
}

export interface NativeNotificationPolicy {
  apply(input: { readonly enabled: boolean; readonly sound: boolean }): Promise<void>;
}

export interface LocalNotificationPresenter {
  present(payload: SafeNotificationPayload, options?: { readonly silent?: boolean }): Promise<void>;
}

export interface NotificationReceiptSource {
  initial(): Promise<SafeNotificationPayload | null>;
  subscribe(listener: (input: {
    readonly payload: SafeNotificationPayload;
    readonly foreground: boolean;
  }) => void): () => void;
}

export interface NativeNotificationRuntime {
  bindOpen(handler: (location: NotificationOpenLocation) => void): void;
  dismissBanner(): void;
  load(): Promise<NativeNotificationSnapshot>;
  peek(): NativeNotificationSnapshot;
  peekBanner(): InAppNotificationBanner | null;
  presentProof(payload: SafeNotificationPayload): Promise<void>;
  subscribe(listener: () => void): () => void;
  sync(observations?: readonly ForegroundObservation[]): Promise<NativeNotificationSnapshot>;
}

export interface NativeNotificationDependencies {
  readonly activity: { record(item: ActivityItem): Promise<void> };
  readonly background: BackgroundLiveAlerts;
  readonly channels: NativeNotificationChannels;
  readonly follows: {
    listMembership(): Promise<readonly GuestFollow[]>;
    listGuestMembership(): Promise<readonly GuestFollow[]>;
    readNotifications(): Promise<LiveNotificationPreferences>;
  };
  readonly postingPolicy: NativeNotificationPolicy;
  readonly presenter: LocalNotificationPresenter;
  readonly receipts: NotificationReceiptSource;
}
