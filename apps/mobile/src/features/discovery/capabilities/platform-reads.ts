import type {
  Category,
  Channel,
  Clip,
  Stream,
  Video,
} from "@streamfusion/core/content";
import type {
  DiscoveryProviderStatus,
  SearchIntent,
} from "@streamfusion/core/discovery";
import type { Platform } from "@streamfusion/core/platform";

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

export interface HomeDiscoverySession {
  readTopStreams(input: {
    readonly language?: string;
    readonly platform: Platform;
    readonly signal?: AbortSignal;
  }): Promise<PlatformReadOutcome<Stream>>;
}

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

export type DiscoveryRuntime = HomeDiscoverySession & SearchSession;

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
