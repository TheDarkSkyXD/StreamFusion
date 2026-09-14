import type {
  Category,
  Channel,
  Clip,
  Stream,
  Video,
} from "@streamfusion/core/content";
import type {
  ClipTimeRange,
  DiscoveryProviderStatus,
  SearchIntent,
} from "@streamfusion/core/discovery";
import type { ChannelIdentity, Platform } from "@streamfusion/core/platform";

export type UserTokenRead =
  | { readonly kind: "none" }
  | { readonly kind: "ready"; readonly accessToken: string }
  | { readonly kind: "auth-lost" };

export type InstallationIdentityRead =
  | { readonly kind: "none" }
  | { readonly kind: "ready"; readonly credential: string };

export type NetworkRead = "online" | "offline";

export type PlatformReadPath =
  | { readonly kind: "direct"; readonly platform: Platform }
  | { readonly kind: "relay"; readonly platform: Platform }
  | { readonly kind: "guest"; readonly platform: Platform }
  | {
      readonly kind: "unavailable";
      readonly platform: Platform;
      readonly reason:
        | "relay-unavailable"
        | "auth-lost"
        | "signed-out-login-required"
        | "guest-unavailable"
        | "offline"
        | "cancelled";
    };

export type CacheProjection =
  | { readonly kind: "miss" }
  | {
      readonly kind: "hit";
      readonly stale: boolean;
      readonly ageMilliseconds: number;
    };

export type PlatformReadRetry = "none" | "manual" | "after";

export type PlatformReadOutcome<T> = {
  readonly platform: Platform;
  readonly path: PlatformReadPath;
  readonly status: DiscoveryProviderStatus;
  readonly items: readonly T[];
  readonly cursor?: string;
  readonly cache: CacheProjection;
  readonly error?: { readonly code: string; readonly retry: PlatformReadRetry };
};

export type HomeLiveDiscoveryPhase =
  | "loading"
  | "ready"
  | "offline-cache"
  | "empty"
  | "failed";

export type HomeLiveDiscoveryView = {
  readonly streams: readonly Stream[];
  readonly providers: Readonly<Record<Platform, PlatformReadOutcome<Stream>>>;
  readonly phase: HomeLiveDiscoveryPhase;
  readonly retryablePlatforms: readonly Platform[];
};

export type DiscoveryPageKind = "top-streams" | "categories" | "search";

export type SearchHistoryScope = "channels" | "streams" | "categories";

export type SearchHistoryByScope = Readonly<
  Record<SearchHistoryScope, readonly string[]>
>;

export type SearchCatalogPage = {
  readonly streams: readonly Stream[];
  readonly channels: readonly Channel[];
  readonly categories: readonly Category[];
  readonly videos: readonly Video[];
  readonly clips: readonly Clip[];
};

export type SearchReadOutcome = {
  readonly platform: Platform;
  readonly path: PlatformReadPath;
  readonly status: DiscoveryProviderStatus;
  readonly catalog: SearchCatalogPage;
  readonly cache: CacheProjection;
  readonly error?: { readonly code: string; readonly retry: PlatformReadRetry };
};

export type UnifiedSearchPhase =
  | "idle"
  | "loading"
  | "ready"
  | "empty"
  | "partial"
  | "offline-cache"
  | "failed";

export type UnifiedSearchView = {
  readonly phase: UnifiedSearchPhase;
  readonly intent: SearchIntent | null;
  readonly collection: SearchCatalogPage;
  readonly bestMatch: Channel | null;
  readonly providers: Readonly<Record<Platform, SearchReadOutcome>>;
  readonly retryablePlatforms: readonly Platform[];
  readonly history: SearchHistoryByScope;
  readonly historyConfirmClear: boolean;
};

export interface PlatformCatalogReader {
  readonly platform: Platform;
  getTopStreams(input?: {
    readonly language?: string;
    readonly signal?: AbortSignal;
  }): Promise<PlatformReadOutcome<Stream>>;
  getCategories(input?: {
    readonly signal?: AbortSignal;
  }): Promise<PlatformReadOutcome<Category>>;
  search(input: {
    readonly query: string;
    readonly guest?: boolean;
    readonly signal?: AbortSignal;
  }): Promise<SearchReadOutcome>;
  getFollowedStreams(input?: {
    readonly signal?: AbortSignal;
  }): Promise<PlatformReadOutcome<Stream>>;
}

export interface UserTokenSource {
  read(platform: Platform): Promise<UserTokenRead>;
}

export interface InstallationIdentitySource {
  read(): Promise<InstallationIdentityRead>;
}

export interface NetworkSource {
  read(): Promise<NetworkRead>;
}

