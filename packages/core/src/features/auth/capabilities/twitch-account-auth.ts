export type TwitchAccountId = string & { readonly __brand: "TwitchAccountId" };
export type TwitchAttemptId = string & { readonly __brand: "TwitchAttemptId" };
export type TwitchCredentialGeneration = number & {
  readonly __brand: "TwitchCredentialGeneration";
};

export interface TwitchAccountIdentity {
  readonly displayName: string;
  readonly id: TwitchAccountId;
  readonly login: string;
  readonly profileImageUrl: string | null;
}

export interface TwitchCredential {
  readonly accessToken: string;
  readonly account: TwitchAccountIdentity;
  readonly expiresAtEpochMs: number;
  readonly generation: TwitchCredentialGeneration;
  readonly refreshToken: string;
  readonly scopes: readonly string[];
  readonly validatedAtEpochMs: number;
}

export interface TwitchDeviceAuthorization {
  readonly deviceCode: string;
  readonly expiresInSeconds: number;
  readonly intervalSeconds: number;
  readonly userCode: string;
  readonly verificationUri: string;
}

export interface TwitchPersistedDeviceAttempt extends TwitchDeviceAuthorization {
  readonly attemptId: TwitchAttemptId;
  readonly expiresAtEpochMs: number;
  readonly generation: TwitchCredentialGeneration;
  readonly nextPollAtEpochMs: number;
}

export interface TwitchCancellationSignal {
  readonly aborted: boolean;
  onCancel(listener: () => void): () => void;
}

export type TwitchDevicePollResult =
  | { readonly kind: "pending" }
  | { readonly kind: "slow-down"; readonly retryAfterSeconds: number | null }
  | { readonly kind: "transient-failure" }
  | { readonly kind: "denied" }
  | { readonly kind: "expired" }
  | {
      readonly kind: "authorized";
      readonly accessToken: string;
      readonly expiresInSeconds: number;
      readonly refreshToken: string;
      readonly scopes: readonly string[];
    };

export type TwitchRefreshDispatchResult =
  | { readonly kind: "not-sent"; readonly cause: unknown }
  | { readonly kind: "outcome-unknown"; readonly cause: unknown }
  | { readonly kind: "rejected" }
  | {
      readonly kind: "refreshed";
      readonly accessToken: string;
      readonly expiresInSeconds: number;
      readonly refreshToken: string;
      readonly scopes: readonly string[];
    };

export interface TwitchTokenValidation {
  readonly clientId: string;
  readonly expiresInSeconds: number;
  readonly login: string;
  readonly scopes: readonly string[];
  readonly userId: TwitchAccountId;
}

export type TwitchTokenValidationResult =
  | { readonly kind: "valid"; readonly validation: TwitchTokenValidation }
  | { readonly kind: "revoked" }
  | { readonly kind: "transient-failure"; readonly cause: unknown };

export type TwitchAccountLookupResult =
  | { readonly kind: "found"; readonly account: TwitchAccountIdentity }
  | { readonly kind: "revoked" }
  | { readonly kind: "transient-failure"; readonly cause: unknown };

export interface TwitchDeviceAuthorizationGateway {
  loadAccount(
    accessToken: string,
    userId: TwitchAccountId,
    signal: TwitchCancellationSignal,
  ): Promise<TwitchAccountLookupResult>;
  poll(
    deviceCode: string,
    signal: TwitchCancellationSignal,
  ): Promise<TwitchDevicePollResult>;
  refresh(
    refreshToken: string,
    signal: TwitchCancellationSignal,
  ): Promise<TwitchRefreshDispatchResult>;
  request(
    scopes: readonly string[],
    signal: TwitchCancellationSignal,
  ): Promise<TwitchDeviceAuthorization>;
  validate(
    accessToken: string,
    signal: TwitchCancellationSignal,
  ): Promise<TwitchTokenValidationResult>;
}

export type TwitchCredentialSnapshot =
  | {
      readonly kind: "disconnected";
      readonly generation: TwitchCredentialGeneration;
    }
  | { readonly kind: "ready"; readonly credential: TwitchCredential }
  | {
      readonly kind: "connecting";
      readonly attempt: TwitchPersistedDeviceAttempt;
    }
  | {
      readonly kind: "poll-in-flight";
      readonly attempt: TwitchPersistedDeviceAttempt;
    }
  | {
      readonly kind: "requesting";
      readonly attemptId: TwitchAttemptId;
      readonly generation: TwitchCredentialGeneration;
    }
  | {
      readonly kind: "refresh-in-flight";
      readonly account: TwitchAccountIdentity;
      readonly credential: TwitchCredential;
      readonly operationId: string;
    }
  | {
      readonly kind: "auth-lost";
      readonly account: TwitchAccountIdentity | null;
      readonly generation: TwitchCredentialGeneration;
      readonly reason:
        | "connection-validation-failed"
        | "refresh-outcome-unknown"
        | "refresh-rejected"
        | "revoked";
    };

export type TwitchRefreshClaimResult =
  | {
      readonly kind: "claimed";
      readonly credential: TwitchCredential;
      readonly operationId: string;
    }
  | { readonly kind: "stale" | "unavailable" };

export type TwitchDevicePollClaimResult =
  | { readonly kind: "claimed"; readonly attempt: TwitchPersistedDeviceAttempt }
  | { readonly kind: "expired" }
  | { readonly kind: "not-due" }
  | { readonly kind: "stale" };

export interface TwitchCredentialRepository {
  beginRequest(input: {
    readonly attemptId: TwitchAttemptId;
    readonly expectedGeneration: TwitchCredentialGeneration;
  }): Promise<boolean>;
  beginAttempt(input: {
    readonly attempt: TwitchPersistedDeviceAttempt;
    readonly expectedGeneration: TwitchCredentialGeneration;
  }): Promise<boolean>;
  clearAttempt(attemptId: TwitchAttemptId): Promise<boolean>;
  claimDevicePoll(input: {
    readonly attemptId: TwitchAttemptId;
    readonly nowEpochMs: number;
  }): Promise<TwitchDevicePollClaimResult>;
  claimRefresh(input: {
    readonly expectedGeneration: TwitchCredentialGeneration;
    readonly operationId: string;
  }): Promise<TwitchRefreshClaimResult>;
  commitConnection(input: {
    readonly attemptId: TwitchAttemptId;
    readonly credential: TwitchCredential;
    readonly expectedGeneration: TwitchCredentialGeneration;
  }): Promise<boolean>;
  commitRefresh(input: {
    readonly credential: TwitchCredential;
    readonly expectedGeneration: TwitchCredentialGeneration;
    readonly operationId: string;
  }): Promise<boolean>;
  commitValidation(input: {
    readonly accountId: TwitchAccountId;
    readonly expectedGeneration: TwitchCredentialGeneration;
    readonly expiresAtEpochMs: number;
    readonly scopes: readonly string[];
    readonly validatedAtEpochMs: number;
  }): Promise<boolean>;
  disconnect(expectedGeneration: TwitchCredentialGeneration): Promise<boolean>;
  markAuthLost(input: {
    readonly attemptId?: TwitchAttemptId;
    readonly expectedGeneration: TwitchCredentialGeneration;
    readonly operationId?: string;
    readonly reason:
      | "connection-validation-failed"
      | "refresh-outcome-unknown"
      | "refresh-rejected"
      | "revoked";
  }): Promise<boolean>;
  releaseRefreshClaim(input: {
    readonly expectedGeneration: TwitchCredentialGeneration;
    readonly operationId: string;
  }): Promise<boolean>;
  read(): Promise<TwitchCredentialSnapshot>;
}
