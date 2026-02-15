/**
 * Token Exchange Utility
 *
 * Handles the OAuth token exchange process - exchanging
 * authorization codes for access tokens and handling token refresh.
 */

import type { AuthToken, Platform } from "../../shared/auth-types";

import { getOAuthConfig, type PkceChallenge } from "./oauth-config";

// ========== Types ==========

export interface TokenExchangeParams {
  platform: Platform;
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

// ========== Token Exchange Class ==========

class TokenExchangeService {
  /**
   * Exchange an authorization code for an access token
   */
  async exchangeCodeForToken(params: TokenExchangeParams): Promise<AuthToken> {
    const config = getOAuthConfig(params.platform);

    console.debug(`🔄 Exchanging code for token (${params.platform})`);
    console.debug(`📤 Token endpoint: ${config.tokenEndpoint}`);

    // The worker now handles the actual exchange and secrets
    // We just send the code and necessary metadata as JSON
    const payload: any = {
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
        console.error(
          `❌ Token exchange failed for ${params.platform}:`,
          response.status,
          errorMessage
        );
        throw new Error(errorMessage);
      }

      const data = (await response.json()) as TokenResponse;
      const token = this.parseTokenResponse(data);

      console.debug(`✅ Token obtained for ${params.platform}`);
      return token;
    } catch (error) {
      console.error(`❌ Token exchange error for ${params.platform}:`, error);
      throw error;
    }
  }

  /**
   * Get an App Access Token (Client Credentials Flow)
   * NOTE: For now, this still tries client_credentials which requires a secret.
   * If we want to hide the secret, the worker needs an endpoint for this too.
   * However, app tokens are usually for backend-to-backend.
   * Since we are proxying API requests, we might not need an app token on the client?
   * If the worker injects valid credentials, the client just needs to make the request.
   * But currently Requestors check for tokens.
   * We should probably fetch the app token from the worker if needed, or rely on worker injection.
   *
   * Let's skip updating this specific method for a moment and focus on User Auth first,
   * as App Token flow on client with no secret is impossible without a proxy endpoint.
   */
  async getAppAccessToken(platform: Platform): Promise<AuthToken> {
    // Since we moved secrets to the worker, the client can no longer independently generate App Tokens (Client Credentials).
    // If App Tokens are critical, we must add a /auth/twitch/app-token endpoint to the worker.
    // For now, fail gracefully.
    console.error(
      `❌ Cannot get App Access Token for ${platform}: Client Secret is not available on client.`
    );
    throw new Error(
      "App Access Token flow not supported without Client Secret. Please use User Authentication."
    );
  }

  /**
   * Refresh an access token using a refresh token
   */
  async refreshToken(params: TokenRefreshParams): Promise<AuthToken> {
    // Determine worker refresh endpoint based on platform
    // We could add this to OAuthConfig, but simple mapping works for now
    // or just append /refresh to base url if it wasn't hardcoded in config

    // Note: getOAuthConfig returns the /token endpoint primarily.
    // We need to construct the refresh endpoint or update OAuthConfig to support multiple endpoints.
    // For simplicity, let's assume the worker endpoints we created:
    // /auth/twitch/refresh url is distinct from /auth/twitch/token

    // We'll parse the base token endpoint from config to derive the refresh endpoint
    // Config has: .../auth/twitch/token
    // We want: .../auth/twitch/refresh

    const config = getOAuthConfig(params.platform);
    const refreshEndpoint = config.tokenEndpoint.replace("/token", "/refresh");

    console.debug(`🔄 Refreshing token for ${params.platform} via Worker`);

    const payload = {
      refresh_token: params.refreshToken,
    };

    try {
      const response = await fetch(refreshEndpoint, {
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
          "Token refresh failed";
        console.error(
          `❌ Token refresh failed for ${params.platform}:`,
          response.status,
          errorMessage
        );
        throw new Error(errorMessage);
      }

      const data = (await response.json()) as TokenResponse;
      const token = this.parseTokenResponse(data);

      console.debug(`✅ Token refreshed for ${params.platform}`);
      return token;
    } catch (error) {
      console.error(`❌ Token refresh error for ${params.platform}:`, error);
      throw error;
    }
  }

  /**
   * Revoke an access token
   */
  async revokeToken(params: TokenRevokeParams): Promise<boolean> {
    const config = getOAuthConfig(params.platform);

    if (!config.revokeEndpoint) {
      console.warn(`⚠️ No revoke endpoint for ${params.platform}`);
      return false;
    }

    console.debug(`🗑️ Revoking token for ${params.platform}`);

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
        console.warn(
          `⚠️ Token revocation returned non-OK status for ${params.platform}:`,
          response.status
        );
        // Revocation often returns 200 OK even if token was already invalid
        // So we don't throw here, just warn
      }

      console.debug(`✅ Token revoked for ${params.platform}`);
      return true;
    } catch (error) {
      console.error(`❌ Token revocation error for ${params.platform}:`, error);
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
    if (data.scope) {
      if (Array.isArray(data.scope)) {
        token.scope = data.scope;
      } else if (typeof data.scope === "string") {
        token.scope = data.scope.split(" ");
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
   * Validate a Kick token using the official token introspection endpoint
   * POST /public/v1/token/introspect
   */
  private async validateKickToken(accessToken: string): Promise<boolean> {
    try {
      // Official Kick token introspection endpoint
      const response = await fetch("https://api.kick.com/public/v1/token/introspect", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        return false;
      }

      // Response format: { data: { active: true/false, ... }, message: "..." }
      const data = (await response.json()) as { data: { active: boolean } };
      return data?.data?.active === true;
    } catch {
      return false;
    }
  }
}

// ========== Export Singleton ==========

export const tokenExchangeService = new TokenExchangeService();
