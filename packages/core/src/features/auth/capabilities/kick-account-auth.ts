export const KICK_ANDROID_REDIRECT_URI =
  "https://streamfusion.leveluptogetherbiz.workers.dev/auth/kick/android/callback";

export const KICK_AUTHORIZE_URL = "https://id.kick.com/oauth/authorize";

export const KICK_APP_SCOPES = [
  "user:read",
  "channel:read",
  "chat:write",
  "moderation:chat_message:manage",
  "moderation:ban",
  "events:subscribe",
] as const;

export type KickAccountId = string & { readonly __brand: "KickAccountId" };
export type KickAttemptId = string & { readonly __brand: "KickAttemptId" };
export type KickCredentialGeneration = number & {
  readonly __brand: "KickCredentialGeneration";
};

export interface KickAccountIdentity {
  readonly displayName: string;
  readonly id: KickAccountId;
  readonly login: string;
  readonly profileImageUrl: string | null;
}

export interface KickCredential {
  readonly accessToken: string;
  readonly account: KickAccountIdentity;
  readonly expiresAtEpochMs: number;
  readonly generation: KickCredentialGeneration;
  readonly refreshToken: string;
  readonly scopes: readonly string[];
  readonly validatedAtEpochMs: number;
}

export interface KickPersistedPkceAttempt {
  readonly attemptId: KickAttemptId;
  readonly codeVerifier: string;
  readonly expiresAtEpochMs: number;
  readonly generation: KickCredentialGeneration;
  readonly redirectUri: string;
  readonly state: string;
}

export interface KickCancellationSignal {
  readonly aborted: boolean;
  onCancel(listener: () => void): () => void;
}

export type KickCallbackInput = {
  readonly code: string | null;
  readonly error: string | null;
  readonly receivedAtEpochMs: number;
  readonly redirectUri: string;
  readonly state: string | null;
};

export type KickCallbackVerdict =
  | {
      readonly kind: "accepted";
      readonly attemptId: KickAttemptId;
      readonly code: string;
    }
  | {
      readonly kind: "denied";
      readonly attemptId: KickAttemptId;
      readonly reason: string;
    }
  | { readonly kind: "expired"; readonly attemptId: KickAttemptId }
  | { readonly kind: "stale" }
  | { readonly kind: "duplicate" }
  | { readonly kind: "state-mismatch"; readonly attemptId: KickAttemptId }
  | { readonly kind: "wrong-redirect"; readonly attemptId: KickAttemptId }
  | { readonly kind: "superseded" };

export type KickTokenExchangeResult =
  | {
      readonly kind: "exchanged";
      readonly accessToken: string;
      readonly expiresInSeconds: number;
      readonly refreshToken: string;
      readonly scopes: readonly string[];
    }
  | { readonly kind: "rejected" }
  | { readonly kind: "transient-failure"; readonly cause: unknown };

export type KickRefreshDispatchResult =
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

export type KickAccountLookupResult =
  | { readonly kind: "found"; readonly account: KickAccountIdentity }
  | { readonly kind: "revoked" }
  | { readonly kind: "transient-failure"; readonly cause: unknown };

export interface KickAuthorizationGateway {
  exchange(input: {
    readonly code: string;
    readonly codeVerifier: string;
    readonly redirectUri: string;
    readonly signal: KickCancellationSignal;
  }): Promise<KickTokenExchangeResult>;
  loadAccount(
    accessToken: string,
    signal: KickCancellationSignal,
  ): Promise<KickAccountLookupResult>;
  refresh(
    refreshToken: string,
    signal: KickCancellationSignal,
  ): Promise<KickRefreshDispatchResult>;
}

export type KickCredentialSnapshot =
  | {
      readonly kind: "disconnected";
      readonly generation: KickCredentialGeneration;
    }
  | { readonly kind: "ready"; readonly credential: KickCredential }
  | {
      readonly kind: "launching" | "pending" | "exchanging";
      readonly attempt: KickPersistedPkceAttempt;
    }
  | {
      readonly kind: "refresh-in-flight";
      readonly account: KickAccountIdentity;
      readonly credential: KickCredential;
      readonly operationId: string;
    }
  | {
      readonly kind: "auth-lost";
      readonly account: KickAccountIdentity | null;
      readonly generation: KickCredentialGeneration;
      readonly reason:
        | "connection-validation-failed"
        | "refresh-outcome-unknown"
        | "refresh-rejected"
        | "revoked";
    };

export type KickRefreshClaimResult =
  | {
      readonly kind: "claimed";
      readonly credential: KickCredential;
      readonly operationId: string;
    }
  | { readonly kind: "stale" | "unavailable" };

export type KickExchangeClaimResult =
  | { readonly kind: "claimed"; readonly attempt: KickPersistedPkceAttempt }
  | { readonly kind: "expired" }
  | { readonly kind: "stale" };

export interface KickCredentialRepository {
  beginLaunch(input: {
    readonly attempt: KickPersistedPkceAttempt;
    readonly expectedGeneration: KickCredentialGeneration;
  }): Promise<boolean>;
  markPending(attemptId: KickAttemptId): Promise<boolean>;
  claimExchange(input: {
    readonly attemptId: KickAttemptId;
    readonly nowEpochMs: number;
  }): Promise<KickExchangeClaimResult>;
  clearAttempt(attemptId: KickAttemptId): Promise<boolean>;
  claimRefresh(input: {
    readonly expectedGeneration: KickCredentialGeneration;
    readonly operationId: string;
  }): Promise<KickRefreshClaimResult>;
  commitConnection(input: {
    readonly attemptId: KickAttemptId;
    readonly credential: KickCredential;
    readonly expectedGeneration: KickCredentialGeneration;
  }): Promise<boolean>;
  commitRefresh(input: {
    readonly credential: KickCredential;
    readonly expectedGeneration: KickCredentialGeneration;
    readonly operationId: string;
  }): Promise<boolean>;
  disconnect(expectedGeneration: KickCredentialGeneration): Promise<boolean>;
  markAuthLost(input: {
    readonly attemptId?: KickAttemptId;
    readonly expectedGeneration: KickCredentialGeneration;
    readonly operationId?: string;
    readonly reason:
      | "connection-validation-failed"
      | "refresh-outcome-unknown"
      | "refresh-rejected"
      | "revoked";
  }): Promise<boolean>;
  releaseRefreshClaim(input: {
    readonly expectedGeneration: KickCredentialGeneration;
    readonly operationId: string;
  }): Promise<boolean>;
  read(): Promise<KickCredentialSnapshot>;
}
