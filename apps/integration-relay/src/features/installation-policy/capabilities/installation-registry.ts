import type { InstallationCredentialGrant } from "@streamfusion/core/relay";

export type RelayEnvironment = "development" | "production";

export type InstallationCredentialClaim = {
  readonly environment: RelayEnvironment;
  readonly expiresAtEpochMs: number;
  readonly generation: number;
  readonly installationId: string;
};

export type InstallationRegistryRecord = {
  readonly activeExpiresAtEpochMs: number;
  readonly activeGeneration: number;
  readonly environment: RelayEnvironment;
  readonly installationId: string;
  readonly lastRegistrationId: string;
  readonly registrationGeneration: number;
  readonly lastRotationId: string | null;
  readonly replayExpiresAtEpochMs: number | null;
  readonly replayGeneration: number | null;
  readonly revision: number;
};

export interface InstallationRegistry {
  get(input: {
    readonly environment: RelayEnvironment;
    readonly installationId: string;
  }): Promise<InstallationRegistryRecord | null>;
  insert(input: InstallationRegistryRecord): Promise<boolean>;
  replace(input: InstallationRegistryRecord): Promise<boolean>;
}

export interface InstallationCredentialAuthority {
  issue(input: InstallationCredentialClaim): Promise<string>;
  verify(input: {
    readonly credential: string;
  }): Promise<InstallationCredentialClaim | null>;
}

export interface RelayRateLimiter {
  consume(input: {
    readonly limit: number;
    readonly nowEpochMs: number;
    readonly scope: string;
    readonly windowMs: number;
  }): Promise<boolean>;
}

export type RelayInstallationResult =
  | { readonly kind: "grant"; readonly grant: InstallationCredentialGrant }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "unavailable" };
