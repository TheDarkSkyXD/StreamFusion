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

import { logger } from "@shared/utils/cross-logger";
import {
  createOAuth2Session,
  type OAuth2RefreshOutcome,
  type OAuth2Session,
} from "@streamfusion/core/auth";
import type { AuthToken, KickUser, Platform } from "../../shared/auth-types";
import { clearPersistedKickWebBearer } from "../api/platforms/kick/kick-web-credential";
import { KICK_API_BASE } from "../api/platforms/kick/kick-types";
import { storageService } from "../services/storage-service";
import { hasCanonicalKickScopes } from "./kick-scope-validation";
import { tokenExchangeService, TokenRefreshError } from "./token-exchange";

// Cookie names that hold Cloudflare WAF clearance state. These belong to
// Cloudflare's anonymous-visitor protection layer, not the user's identity —
// preserving them across logout means the next user (or the same user re-
// logging-in) doesn't trigger a fresh WAF challenge on the first kick.com
// visit. Keep this list narrow; anything else with a kick.com / id.kick.com
// domain is treated as user-session state and cleared on logout.
const CLOUDFLARE_PRESERVE_NAMES = new Set<string>(["cf_clearance", "__cf_bm"]);
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
const MIN_REFRESH_DELAY_MS = 1000;
const TRANSIENT_BACKOFF_MS = [
  30 * 1000,
  2 * 60 * 1000,
  10 * 60 * 1000,
  45 * 60 * 1000,
  60 * 60 * 1000,
] as const;

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
      logger.debug("Auth:Kick", "Failed to enumerate cookies", {
        domain,
        error:
          err instanceof Error
            ? { name: err.name, message: err.message, stack: err.stack }
            : String(err),
      });
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
        logger.debug("Auth:Kick", "Failed to remove cookie", {
          cookieName: cookie.name,
          error:
            err instanceof Error
              ? { name: err.name, message: err.message, stack: err.stack }
              : String(err),
        });
      }
    }
  }
  logger.debug("Auth:Kick", "Cleared Kick session cookies from default partition");
}

function createKickOAuth2Session(): OAuth2Session<AuthToken> {
  return createOAuth2Session<AuthToken>({
    credentials: {
      load: async () => storageService.getToken("kick"),
      save: async (credential) => {
        storageService.saveToken("kick", credential);
      },
      clear: async () => {
        storageService.clearToken("kick");
      },
    },
    refresher: {
      refresh: async ({ credential, refreshToken }) => {
        try {
          const newToken = await tokenExchangeService.refreshToken({
            platform: "kick",
            refreshToken,
          });
          const refreshedToken: AuthToken = {
            ...newToken,
            refreshToken: newToken.refreshToken ?? credential.refreshToken,
            scope: newToken.scope ?? credential.scope,
          };
          if (!hasCanonicalKickScopes(refreshedToken.scope)) {
            return {
              kind: "transient-failure",
              cause: new Error("Kick token is missing required application scopes"),
            };
          }
          return { kind: "refreshed", credential: refreshedToken };
        } catch (cause) {
          if (cause instanceof TokenRefreshError && cause.isPermanent()) {
            return { kind: "auth-lost", reason: "refresh-rejected", cause };
          }
          return { kind: "transient-failure", cause };
        }
      },
    },
  });
}

// ========== Kick Auth Service Class ==========

class KickAuthService extends EventEmitter {
  private readonly platform: Platform = "kick";
  private readonly oauth2Session = createKickOAuth2Session();
  private refreshTimeoutId: NodeJS.Timeout | null = null;
  private consecutiveRefreshFailures = 0;

  constructor() {
    super();
    this.oauth2Session.onAuthLost(() => {
      this.cancelProactiveRefresh();
      this.emit("session-expired");
    });
  }

  /**
   * Refresh the access token using the refresh token.
   * Concurrent callers share the same in-flight promise so Kick's OAuth 2.1
   * refresh-token rotation is never triggered more than once at a time.
   */
  async refreshToken(): Promise<AuthToken | null> {
    const outcome = await this.oauth2Session.refresh();
    return this.handleRefreshOutcome(outcome);
  }