export type ChannelPageOutcome = {
  readonly platform: Platform;
  readonly path: PlatformReadPath;
  readonly status: DiscoveryProviderStatus;
  readonly channel: Channel | null;
  readonly live: Stream | null;
  readonly cache: CacheProjection;
  readonly error?: { readonly code: string; readonly retry: PlatformReadRetry };
};

export type ChannelMediaRead<T> =
  | { readonly kind: "page"; readonly outcome: PlatformReadOutcome<T> }
  | {
      readonly kind: "unsupported";
      readonly platform: Platform;
      readonly media: "videos" | "clips";
    };

export type FollowView =
  | { readonly kind: "guest-absent" }
  | { readonly kind: "guest-present" }
  | { readonly kind: "pending" }
  | { readonly kind: "failed"; readonly reason: string };

export type WatchAvailability =
  | {
      readonly kind: "available";
      readonly target: {
        readonly channelId: string;
        readonly channelName: string;
        readonly platform: Platform;
      };
    }
  | {
      readonly kind: "unavailable";
      readonly reason: "channel-offline" | "live-state-unverified";
    };

export type ChannelDetailTab = "home" | "videos" | "clips";

export type ChannelDetailPhase =
  | "loading"
  | "ready"
  | "offline-cache"
  | "empty"
  | "failed";

export type ChannelDetailView = {
  readonly channel: Channel | null;
  readonly live: Stream | null;
  readonly videos: ChannelMediaRead<Video>;
  readonly clips: ChannelMediaRead<Clip>;
  readonly follow: FollowView;
  readonly watch: WatchAvailability;
  readonly phase: ChannelDetailPhase;
  readonly page: ChannelPageOutcome;
};

export interface SearchHistoryRepository {
  read(): Promise<SearchHistoryByScope>;
  write(value: SearchHistoryByScope, updatedAt: number): Promise<void>;
}

export interface SearchSession {
  search(input: {
    readonly platform: Platform;
    readonly query: string;
    readonly signal?: AbortSignal;
  }): Promise<SearchReadOutcome>;
}

export interface DiscoverySession {
  readTopStreams(input: {
    readonly language?: string;
    readonly platform: Platform;
    readonly signal?: AbortSignal;
  }): Promise<PlatformReadOutcome<Stream>>;
  readCategories(input: {
    readonly cursor?: string;
    readonly platform: Platform;
    readonly signal?: AbortSignal;
  }): Promise<PlatformReadOutcome<Category>>;
  searchCategories(input: {
    readonly platform: Platform;
    readonly query: string;
    readonly signal?: AbortSignal;
  }): Promise<PlatformReadOutcome<Category>>;
  readCategory(input: {
    readonly categoryId: string;
    readonly platform: Platform;
    readonly signal?: AbortSignal;
  }): Promise<PlatformReadOutcome<Category>>;
  readCategoryStreams(input: {
    readonly categoryId: string;
    readonly language?: string;
    readonly platform: Platform;
    readonly signal?: AbortSignal;
  }): Promise<PlatformReadOutcome<Stream>>;
  readCategoryClips(input: {
    readonly categoryId: string;
    readonly platform: Platform;
    readonly signal?: AbortSignal;
    readonly timeRange: ClipTimeRange;
  }): Promise<
    | PlatformReadOutcome<Clip>
    | {
        readonly kind: "unsupported";
        readonly reason: "kick-clips-unsupported";
        readonly platform: Platform;
      }
  >;
  readCategoryVideos(input: {
    readonly categoryId: string;
    readonly platform: Platform;
    readonly signal?: AbortSignal;
    readonly sort: "views" | "recent";
  }): Promise<
    | PlatformReadOutcome<Video>
    | {
        readonly kind: "unsupported";
        readonly reason: "kick-videos-unsupported";
        readonly platform: Platform;
      }
  >;
  search(input: {
    readonly platform: Platform;
    readonly query: string;
    readonly signal?: AbortSignal;
  }): Promise<SearchReadOutcome>;
  readChannel(input: {
    readonly channel: ChannelIdentity;
    readonly signal?: AbortSignal;
  }): Promise<ChannelPageOutcome>;
  readChannelVideos(input: {
    readonly channel: ChannelIdentity;
    readonly signal?: AbortSignal;
  }): Promise<ChannelMediaRead<Video>>;
  readChannelClips(input: {
    readonly channel: ChannelIdentity;
    readonly signal?: AbortSignal;
  }): Promise<ChannelMediaRead<Clip>>;
}

export type HomeDiscoverySession = DiscoverySession;
export type DiscoveryRuntime = DiscoverySession;

export type DiscoveryFixtureMode =
  | "live"
  | "ready"
  | "loading"
  | "stale-cache"
  | "cache-miss"
  | "twitch-fail"
  | "kick-fail"
  | "auth-lost"
  | "cancelled"
  | "relay-unavailable"
  | "retry-exhausted";
