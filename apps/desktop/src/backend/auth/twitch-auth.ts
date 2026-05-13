/**
 * Twitch Authentication Service
 *
 * Handles Twitch-specific authentication operations including:
 * - Token refresh
 * - Token revocation (logout)
 * - User info fetching
 *
 * Note: The OAuth flow itself is now handled by the IPC handlers
 * using the localhost callback server.
 */

import type { AuthToken, Platform, TwitchUser } from "../../shared/auth-types";
import {
  TWITCH_API_BASE,
  type TwitchApiResponse,
  type TwitchApiUser,
} from "../api/platforms/twitch/twitch-types";
import { storageService } from "../services/storage-service";

import { getOAuthConfig } from "./oauth-config";
import { tokenExchangeService } from "./token-exchange";

// ========== Types ==========

export interface TwitchAuthSession {
  createdAt: number;
}

// Single-flight refresh guard. When a quiet token expiry leaves N concurrent
// IPC requests pending and they all hit 401 at once, each caller would
// otherwise kick off its own refresh — multiplying load on the Twitch auth
// endpoint, burning 401-retry budget, and potentially racing rotated refresh
// tokens. While a refresh is in flight, subsequent callers `await` the same
// promise. The new token is persisted to storage inside the promise chain so
// waiters see the fresh token via `storageService.getToken` after they resume.
let _refreshInFlight: Promise<AuthToken | null> | null = null;

// ========== Twitch Auth Service Class ==========

class TwitchAuthService {
  private readonly platform: Platform = "twitch";

  /**
   * Refresh the access token using the refresh token. Concurrent callers share
   * a single in-flight refresh — see `_refreshInFlight` above.
   */
  async refreshToken(): Promise<AuthToken | null> {
    if (_refreshInFlight) {
      return _refreshInFlight;
    }
    _refreshInFlight = this._performRefresh();
    try {
      return await _refreshInFlight;
    } finally {
      _refreshInFlight = null;
    }
  }

  private async _performRefresh(): Promise<AuthToken | null> {
    const currentToken = storageService.getToken(this.platform);

    if (!currentToken?.refreshToken) {
      console.warn("⚠️ No refresh token available for Twitch");
      return null;
    }

    try {
      const newToken = await tokenExchangeService.refreshToken({
        platform: this.platform,
        refreshToken: currentToken.refreshToken,
      });

      // Save the new token
      storageService.saveToken(this.platform, newToken);

      console.debug("✅ Twitch token refreshed successfully");
      return newToken;
    } catch (error) {
      console.error("❌ Twitch token refresh failed:", error);
      return null;
    }
  }

  /**
   * Check if token needs refresh and refresh if necessary
   * Returns true if token is valid (after refresh if needed)
   */
  async ensureValidToken(): Promise<boolean> {
    const token = storageService.getToken(this.platform);

    if (!token) {
      return false;
    }

    // Check if token is expired or about to expire (within 5 minutes)
    const expiresAt = token.expiresAt ?? 0;
    const expirationBuffer = 5 * 60 * 1000; // 5 minutes

    if (Date.now() >= expiresAt - expirationBuffer) {
      console.debug("🔄 Twitch token expired or expiring soon, refreshing...");
      const refreshed = await this.refreshToken();
      return refreshed !== null;
    }

    // Validate token with Twitch
    const isValid = await tokenExchangeService.validateToken(this.platform, token.accessToken);

    if (!isValid) {
      console.debug("🔄 Twitch token invalid, attempting refresh...");
      const refreshed = await this.refreshToken();
      return refreshed !== null;
    }

    return true;
  }

  /**
   * Get a currently-valid access token string, refreshing if needed.
   * Single-pass equivalent of ensureValidToken() + storageService.getToken()
   * for callers that just need the string. Returns null if no token.
   * (Sibling sync getAccessToken() below returns the cached token without refreshing.)
   */
  async getValidAccessToken(): Promise<string | null> {
    const ok = await this.ensureValidToken();
    if (!ok) return null;
    const token = storageService.getToken(this.platform);
    return token?.accessToken ?? null;
  }

  /**
   * Ensure we have a valid App Access Token (Client Credentials)
   */
  async ensureAppToken(): Promise<boolean> {
    // Check if we already have a valid app token
    if (!storageService.isAppTokenExpired(this.platform)) {
      return true;
    }

    console.debug("🔄 Twitch app token missing or expired, fetching new one...");

    try {
      const token = await tokenExchangeService.getAppAccessToken(this.platform);
      storageService.saveAppToken(this.platform, token);
      return true;
    } catch (error) {
      console.error("❌ Failed to get Twitch app token:", error);
      return false;
    }
  }

  /**
   * Revoke the current token and logout
   */
  async logout(): Promise<boolean> {
    const token = storageService.getToken(this.platform);

    if (token) {
      // Revoke the token with Twitch
      await tokenExchangeService.revokeToken({
        platform: this.platform,
        token: token.accessToken,
      });
    }

    // Clear stored token and user data
    storageService.clearToken(this.platform);
    storageService.clearTwitchUser();

    return true;
  }

  /**
   * Fetch the current authenticated user's information
   */
  async fetchCurrentUser(accessToken?: string): Promise<TwitchUser | null> {
    const token = accessToken ?? storageService.getToken(this.platform)?.accessToken;

    if (!token) {
      console.warn("⚠️ No access token available for fetching user");
      return null;
    }

    try {
      const config = getOAuthConfig(this.platform);
      const response = await fetch(`${TWITCH_API_BASE}/users`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Client-Id": config.clientId,
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          console.debug("🔄 Token expired, attempting refresh...");
          const refreshed = await this.refreshToken();
          if (refreshed) {
            return this.fetchCurrentUser(refreshed.accessToken);
          }
        }
        throw new Error(`Failed to fetch user: ${response.status}`);
      }

      const data = (await response.json()) as TwitchApiResponse<TwitchApiUser>;

      if (!data.data || data.data.length === 0) {
        return null;
      }

      const apiUser = data.data[0];
      const user = this.transformUser(apiUser);

      // Update stored user data
      storageService.saveTwitchUser(user);

      return user;
    } catch (error) {
      console.error("❌ Failed to fetch Twitch user:", error);
      return null;
    }
  }

  /**
   * Transform Twitch API user to our TwitchUser format
   */
  private transformUser(apiUser: TwitchApiUser): TwitchUser {
    return {
      id: apiUser.id,
      login: apiUser.login,
      displayName: apiUser.display_name,
      profileImageUrl: apiUser.profile_image_url,
      email: apiUser.email,
      createdAt: apiUser.created_at,
      broadcasterType: apiUser.broadcaster_type,
    };
  }

  /**
   * Check if the user is currently authenticated with Twitch
   */
  isAuthenticated(): boolean {
    const token = storageService.getToken(this.platform);
    const user = storageService.getTwitchUser();
    return !!token && !!user;
  }

  /**
   * Get the current authenticated user (from storage)
   */
  getCurrentUser(): TwitchUser | null {
    return storageService.getTwitchUser();
  }

  /**
   * Get the current access token (if valid)
   */
  getAccessToken(): string | null {
    const token = storageService.getToken(this.platform);
    if (!token) return null;

    // Check if expired
    if (token.expiresAt && Date.now() >= token.expiresAt) {
      return null;
    }

    return token.accessToken;
  }
}

// ========== Export Singleton ==========

export const twitchAuthService = new TwitchAuthService();
