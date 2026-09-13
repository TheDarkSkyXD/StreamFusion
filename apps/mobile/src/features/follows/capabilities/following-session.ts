import type { Category, Channel, Clip, Stream, Video } from "@streamfusion/core/content";
import type { GuestFollow, LiveNotificationPreferences } from "@streamfusion/core/follows";
import type { Platform } from "@streamfusion/core/platform";
import type {
  FollowedClipPeriod,
  FollowedIdentityRef,
  FollowedRecordedSort,
} from "@streamfusion/core/relay";

export type FollowingTab =
  | "live"
  | "videos"
  | "clips"
  | "categories"
  | "channels";
export type FollowingChip = "all" | "live" | "twitch" | "kick";
export type EmptyReason = "no-membership" | "none-live" | "no-matches";

export type TabItems<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "empty"; readonly reason: EmptyReason }
  | { readonly kind: "ready"; readonly items: readonly T[]; readonly stale: boolean }
  | {
      readonly kind: "partial";
      readonly items: readonly T[];
      readonly failedPlatforms: readonly Platform[];
      readonly stale: boolean;
    }
  | {
      readonly kind: "failed";
      readonly items: readonly T[];
      readonly retryablePlatforms: readonly Platform[];
      readonly offline: boolean;
    }
  | { readonly kind: "unsupported"; readonly reason: string; readonly items: readonly T[] };

export type FollowedReadOutcome<T> = {
  readonly platform: Platform;
  readonly status: "complete" | "partial" | "failed" | "stale";
  readonly items: readonly T[];
  readonly missing: readonly FollowedIdentityRef[];
  readonly stale: boolean;
  readonly offline: boolean;
  readonly retryable: boolean;
  readonly error?: string;
};

export type FollowedRecordedOutcome<T> = {
  readonly platform: Platform;
  readonly channelId: string;
  readonly supported: boolean;
  readonly items: readonly T[];
  readonly stale: boolean;
  readonly offline: boolean;
  readonly failed: boolean;
  readonly error?: string;
};

export type FollowingChannelRow = {
  readonly follow: GuestFollow;
  readonly isLive: boolean;
  readonly origin: { readonly kind: "guest" };
  readonly imported: { readonly kind: "none" };
  readonly eligible: boolean;
  readonly notify: boolean;
  readonly platform: Platform;
  readonly stream: Stream | null;
};

export type FollowingView = {
  readonly origin: { readonly kind: "guest" };
  readonly accountImport: { readonly kind: "disabled"; readonly reason: "guest-only-scope" };
  readonly systemPush: { readonly kind: "stubbed"; readonly reason: "system-push-not-shipped" };
  readonly membership: readonly GuestFollow[];
  readonly tab: FollowingTab;
  readonly chip: FollowingChip;
  readonly query: string;
  readonly live: TabItems<Stream>;
  readonly videos: TabItems<Video>;
  readonly clips: TabItems<Clip>;
  readonly categories: TabItems<Category>;
  readonly channels: TabItems<FollowingChannelRow>;
  readonly notifications: LiveNotificationPreferences;
};

export type FollowMutationResult =
  | { readonly kind: "followed"; readonly follow: GuestFollow }
  | { readonly kind: "unfollowed"; readonly platform: Platform; readonly channelId: string }
  | {
      readonly kind: "rejected";
      readonly reason: "guest-only-scope" | "unresolved-channel" | "invalid";
    };

export interface FollowedContentReader {
  readStreams(input: {
    readonly platform: Platform;
    readonly refs: readonly FollowedIdentityRef[];
    readonly signal?: AbortSignal;
  }): Promise<FollowedReadOutcome<Stream>>;
  readChannels(input: {
    readonly platform: Platform;
    readonly refs: readonly FollowedIdentityRef[];
    readonly signal?: AbortSignal;
  }): Promise<FollowedReadOutcome<Channel>>;
  readVideos(input: {
    readonly platform: Platform;
    readonly channelId: string;
    readonly sort: FollowedRecordedSort;
    readonly signal?: AbortSignal;
  }): Promise<FollowedRecordedOutcome<Video>>;
  readClips(input: {
    readonly platform: Platform;
    readonly channelId: string;
    readonly period: FollowedClipPeriod;
    readonly sort: FollowedRecordedSort;
    readonly signal?: AbortSignal;
  }): Promise<FollowedRecordedOutcome<Clip>>;
}

export interface ProviderPageOpener {
  open(input: {
    readonly platform: Platform;
    readonly channelLogin: string;
  }): Promise<void>;
}

export interface FollowingSession {
  listMembership(): Promise<readonly GuestFollow[]>;
  mutateFollow(input: {
    readonly platform: Platform;
    readonly channelId?: string;
    readonly channelLogin?: string;
  }): Promise<FollowMutationResult>;
  resolveChannel(input: {
    readonly platform: Platform;
    readonly channelLogin: string;
    readonly signal?: AbortSignal;
  }): Promise<Channel | null>;
  hydrateLive(input?: {
    readonly signal?: AbortSignal;
  }): Promise<Readonly<Record<Platform, FollowedReadOutcome<Stream>>>>;
  hydrateRecorded(input: {
    readonly kind: "videos" | "clips";
    readonly platform: Platform;
    readonly channelId: string;
    readonly sort: FollowedRecordedSort;
    readonly period?: FollowedClipPeriod;
    readonly signal?: AbortSignal;
  }): Promise<FollowedRecordedOutcome<Video> | FollowedRecordedOutcome<Clip>>;
  readNotifications(): Promise<LiveNotificationPreferences>;
  writeNotifications(value: unknown): Promise<LiveNotificationPreferences>;
  openProviderPage(input: {
    readonly platform: Platform;
    readonly channelLogin: string;
  }): Promise<void>;
}
