import type {
  CapabilityManifest,
  InstallationCredentialGrant,
} from "@streamfusion/core/relay";

export type InstallationPolicyEnvironment = "development" | "production";

export type InstallationCredential = InstallationCredentialGrant & {
  readonly installationId: string;
};

export type InstallationIdentityState = {
  readonly credential: InstallationCredential | null;
  readonly installationId: string;
  readonly pendingRegistrationId: string | null;
  readonly pendingRotationId: string | null;
};

export type InstallationIdentityReadResult =
  | { readonly kind: "empty" }
  | { readonly kind: "ready"; readonly state: InstallationIdentityState }
  | { readonly kind: "corrupt" };

export type InstallationIdentityPresence =
  | { readonly kind: "absent" }
  | { readonly kind: "initialized" }
  | { readonly kind: "corrupt" };

export type VerifiedPolicySnapshot = {
  readonly manifest: CapabilityManifest;
  readonly verifiedAtEpochMs: number;
};

export type InstallationPolicyTransportFailure =
  | { readonly kind: "cancelled" }
  | { readonly kind: "offline" }
  | { readonly kind: "rate-limited"; readonly retryAfterSeconds: number }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "unavailable" };

export type InstallationRegistrationResult =
  | { readonly kind: "registered"; readonly credential: InstallationCredential }
  | {
      readonly kind: "failure";
      readonly failure: InstallationPolicyTransportFailure;
    };

export type CapabilityPolicyFetchResult =
  | { readonly kind: "received"; readonly payload: unknown }
  | {
      readonly kind: "failure";
      readonly failure: InstallationPolicyTransportFailure;
    };

export type CapabilityPolicyVerificationResult =
  | { readonly kind: "valid"; readonly manifest: CapabilityManifest }
  | {
      readonly kind: "invalid";
      readonly reason:
        | "environment"
        | "expiry"
        | "issued-time"
        | "monotonic-version"
        | "schema"
        | "signature";
    };

export interface InstallationCredentialStore {
  read(): Promise<InstallationIdentityReadResult>;
  write(state: InstallationIdentityState): Promise<void>;
}

/**
 * A non-secret Product-store witness that an installation identity was saved.
 * It intentionally contains no identity, credential, or operation identifier.
 */
export interface InstallationIdentityPresenceStore {
  read(): Promise<InstallationIdentityPresence>;
  writeInitialized(): Promise<void>;
}

export interface InstallationPolicySnapshotStore {
  read(): Promise<string | null>;
  write(value: string, updatedAtEpochMs: number): Promise<void>;
}

export interface VerifiedPolicyStore {
  read(): Promise<VerifiedPolicySnapshot | null>;
  write(snapshot: VerifiedPolicySnapshot): Promise<boolean>;
}

export interface InstallationPolicyTransport {
  readManifest(input: {
    readonly credential: InstallationCredential;
    readonly signal: AbortSignal;
  }): Promise<CapabilityPolicyFetchResult>;
  register(input: {
    readonly credential: InstallationCredential | null;
    readonly environment: InstallationPolicyEnvironment;
    readonly installationId: string;
    readonly registrationId: string;
    readonly signal: AbortSignal;
  }): Promise<InstallationRegistrationResult>;
  rotate(input: {
    readonly credential: InstallationCredential;
    readonly rotationId: string;
    readonly signal: AbortSignal;
  }): Promise<InstallationRegistrationResult>;
}

export interface CapabilityPolicyVerifier {
  verify(input: {
    readonly environment: InstallationPolicyEnvironment;
    readonly nowEpochMs: number;
    readonly payload: unknown;
    /** A previously verified policy, never an unverified candidate. */
    readonly previousManifest: CapabilityManifest | null;
  }): CapabilityPolicyVerificationResult;
}

export interface InstallationIdentitySource {
  create(): string;
}
