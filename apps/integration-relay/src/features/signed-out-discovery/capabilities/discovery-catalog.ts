import type {
  SignedOutCategoriesBody,
  SignedOutChannelBody,
  SignedOutClipsBody,
  SignedOutSearchBody,
  SignedOutTopStreamsBody,
  SignedOutVideosBody
} from "@streamfusion/core/relay";

export type DiscoveryPlatform = SignedOutTopStreamsBody["platform"];

export type ChannelLookup = {
  readonly id?: string;
  readonly login?: string;
};

export type DiscoveryRead =
  | { readonly kind: "top-streams"; readonly platform: DiscoveryPlatform }
  | { readonly kind: "categories"; readonly platform: DiscoveryPlatform }
  | {
      readonly kind: "search";
      readonly platform: DiscoveryPlatform;
      readonly query: string;
    }
  | {
      readonly kind: "channel";
      readonly platform: DiscoveryPlatform;
      readonly lookup: ChannelLookup;
    }
  | {
      readonly kind: "channel-videos";
      readonly platform: DiscoveryPlatform;
      readonly lookup: ChannelLookup;
    }
  | {
      readonly kind: "channel-clips";
      readonly platform: DiscoveryPlatform;
      readonly lookup: ChannelLookup;
    };

export type DiscoveryReadResult =
  | { readonly kind: "top-streams"; readonly body: SignedOutTopStreamsBody }
  | { readonly kind: "categories"; readonly body: SignedOutCategoriesBody }
  | { readonly kind: "search"; readonly body: SignedOutSearchBody }
  | { readonly kind: "channel"; readonly body: SignedOutChannelBody }
  | { readonly kind: "channel-videos"; readonly body: SignedOutVideosBody }
  | { readonly kind: "channel-clips"; readonly body: SignedOutClipsBody }
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
  categories(): Promise<SignedOutCategoriesBody | null>;
  search(input: {
    readonly query: string;
  }): Promise<SignedOutSearchBody | null>;
  channel(input: ChannelLookup): Promise<SignedOutChannelBody | null>;
  videos(input: ChannelLookup): Promise<SignedOutVideosBody | null>;
  clips(input: ChannelLookup): Promise<SignedOutClipsBody | null>;
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
