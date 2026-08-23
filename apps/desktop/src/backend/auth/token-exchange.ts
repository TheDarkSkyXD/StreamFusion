/**
 * Token Exchange Utility
 *
 * Handles the OAuth token exchange process - exchanging
 * authorization codes for access tokens and handling token refresh.
 */

import { logger } from "@/lib/cross-logger";
import { type AuthToken, KICK_APP_SCOPES, type Platform } from "../../shared/auth-types";
import { KICK_API_BASE } from "../api/platforms/kick/kick-types";
import { hasCanonicalKickScopes } from "./kick-scope-validation";
import { getOAuthConfig, type PkceChallenge } from "./oauth-config";

// ========== Types ==========

export interface TokenExchangeParams {
  platform: "kick";
  code: string;
  redirectUri: string; // Required - the redirect URI used for the OAuth flow
  pkce: PkceChallenge;
}

export interface TokenRefreshParams {
  platform: Platform;
  refreshToken: string;
}

export interface TokenRevokeParams {
  platform: Platform;
  token: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
  scope?: string | string[]; // Can be array or space-separated string
}

interface TokenError {
  error: string;
  error_description?: string;
  message?: string;
}

/**
 * Validity-status portion returned by `getTokenStatus` (U14). This is the
 * status/expiry/scopes ONLY — never the token value. The token-status handler
 * adds `platform` + `connected` to form the renderer-facing `TokenStatusResult`.
 * When `valid` is false the identity fields are omitted.
 */
export interface TokenStatusReport {
  valid: boolean;
  login?: string;
  userId?: string;
  scopes?: string[];
  expiresAt?: number | null;
}

/**
 * Refresh failures need to be categorized: transient (network, 5xx) should
 * retry with backoff; permanent (invalid_grant — refresh token revoked or
 * rotated out, invalid_request, invalid_client) should clear the stored
 * token and prompt the user to re-authenticate. Callers can branch on
 * `status` and `code`.
 */
export class TokenRefreshError extends Error {
  readonly status: number | null;
  readonly code: string | null;

  constructor(message: string, status: number | null, code: string | null) {
    super(message);
    this.name = "TokenRefreshError";
    this.status = status;
    this.code = code;
  }

  /**
   * Permanent failures (won't succeed if retried). Covers OAuth-spec error
   * codes for which retry is futile, plus 4xx statuses other than 408/429.
   */
  isPermanent(): boolean {
    if (this.code === "invalid_grant") return true;
    if (this.code === "invalid_request") return true;
    if (this.code === "invalid_client") return true;
    if (this.code === "unauthorized_client") return true;
    if (this.code === "unsupported_grant_type") return true;
    if (this.status === null) return false;
    // 4xx (except request timeout / rate-limit) — permanent
    if (this.status >= 400 && this.status < 500) {
      if (this.status === 408 || this.status === 429) return false;
      return true;
    }
    return false;
  }
}

// ========== Token Exchange Class ==========

