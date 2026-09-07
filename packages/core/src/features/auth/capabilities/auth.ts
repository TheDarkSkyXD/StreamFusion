export interface OAuth2Credential {
  readonly accessToken: string;
  readonly refreshToken?: string;
}

export interface OAuth2CredentialStore<TCredential extends OAuth2Credential> {
  load(): Promise<TCredential | null>;
  save(credential: TCredential): Promise<void>;
  clear(): Promise<void>;
}

export interface OAuth2RefreshRequest<TCredential extends OAuth2Credential> {
  readonly credential: TCredential;
  readonly refreshToken: string;
}

export type OAuth2RefreshAttempt<TCredential extends OAuth2Credential> =
  | {
      readonly kind: "refreshed";
      readonly credential: TCredential;
    }
  | {
      readonly kind: "transient-failure";
      readonly cause: unknown;
    }
  | {
      readonly kind: "auth-lost";
      readonly reason: "refresh-rejected";
      readonly cause?: unknown;
    };

export interface OAuth2CredentialRefresher<
  TCredential extends OAuth2Credential,
> {
  refresh(
    request: OAuth2RefreshRequest<TCredential>,
  ): Promise<OAuth2RefreshAttempt<TCredential>>;
}
