import type {
  SignedOutCategoriesBody,
  SignedOutSearchBody,
  SignedOutTopStreamsBody
} from "@streamfusion/core/relay";

export type DiscoveryPlatform = SignedOutTopStreamsBody["platform"];

export type DiscoveryRead =
  | { readonly kind: "top-streams"; readonly platform: DiscoveryPlatform }
  | { readonly kind: "categories"; readonly platform: DiscoveryPlatform }
  | {
      readonly kind: "search";
      readonly platform: DiscoveryPlatform;
      readonly query: string;
    };

export type DiscoveryReadResult =
  | { readonly kind: "top-streams"; readonly body: SignedOutTopStreamsBody }
  | { readonly kind: "categories"; readonly body: SignedOutCategoriesBody }
  | { readonly kind: "search"; readonly body: SignedOutSearchBody }
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
