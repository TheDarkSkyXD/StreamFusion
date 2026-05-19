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
import { tokenExchangeService, TokenRefreshError } from "./token-exchange";

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

// Schedule the next proactive refresh five minutes before expiry. The
// reactive paths (TwitchRequestor's pre-call check + 401 retry) already
// cover active users; this timer covers the long-idle case where Twitch
// IRC and EventSub get their underlying token expired out from under them.
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
// Twitch can serve 401 a few seconds before the documented expires_at on
// edge nodes. Don't schedule a refresh closer than this to the wall clock —
// fire immediately instead.
const MIN_REFRESH_DELAY_MS = 1000;

// Exponential backoff for transient refresh failures (network blip, 5xx,
// 408, 429). After the fifth consecutive transient failure we give up and
// treat the chain as broken — at that point the underlying token has
// expired anyway, so further auto-retries are noise rather than recovery.
// Delays span ~58 minutes of automatic retries before bailing.
const TRANSIENT_BACKOFF_MS = [
  30 * 1000,        // 30s
  2 * 60 * 1000,    // 2m
  10 * 60 * 1000,   // 10m
  45 * 60 * 1000,   // 45m
];
const MAX_TRANSIENT_FAILURES = TRANSIENT_BACKOFF_MS.length + 1;

// ========== Twitch Auth Service Class ==========

class TwitchAuthService {
  private readonly platform: Platform = "twitch";
  private refreshTimeoutId: NodeJS.Timeout | null = null;
  private consecutiveRefreshFailures = 0;
  private authLostHandler: (() => void) | null = null;

  /**
   * Register a callback fired exactly once when the refresh chain dies
   * permanently (invalid_grant from Twitch, or 5 consecutive transient
   * failures over ~58 minutes of backoff). The renderer subscribes through
   * IPC and flips the auth-store to a "please reconnect" state.
   */
  setAuthLostHandler(handler: () => void): void {
    this.authLostHandler = handler;
  }

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
      this.invalidateAuth();
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

      // Successful refresh — reset the transient-failure counter and chain
      // the next proactive refresh against the freshly-rotated expiry.
      this.consecutiveRefreshFailures = 0;
      this.scheduleProactiveRefresh();

      return newToken;
    } catch (error) {
      const isTokenRefreshError = error instanceof TokenRefreshError;
      const permanent = isTokenRefreshError && error.isPermanent();

      if (permanent) {
        console.error(
          "❌ Twitch refresh token rejected by Twitch (permanent failure) — clearing stored credentials and prompting re-login.",
          error,
        );
        this.invalidateAuth();
        return null;
      }

      this.consecutiveRefreshFailures += 1;
      if (this.consecutiveRefreshFailures >= MAX_TRANSIENT_FAILURES) {
        console.error(
          `❌ Twitch token refresh failed ${this.consecutiveRefreshFailures} consecutive times — giving up and prompting re-login.`,
          error,
        );
        this.invalidateAuth();
        return null;
      }

      // Transient failure — schedule a retry with exponential backoff. The
      // delay index maps directly to (failures - 1).
      const backoffMs = TRANSIENT_BACKOFF_MS[this.consecutiveRefreshFailures - 1];
      console.warn(
        `⚠️ Twitch token refresh failed (attempt ${this.consecutiveRefreshFailures}/${MAX_TRANSIENT_FAILURES}). Retrying in ${Math.round(backoffMs / 1000)}s.`,
        error,
      );
      this.scheduleRefreshIn(backoffMs);
      return null;
    }
  }

  /**
   * Permanent-failure path: drop the dead token, stop the chain, and tell
   * the renderer to ask the user to reconnect. Idempotent — re-fires safely
   * if called twice (handler only invokes once thanks to the null guard).
   */
  private invalidateAuth(): void {
    this.cancelProactiveRefresh();
    this.consecutiveRefreshFailures = 0;
    storageService.clearToken(this.platform);
    storageService.clearTwitchUser();
    const handler = this.authLostHandler;
    if (handler) {
      try {
        handler();
      } catch (err) {
        console.warn("Auth-lost handler threw:", err);
      }
    }
  }

  /**
   * Schedule a refresh exactly `delayMs` from now. Internal — the public
   * surface is scheduleProactiveRefresh (which derives the delay from the
   * stored token's expiry).
   */
  private scheduleRefreshIn(delayMs: number): void {
    if (this.refreshTimeoutId) {
      clearTimeout(this.refreshTimeoutId);
    }
    this.refreshTimeoutId = setTimeout(() => {
      this.refreshTimeoutId = null;
      this.refreshToken().catch((err) => {
        console.warn("Proactive Twitch refresh failed:", err);
      });
    }, delayMs);
  }

  /**
   * Schedule the next proactive refresh. Called from:
   *   - app startup (so an idle session never lets the token silently expire)
   *   - after every successful OAuth callback (new login → first scheduling)
   *   - after every successful refresh (chain the next iteration)
   *
   * Safe to call repeatedly — any pending timer is cleared first. If the token
   * is already expired or expires within the buffer, fires immediately.
   * No-ops when there is no stored token (logout path).
   */
  scheduleProactiveRefresh(): void {
    const token = storageService.getToken(this.platform);
    if (!token || !token.expiresAt) {
      this.cancelProactiveRefresh();
      return;
    }

    const now = Date.now();
    const fireAt = token.expiresAt - REFRESH_BUFFER_MS;
    const delay = Math.max(MIN_REFRESH_DELAY_MS, fireAt - now);

    this.scheduleRefreshIn(delay);

    const minutes = Math.round(delay / 60_000);
    console.debug(
      `⏰ Twitch proactive refresh scheduled in ${minutes}m (token expires at ${new Date(token.expiresAt).toISOString()})`
    );
  }

  /**
   * Cancel any pending proactive refresh. Called on logout — without this the
   * timer would fire after the user has signed out and try to refresh a
   * cleared token.
   */
  cancelProactiveRefresh(): void {
    if (this.refreshTimeoutId) {
      clearTimeout(this.refreshTimeoutId);
      this.refreshTimeoutId = null;
    }
    this.consecutiveRefreshFailures = 0;
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
    // Stop any pending proactive refresh first — the token is about to be
    // cleared and a fired timer would otherwise try to refresh nothing.
    this.cancelProactiveRefresh();

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
