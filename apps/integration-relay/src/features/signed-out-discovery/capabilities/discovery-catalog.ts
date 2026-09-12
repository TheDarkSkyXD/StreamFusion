import type { ClipTimeRange } from "@streamfusion/core/discovery";
import type {
  SignedOutCategoriesBody,
  SignedOutCategoryBody,
  SignedOutCategoryClipsBody,
  SignedOutCategoryStreamsBody,
  SignedOutCategoryVideosBody,
  SignedOutSearchBody,
  SignedOutTopStreamsBody
} from "@streamfusion/core/relay";

export type DiscoveryPlatform = SignedOutTopStreamsBody["platform"];

export type DiscoveryRead =
  | { readonly kind: "top-streams"; readonly platform: DiscoveryPlatform }
  | {
      readonly kind: "categories";
      readonly platform: DiscoveryPlatform;
      readonly cursor?: string;
    }
  | {
      readonly kind: "search";
      readonly platform: DiscoveryPlatform;
      readonly query: string;
    }
  | {
      readonly kind: "category";
      readonly platform: DiscoveryPlatform;
      readonly categoryId: string;
    }
  | {
      readonly kind: "category-streams";
      readonly platform: DiscoveryPlatform;
      readonly categoryId: string;
      readonly cursor?: string;
      readonly language?: string;
    }
  | {
      readonly kind: "category-clips";
      readonly platform: DiscoveryPlatform;
      readonly categoryId: string;
      readonly cursor?: string;
      readonly timeRange: ClipTimeRange;
    }
  | {
      readonly kind: "category-videos";
      readonly platform: DiscoveryPlatform;
      readonly categoryId: string;
      readonly cursor?: string;
      readonly sort: "views" | "recent";
    };

export type DiscoveryReadResult =
  | { readonly kind: "top-streams"; readonly body: SignedOutTopStreamsBody }
  | { readonly kind: "categories"; readonly body: SignedOutCategoriesBody }
  | { readonly kind: "search"; readonly body: SignedOutSearchBody }
  | { readonly kind: "category"; readonly body: SignedOutCategoryBody }
  | {
      readonly kind: "category-streams";
      readonly body: SignedOutCategoryStreamsBody;
    }
  | { readonly kind: "category-clips"; readonly body: SignedOutCategoryClipsBody }
  | {
      readonly kind: "category-videos";
      readonly body: SignedOutCategoryVideosBody;
    }
  | { readonly kind: "unavailable" };

export type AppCredentials = {
  readonly clientId: string;
  readonly clientSecret: string;
};

export type AuthenticatedInstallation = {
  readonly environment: string;
  readonly installationId: string;
};

export interface DiscoveryCatalog {
  readonly platform: DiscoveryPlatform;
  topStreams(): Promise<SignedOutTopStreamsBody | null>;
  categories(input?: {
    readonly cursor?: string;
  }): Promise<SignedOutCategoriesBody | null>;
  search(input: {
    readonly query: string;
  }): Promise<SignedOutSearchBody | null>;
  category(input: {
    readonly categoryId: string;
  }): Promise<SignedOutCategoryBody | null>;
  categoryStreams(input: {
    readonly categoryId: string;
    readonly cursor?: string;
    readonly language?: string;
  }): Promise<SignedOutCategoryStreamsBody | null>;
  categoryClips(input: {
    readonly categoryId: string;
    readonly cursor?: string;
    readonly timeRange: ClipTimeRange;
  }): Promise<SignedOutCategoryClipsBody | null>;
  categoryVideos(input: {
    readonly categoryId: string;
    readonly cursor?: string;
    readonly sort: "views" | "recent";
  }): Promise<SignedOutCategoryVideosBody | null>;
}

export interface DiscoveryReadAuthorizer {
  authenticatedInstallation(
    credential: string
  ): Promise<AuthenticatedInstallation | null>;
  authorizeRead(credential: string): Promise<unknown | null>;
}

export interface DiscoveryRateLimiter {
  consume(input: {
    readonly limit: number;
    readonly nowEpochMs: number;
    readonly scope: string;
    readonly windowMs: number;
  }): Promise<boolean>;
}