  private handleRefreshOutcome(outcome: OAuth2RefreshOutcome<AuthToken>): AuthToken | null {
    if (outcome.kind === "refreshed") {
      this.consecutiveRefreshFailures = 0;
      this.scheduleProactiveRefresh();
      logger.debug("Auth:Kick", "Kick token refreshed successfully");
      return outcome.credential;
    }

    if (outcome.kind === "unavailable") {
      logger.warn("Auth:Kick", "No refresh token available for Kick");
      return null;
    }

    const permanent = outcome.kind === "auth-lost";
    const cause = outcome.cause;
    logger[permanent ? "error" : "warn"]("Auth:Kick", "Kick token refresh failed", {
      error:
        cause instanceof Error
          ? {
              name: cause.name,
              ...(cause instanceof TokenRefreshError
                ? { status: cause.status, code: cause.code, permanent }
                : { permanent: false }),
            }
          : { permanent: false },
    });

    if (outcome.kind === "transient-failure") {
      this.consecutiveRefreshFailures += 1;
      const slot = Math.min(this.consecutiveRefreshFailures - 1, TRANSIENT_BACKOFF_MS.length - 1);
      this.scheduleRefreshIn(TRANSIENT_BACKOFF_MS[slot]);
      return null;
    }

    logger.warn("Auth:Kick", "Kick OAuth authorization was rejected");
    return null;
  }

  private scheduleRefreshIn(delayMs: number): void {
    if (this.refreshTimeoutId) clearTimeout(this.refreshTimeoutId);
    // timer-allowlist: self-rescheduling OAuth refresh chain.
    this.refreshTimeoutId = setTimeout(() => {
      this.refreshTimeoutId = null;
      void this.refreshToken();
    }, delayMs);
  }

  /** Keep Kick's rotating refresh token inside the backend and renew it before expiry. */
  scheduleProactiveRefresh(): void {
    const token = storageService.getToken(this.platform);
    if (!token?.expiresAt || !token.refreshToken) {
      this.cancelProactiveRefresh();
      return;
    }

    const fireAt = token.expiresAt - REFRESH_BUFFER_MS;
    const delayMs = Math.max(MIN_REFRESH_DELAY_MS, fireAt - Date.now());
    this.scheduleRefreshIn(delayMs);
    logger.debug("Auth:Kick", "Kick proactive refresh scheduled", {
      minutes: Math.round(delayMs / 60_000),
      tokenExpiresAt: new Date(token.expiresAt).toISOString(),
    });
  }

  cancelProactiveRefresh(): void {
    if (this.refreshTimeoutId) {
      clearTimeout(this.refreshTimeoutId);
      this.refreshTimeoutId = null;
    }
    this.consecutiveRefreshFailures = 0;
  }

  onSystemResume(): void {
    if (!storageService.getToken(this.platform)) return;
    logger.debug("Auth:Kick", "System resumed; re-evaluating Kick refresh schedule");
    this.scheduleProactiveRefresh();
  }

  /**
   * Check if token needs refresh and refresh if necessary
   */
  async ensureValidToken(): Promise<boolean> {
    const token = storageService.getToken(this.platform);

    if (!token) {
      return false;
    }
    if (!hasCanonicalKickScopes(token.scope)) {
      return false;
    }

    const expiresAt = token.expiresAt ?? 0;
    if (expiresAt > 0 && Date.now() >= expiresAt - REFRESH_BUFFER_MS) {
      logger.debug("Auth:Kick", "Kick token expired or expiring soon, refreshing");
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
    this.cancelProactiveRefresh();
    storageService.clearToken(this.platform);
    clearPersistedKickWebBearer();
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
      logger.warn("Auth:Kick", "No access token available for fetching user");
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
          logger.debug("Auth:Kick", "Token expired, attempting refresh");
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
      logger.debug("Auth:Kick", "Kick API /users response", { response: responseData });

      if (!responseData.data || responseData.data.length === 0) {
        logger.warn("Auth:Kick", "No user data returned from Kick API");
        return null;
      }

      const apiUser = responseData.data[0];
      logger.debug("Auth:Kick", "Kick user data", {
        user_id: apiUser.user_id,
        name: apiUser.name,
        profile_picture: apiUser.profile_picture,
      });

      const user = this.transformApiUser(apiUser);

      // Update stored user data
      storageService.saveKickUser(user);

      logger.debug("Auth:Kick", "Kick user fetched successfully", {
        username: user.username,
        profilePic: user.profilePic || "(none)",
      });
      return user;
    } catch (error) {
      logger.error("Auth:Kick", "Failed to fetch Kick user", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
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
    return !!token && hasCanonicalKickScopes(token.scope) && !!user;
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
    if (!token || !hasCanonicalKickScopes(token.scope)) return null;

    // Check if expired
    if (token.expiresAt && Date.now() >= token.expiresAt) {
      return null;
    }

    return token.accessToken;
  }
}

export const kickAuthService = new KickAuthService();
