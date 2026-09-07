import type {
  OAuth2Credential,
  OAuth2CredentialRefresher,
  OAuth2CredentialStore,
} from "../capabilities/auth.ts";

export type OAuth2SessionState<TCredential extends OAuth2Credential> =
  | { readonly kind: "disconnected" }
  | {
      readonly kind: "connected";
      readonly credential: TCredential;
    };

export type OAuth2AuthLostEvent = {
  readonly reason:
    "missing-credential" | "missing-refresh-token" | "refresh-rejected";
};

export type OAuth2RefreshOutcome<TCredential extends OAuth2Credential> =
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
      readonly reason: OAuth2AuthLostEvent["reason"];
      readonly cause?: unknown;
    }
  | {
      readonly kind: "unavailable";
      readonly reason: "missing-credential" | "missing-refresh-token";
    };

export interface OAuth2Session<TCredential extends OAuth2Credential> {
  read(): Promise<OAuth2SessionState<TCredential>>;
  refresh(): Promise<OAuth2RefreshOutcome<TCredential>>;
  onAuthLost(listener: (event: OAuth2AuthLostEvent) => void): () => void;
}

export interface CreateOAuth2SessionOptions<
  TCredential extends OAuth2Credential,
> {
  readonly credentials: OAuth2CredentialStore<TCredential>;
  readonly refresher: OAuth2CredentialRefresher<TCredential>;
  readonly missingCredential?: "auth-lost" | "unavailable";
  readonly missingRefreshToken?: "auth-lost" | "unavailable";
}

class DefaultOAuth2Session<
  TCredential extends OAuth2Credential,
> implements OAuth2Session<TCredential> {
  private refreshInFlight: Promise<OAuth2RefreshOutcome<TCredential>> | null =
    null;
  private readonly authLostListeners = new Set<
    (event: OAuth2AuthLostEvent) => void
  >();
  private readonly options: CreateOAuth2SessionOptions<TCredential>;

  constructor(options: CreateOAuth2SessionOptions<TCredential>) {
    this.options = options;
  }

  async read(): Promise<OAuth2SessionState<TCredential>> {
    const credential = await this.options.credentials.load();
    return credential
      ? { kind: "connected", credential }
      : { kind: "disconnected" };
  }

  refresh(): Promise<OAuth2RefreshOutcome<TCredential>> {
    if (this.refreshInFlight) return this.refreshInFlight;

    const refresh = this.performRefresh().finally(() => {
      if (this.refreshInFlight === refresh) this.refreshInFlight = null;
    });
    this.refreshInFlight = refresh;
    return refresh;
  }

  onAuthLost(listener: (event: OAuth2AuthLostEvent) => void): () => void {
    this.authLostListeners.add(listener);
    return () => {
      this.authLostListeners.delete(listener);
    };
  }

  private async performRefresh(): Promise<OAuth2RefreshOutcome<TCredential>> {
    const credential = await this.options.credentials.load();
    if (!credential) {
      if (this.options.missingCredential === "auth-lost") {
        return await this.loseAuth({
          kind: "auth-lost",
          reason: "missing-credential",
        });
      }
      return { kind: "unavailable", reason: "missing-credential" };
    }

    const refreshToken = credential.refreshToken;
    if (!refreshToken) {
      if (this.options.missingRefreshToken !== "auth-lost") {
        return { kind: "unavailable", reason: "missing-refresh-token" };
      }
      return await this.loseAuth({
        kind: "auth-lost",
        reason: "missing-refresh-token",
      });
    }

    let attempt;
    try {
      attempt = await this.options.refresher.refresh({
        credential,
        refreshToken,
      });
    } catch (cause) {
      return { kind: "transient-failure", cause };
    }

    switch (attempt.kind) {
      case "refreshed":
        try {
          await this.options.credentials.save(attempt.credential);
          return attempt;
        } catch (cause) {
          return { kind: "transient-failure", cause };
        }
      case "transient-failure":
        return attempt;
      case "auth-lost":
        return await this.loseAuth(attempt);
      default: {
        const exhaustive: never = attempt;
        return exhaustive;
      }
    }
  }

  private async loseAuth(
    outcome: Extract<OAuth2RefreshOutcome<TCredential>, { kind: "auth-lost" }>,
  ): Promise<OAuth2RefreshOutcome<TCredential>> {
    await this.options.credentials.clear();
    const event: OAuth2AuthLostEvent = { reason: outcome.reason };
    for (const listener of this.authLostListeners) {
      try {
        listener(event);
      } catch {
        continue;
      }
    }
    return outcome;
  }
}

export function createOAuth2Session<TCredential extends OAuth2Credential>(
  options: CreateOAuth2SessionOptions<TCredential>,
): OAuth2Session<TCredential> {
  return new DefaultOAuth2Session(options);
}