class TokenExchangeService {
  /**
   * Exchange an authorization code for an access token
   */
  async exchangeCodeForToken(params: TokenExchangeParams): Promise<AuthToken> {
    if (params.platform !== "kick") {
      throw new Error(
        "Twitch authorization uses Device Code Grant, not authorization-code exchange"
      );
    }
    const config = getOAuthConfig(params.platform);

    logger.debug("Auth:TokenExchange", "Exchanging code for token", { platform: params.platform });
    logger.debug("Auth:TokenExchange", "Token endpoint resolved", {
      platform: params.platform,
      tokenEndpoint: config.tokenEndpoint,
    });

    // The worker now handles the actual exchange and secrets
    // We just send the code and necessary metadata as JSON
    const payload: { code: string; redirect_uri: string; code_verifier?: string } = {
      code: params.code,
      redirect_uri: params.redirectUri,
    };

    if (config.usesPkce && params.pkce) {
      payload.code_verifier = params.pkce.codeVerifier;
    }

    try {
      const response = await fetch(config.tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as TokenError;
        const errorMessage =
          errorData.error_description ||
          errorData.message ||
          errorData.error ||
          "Token exchange failed";
        logger.error("Auth:TokenExchange", "Token exchange failed", {
          platform: params.platform,
          status: response.status,
          errorMessage,
        });
        throw new Error(errorMessage);
      }

      const data = (await response.json()) as TokenResponse;
      const parsedToken = this.parseTokenResponse(data);
      const token =
        data.scope === undefined ? { ...parsedToken, scope: [...KICK_APP_SCOPES] } : parsedToken;
      logger.debug("Auth:TokenExchange", "Token obtained", { platform: params.platform });
      return token;
    } catch (error) {
      logger.error("Auth:TokenExchange", "Token exchange error", {
        platform: params.platform,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      throw error;
    }
  }

  /**
   * Refresh an access token using a refresh token
   */
  async refreshToken(params: TokenRefreshParams): Promise<AuthToken> {
    const config = getOAuthConfig(params.platform);
    const isTwitch = params.platform === "twitch";
    const refreshEndpoint = isTwitch
      ? "https://id.twitch.tv/oauth2/token"
      : config.tokenEndpoint.replace("/token", "/refresh");

    logger.debug("Auth:TokenExchange", "Refreshing token", {
      platform: params.platform,
    });

    const body = isTwitch
      ? new URLSearchParams({
          client_id: config.clientId,
          refresh_token: params.refreshToken,
          grant_type: "refresh_token",
        }).toString()
      : JSON.stringify({ refresh_token: params.refreshToken });

    try {
      const response = await fetch(refreshEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": isTwitch ? "application/x-www-form-urlencoded" : "application/json",
          Accept: "application/json",
        },
        body,
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as TokenError;
        const errorMessage =
          errorData.error_description ||
          errorData.message ||
          errorData.error ||
          "Token refresh failed";
        logger.error("Auth:TokenExchange", "Token refresh failed", {
          platform: params.platform,
          status: response.status,
          errorMessage,
        });
        throw new TokenRefreshError(errorMessage, response.status, errorData.error ?? null);
      }

      const data = (await response.json()) as TokenResponse;
      const parsedToken = this.parseTokenResponse(data);
      const token = isTwitch ? { ...parsedToken, authFlow: "device-code" as const } : parsedToken;

      logger.debug("Auth:TokenExchange", "Token refreshed", { platform: params.platform });
      return token;
    } catch (error) {
      logger.error("Auth:TokenExchange", "Token refresh error", {
        platform: params.platform,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      throw error;
    }
  }

  /**
   * Revoke an access token
   */
  async revokeToken(params: TokenRevokeParams): Promise<boolean> {
    const config = getOAuthConfig(params.platform);

    if (!config.revokeEndpoint) {
      logger.warn("Auth:TokenExchange", "No revoke endpoint", { platform: params.platform });
      return false;
    }

    logger.debug("Auth:TokenExchange", "Revoking token", { platform: params.platform });

    const body = new URLSearchParams({
      client_id: config.clientId,
      token: params.token,
    });

    try {
      const response = await fetch(config.revokeEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      if (!response.ok) {
        logger.warn("Auth:TokenExchange", "Token revocation returned non-OK status", {
          platform: params.platform,
          status: response.status,
        });
        // Revocation often returns 200 OK even if token was already invalid
        // So we don't throw here, just warn
      }

      logger.debug("Auth:TokenExchange", "Token revoked", { platform: params.platform });
      return true;
    } catch (error) {
      logger.error("Auth:TokenExchange", "Token revocation error", {
        platform: params.platform,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      return false;
    }
  }

  /**
   * Parse the token response into our AuthToken format
   */
  private parseTokenResponse(data: TokenResponse): AuthToken {
    const token: AuthToken = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
    };

    // Calculate expiration time if expires_in is provided
    if (data.expires_in) {
      token.expiresAt = Date.now() + data.expires_in * 1000;
    }

    // Parse scope if provided - handle both array and string formats
    if (data.scope !== undefined) {
      if (Array.isArray(data.scope)) {
        token.scope = data.scope;
      } else if (typeof data.scope === "string") {
        token.scope = data.scope.split(/\s+/).filter(Boolean);
      }
    }

    return token;
  }

  /**
   * Validate a token by making a request to the platform's user info endpoint
   * Returns true if the token is valid
   */
  async validateToken(platform: Platform, accessToken: string): Promise<boolean> {
    try {
      switch (platform) {
        case "twitch":
          return await this.validateTwitchToken(accessToken);
        case "kick":
          return await this.validateKickToken(accessToken);
        default:
          return false;
      }
    } catch {
      return false;
    }
  }

  /**
   * Validate a Twitch token
   */
  private async validateTwitchToken(accessToken: string): Promise<boolean> {
    const response = await fetch("https://id.twitch.tv/oauth2/validate", {
      headers: {
        Authorization: `OAuth ${accessToken}`,
      },
    });
    return response.ok;
  }

  /**
   * Read-only token status for the API/Tokens panel (U14). Validates live and
   * returns identity + validity + expiry + scopes ONLY — the access token string
   * stays inside this method; the caller (token-status-handler) only ever sees
   * `TokenStatusReport`. Callers pass the stored token so we never read storage
   * from here (keeps this unit testable with a plain object).
   *
   * Twitch: hits `id.twitch.tv/oauth2/validate`, which authenticates with the
   *   OAuth bearer header alone (NO Client-Id — the Client-Id pairing concern is
   *   a Helix/`fetchCurrentUser` problem, not a /validate one). login/user_id/
   *   scopes/expiry come straight off the /validate body.
   * Kick: has no /validate analogue. We re-fetch the current user on the OAuth
   *   surface; non-200 = invalid. Kick returns no expiry, so `expiresAt` falls
   *   back to the stored token's `expiresAt` and `userId` is the OAuth `user_id`.
   */
  async getTokenStatus(platform: Platform, token: AuthToken): Promise<TokenStatusReport> {
    try {
      switch (platform) {
        case "twitch":
          return await this.getTwitchTokenStatus(token);
        case "kick":
          return await this.getKickTokenStatus(token);
        default:
          return { valid: false };
      }
    } catch {
      // Network failure / unexpected error → report invalid rather than throw,
      // so the panel shows "invalid or expired + reconnect" instead of crashing.
      return { valid: false };
    }
  }

  private async getTwitchTokenStatus(token: AuthToken): Promise<TokenStatusReport> {
    const response = await fetch("https://id.twitch.tv/oauth2/validate", {
      headers: {
        // /validate takes ONLY the OAuth bearer header — no Client-Id.
        Authorization: `OAuth ${token.accessToken}`,
      },
    });

    if (!response.ok) {
      return { valid: false };
    }

    const data = (await response.json()) as {
      login?: string;
      user_id?: string;
      scopes?: string[];
      expires_in?: number;
    };

    return {
      valid: true,
      login: data.login,
      userId: data.user_id,
      scopes: data.scopes ?? [],
      // /validate returns seconds-until-expiry; convert to an absolute ms
      // timestamp. Fall back to the stored expiry when absent.
      expiresAt:
        typeof data.expires_in === "number"
          ? Date.now() + data.expires_in * 1000
          : (token.expiresAt ?? null),
    };
  }

  private async getKickTokenStatus(token: AuthToken): Promise<TokenStatusReport> {
    const introspection = await this.introspectKickToken(token.accessToken);
    if (!introspection?.active) {
      return { valid: false, scopes: introspection?.scopes ?? [] };
    }
    // Kick has no /validate; GET /users (no IDs) returns the current user when
    // the bearer token is valid. Non-200 → invalid.
    const response = await fetch(`${KICK_API_BASE}/users`, {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return { valid: false };
    }

    const body = (await response.json()) as {
      data?: Array<{ user_id?: number; name?: string }>;
    };
    const apiUser = body?.data?.[0];

    return {
      valid: true,
      login: apiUser?.name,
      // The Kick OAuth `user_id` (NOT the channel.id) — see the dual-id learning.
      userId: apiUser?.user_id != null ? String(apiUser.user_id) : undefined,
      // The current-user endpoint proves identity only. Scope truth comes from
      // the official introspection response above.
      scopes: introspection.scopes,
      // No expiry from the API surface — fall back to the stored token expiry.
      expiresAt: token.expiresAt ?? null,
    };
  }

  /**
   * Validate a Kick token using the official token introspection endpoint
   * POST /oauth/token/introspect
   */
  private async validateKickToken(accessToken: string): Promise<boolean> {
    try {
      const result = await this.introspectKickToken(accessToken);
      return result?.active === true && hasCanonicalKickScopes(result.scopes);
    } catch {
      return false;
    }
  }

  private async introspectKickToken(
    accessToken: string
  ): Promise<{ active: boolean; scopes: string[] } | null> {
    const response = await fetch("https://id.kick.com/oauth/token/introspect", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) return null;

    const data = (await response.json()) as {
      active?: boolean;
      scope?: string | string[];
      data?: { active?: boolean; scope?: string | string[] };
    };
    const rawScopes = data.scope ?? data.data?.scope;
    const scopes = Array.isArray(rawScopes)
      ? rawScopes.filter((scope): scope is string => typeof scope === "string")
      : typeof rawScopes === "string"
        ? rawScopes.split(/\s+/).filter(Boolean)
        : [];
    return {
      active: data.active === true || data.data?.active === true,
      scopes,
    };
  }
}

// ========== Export Singleton ==========

export const tokenExchangeService = new TokenExchangeService();
