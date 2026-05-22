/**
 * Kick Authentication Service
 *
 * Handles Kick-specific authentication operations including:
 * - Token refresh
 * - Token revocation (logout)
 * - User info fetching
 *
 * Uses the official Kick Public API v1: https://docs.kick.com/
 */

import { EventEmitter } from "node:events";

import { session } from "electron";

import type { AuthToken, KickUser, Platform } from "../../shared/auth-types";
import { KICK_API_BASE } from "../api/platforms/kick/kick-types";
import { storageService } from "../services/storage-service";

import { tokenExchangeService } from "./token-exchange";

// Cookie names that hold Cloudflare WAF clearance state. These belong to
// Cloudflare's anonymous-visitor protection layer, not the user's identity —
// preserving them across logout means the next user (or the same user re-
// logging-in) doesn't trigger a fresh WAF challenge on the first kick.com
// visit. Keep this list narrow; anything else with a kick.com / id.kick.com
// domain is treated as user-session state and cleared on logout.
const CLOUDFLARE_PRESERVE_NAMES = new Set<string>(["cf_clearance", "__cf_bm"]);

/**
 * Clear the kick.com / id.kick.com session cookies from Electron's default
 * session — where the Kick OAuth flow deposits id.kick.com cookies and where
 * the follow-endpoints BrowserWindow fallback reads them from. Preserves the
 * Cloudflare clearance cookies so the next kick.com visit doesn't trigger a
 * fresh WAF challenge.
 *
 * Safe to call when no cookies are present (no-op). Errors during individual
 * cookie removal are logged at debug level and do not abort the rest of the
 * clear — a stuck cookie shouldn't block logout.
 */
async function clearKickSessionCookies(): Promise<void> {
  const defaultSession = session.defaultSession;
  const domains = [".kick.com", "kick.com", "id.kick.com", ".id.kick.com"];

  for (const domain of domains) {
    let cookies;
    try {
      cookies = await defaultSession.cookies.get({ domain });
    } catch (err) {
      console.debug(`[kickAuth] Failed to enumerate cookies for ${domain}:`, err);
      continue;
    }

    for (const cookie of cookies) {
      if (CLOUDFLARE_PRESERVE_NAMES.has(cookie.name)) continue;

      // Reconstruct the URL the cookie was set against. The leading-dot
      // domain form ('.kick.com') needs to be stripped to form a valid URL.
      const cookieDomain = cookie.domain?.replace(/^\./, "") ?? "";
      if (!cookieDomain) continue;
      const protocol = cookie.secure ? "https" : "http";
      const url = `${protocol}://${cookieDomain}${cookie.path ?? "/"}`;

      try {
        await defaultSession.cookies.remove(url, cookie.name);
      } catch (err) {
        console.debug(`[kickAuth] Failed to remove cookie ${cookie.name}:`, err);
      }
    }
  }
  console.debug("🍪 Cleared Kick session cookies from default partition");
}

// ========== Kick Auth Service Class ==========

class KickAuthService extends EventEmitter {
  private readonly platform: Platform = "kick";

  /** Deduplicates concurrent refresh calls — set while a refresh is in flight */
  private refreshPromise: Promise<AuthToken | null> | null = null;

  /**
   * Internal token refresh implementation.
   * Clears auth state and emits 'session-expired' on permanent OAuth failure.
   */
  private async _doRefresh(): Promise<AuthToken | null> {
    const currentToken = storageService.getToken(this.platform);

    if (!currentToken?.refreshToken) {
      console.warn("⚠️ No refresh token available for Kick");
      return null;
    }

    try {
      const newToken = await tokenExchangeService.refreshToken({
        platform: this.platform,
        refreshToken: currentToken.refreshToken,
      });

      storageService.saveToken(this.platform, newToken);
      console.debug("✅ Kick token refreshed successfully");
      return newToken;
    } catch (error) {
      console.error("❌ Kick token refresh failed:", error);

      // Any server-side OAuth error (401 invalid/revoked/expired refresh token)
      // means the stored credentials are permanently invalid. Clear them so the
      // app doesn't keep silently falling back to the public API, and notify the
      // renderer so the user can re-authenticate.
      storageService.clearToken(this.platform);
      storageService.clearKickUser();
      await clearKickSessionCookies();
      this.emit("session-expired");
      console.warn("⚠️ Kick session cleared — user must re-authenticate");
      return null;
    }
  }

