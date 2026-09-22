import type { ActivityItem } from "@streamfusion/core/activity";
import type {
  LiveNotificationProjection,
  NativePushRegistrationGrant,
  SafeNotificationPayload,
} from "@streamfusion/core/relay";
import type { Platform } from "@streamfusion/core/platform";
import type { GuestFollow, LiveNotificationPreferences } from "@streamfusion/core/follows";

export type NativeRegistrationState =
  | "idle"
  | "pending"
  | "registered"
  | "unavailable"
  | "denied";

export type NativeRegistrationSnapshot = {
  readonly state: NativeRegistrationState;
  readonly fingerprint: string | null;
  readonly topicSubscriptions: number;
  readonly overflowPairs: number;
  readonly lastFailure: string | null;
  readonly copy: string;
};

export type NotificationOpenLocation =
  | {
      readonly kind: "watch";
      readonly platform: Platform;
      readonly channelId: string;
      readonly channelLogin: string;
    }
  | {
      readonly kind: "channel";
      readonly platform: Platform;
      readonly id: string;
      readonly username: string;
    }
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

export interface NativePushTransport {
  disable(): Promise<boolean>;
  register(input: {
    readonly nativeToken: string;
    readonly projection: LiveNotificationProjection;
    readonly remoteDeliveryEnabled: boolean;
  }): Promise<NativePushRegistrationGrant | null>;
}

export interface NativeNotificationChannels {
  ensure(): Promise<void>;
}

export interface NativePushTokenSource {
  read(): Promise<string | null>;
  subscribe(listener: (token: string) => void): () => void;
}

export interface LocalNotificationPresenter {
  present(
    payload: SafeNotificationPayload,
    options?: { readonly silent?: boolean },
  ): Promise<void>;
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
  load(): Promise<NativeRegistrationSnapshot>;
  peek(): NativeRegistrationSnapshot;
  peekBanner(): InAppNotificationBanner | null;
  presentProof(payload: SafeNotificationPayload): Promise<void>;
  subscribe(listener: () => void): () => void;
  sync(): Promise<NativeRegistrationSnapshot>;
}

export interface NativeNotificationDependencies {
  readonly activity: {
    record(item: ActivityItem): Promise<void>;
  };
  readonly channels: NativeNotificationChannels;
  readonly follows: {
    listMembership(): Promise<readonly GuestFollow[]>;
    readNotifications(): Promise<LiveNotificationPreferences>;
  };
  readonly identityReady: () => Promise<boolean>;
  readonly permission: () => Promise<"granted" | "denied" | "unavailable">;
  readonly presenter: LocalNotificationPresenter;
  readonly receipts: NotificationReceiptSource;
  readonly tokens: NativePushTokenSource;
  readonly transport: NativePushTransport;
}