  /**
   * Refresh the access token using the refresh token.
   * Concurrent callers share the same in-flight promise so Kick's OAuth 2.1
   * refresh-token rotation is never triggered more than once at a time.
   */
  async refreshToken(): Promise<AuthToken | null> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    this.refreshPromise = this._doRefresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  /**
   * Check if token needs refresh and refresh if necessary
   */
  async ensureValidToken(): Promise<boolean> {
    const token = storageService.getToken(this.platform);

    if (!token) {
      return false;
    }

    const expiresAt = token.expiresAt ?? 0;
    const expirationBuffer = 5 * 60 * 1000; // 5 minutes

    if (expiresAt > 0 && Date.now() >= expiresAt - expirationBuffer) {
      console.debug("🔄 Kick token expired or expiring soon, refreshing...");
      const refreshed = await this.refreshToken();
      return refreshed !== null;
    }

    return true;
  }

  /**
   * Logout and clear local data + kick.com session cookies from the default
   * Electron session. Kick has no formal OAuth revoke endpoint, so this is
   * the only way to ensure the next user on the same machine doesn't inherit
   * authenticated state. Preserves Cloudflare WAF clearance cookies.
   */
  async logout(): Promise<boolean> {
    storageService.clearToken(this.platform);
    storageService.clearKickUser();
    await clearKickSessionCookies();

    return true;
  }

  /**
   * Fetch the current authenticated user's information
   * Uses the official Kick Dev API: GET /users returns current user when no IDs specified
   */
  async fetchCurrentUser(accessToken?: string): Promise<KickUser | null> {
    const token = accessToken ?? storageService.getToken(this.platform)?.accessToken;

    if (!token) {
      console.warn("⚠️ No access token available for fetching user");
      return null;
    }

    try {
      // Official Kick API endpoint: GET /users returns current user info
      const response = await fetch(`${KICK_API_BASE}/users`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
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

      // Official API response format: { data: [{ user_id, name, email, profile_picture }], message: "..." }
      const responseData = (await response.json()) as {
        data: Array<{
          user_id: number;
          name: string;
          email?: string;
          profile_picture?: string;
        }>;
        message?: string;
      };

      // Log the raw response for debugging
      console.debug("📥 Kick API /users response:", JSON.stringify(responseData, null, 2));

      if (!responseData.data || responseData.data.length === 0) {
        console.warn("⚠️ No user data returned from Kick API");
        return null;
      }

      const apiUser = responseData.data[0];
      console.debug("📥 Kick user data:", {
        user_id: apiUser.user_id,
        name: apiUser.name,
        profile_picture: apiUser.profile_picture,
      });

      const user = this.transformApiUser(apiUser);

      // Update stored user data
      storageService.saveKickUser(user);

      console.debug(
        "✅ Kick user fetched successfully:",
        user.username,
        "Profile pic:",
        user.profilePic || "(none)"
      );
      return user;
    } catch (error) {
      console.error("❌ Failed to fetch Kick user:", error);
      return null;
    }
  }

  /**
   * Transform official Kick API user response to our KickUser format
   */
  private transformApiUser(apiUser: {
    user_id: number;
    name: string;
    email?: string;
    profile_picture?: string;
  }): KickUser {
    return {
      id: apiUser.user_id,
      username: apiUser.name,
      slug: apiUser.name.toLowerCase().replace(/\s+/g, "-"), // Derive slug from name
      verified: !!apiUser.email, // If email is present, user is likely verified
      email: apiUser.email,
      profilePic: apiUser.profile_picture || "",
      // These fields are not available from official API
      bio: undefined,
      twitter: undefined,
      discord: undefined,
      instagram: undefined,
      youtube: undefined,
      tiktok: undefined,
      facebook: undefined,
    };
  }

  /**
   * Check if the user is currently authenticated with Kick
   */
  isAuthenticated(): boolean {
    const token = storageService.getToken(this.platform);
    const user = storageService.getKickUser();
    return !!token && !!user;
  }

  /**
   * Get the current authenticated user (from storage)
   */
  getCurrentUser(): KickUser | null {
    return storageService.getKickUser();
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

  /**
   * Get the current app access token (if valid)
   */
  getAppAccessToken(): string | null {
    const token = storageService.getAppToken(this.platform);
    if (!token) return null;

    // Check if expired
    if (token.expiresAt && Date.now() >= token.expiresAt) {
      return null;
    }

    return token.accessToken;
  }

  /**
   * Check if app token needs refresh and refresh if necessary
   */
  async ensureValidAppToken(): Promise<boolean> {
    const token = storageService.getAppToken(this.platform);

    // If no token or expired, get a new one
    if (!token || storageService.isAppTokenExpired(this.platform)) {
      console.debug("🔄 Kick App token missing or expired, fetching new one...");
      try {
        // We use tokenExchangeService which handles client_credentials grant
        const newToken = await tokenExchangeService.getAppAccessToken(this.platform);
        storageService.saveAppToken(this.platform, newToken);
        return true;
      } catch (error) {
        console.error("❌ Failed to get Kick App Token:", error);
        return false;
      }
    }

    return true;
  }
}

export const kickAuthService = new KickAuthService();
