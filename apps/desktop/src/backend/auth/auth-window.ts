/**
 * Auth Window Manager
 *
 * Manages BrowserWindow popups for OAuth authentication.
 * Opens the OAuth login page and handles window lifecycle.
 */

import { BrowserWindow, session, shell } from "electron";

import type { Platform } from "../../shared/auth-types";

import {
  buildAuthorizationUrl,
  DEFAULT_CALLBACK_PORT,
  generatePkceChallenge,
  generateState,
  getRedirectUri,
  type PkceChallenge,
} from "./oauth-config";

// ========== Types ==========

export interface AuthSession {
  window: BrowserWindow | null;
  platform: Platform;
  pkce: PkceChallenge;
  state: string;
  redirectUri: string;
  port: number;
  startedAt: number;
}

export interface OpenAuthWindowResult {
  window: BrowserWindow;
  pkce: PkceChallenge;
  state: string;
  redirectUri: string;
  port: number;
}

export interface OpenAuthWindowOptions {
  port?: number;
}

// ========== Auth Window Manager Class ==========

class AuthWindowManager {
  private sessions: Map<Platform, AuthSession> = new Map();

  /**
   * Open an OAuth authentication window for a platform
   */
  openAuthWindow(platform: Platform, options: OpenAuthWindowOptions = {}): OpenAuthWindowResult {
    // Close any existing auth window for this platform
    this.closeAuthWindow(platform);

    const port = options.port ?? DEFAULT_CALLBACK_PORT;

    // Generate PKCE challenge and state
    const pkce = generatePkceChallenge();
    const state = generateState();
    const redirectUri = getRedirectUri(platform, port);

    // Build the authorization URL
    const authUrl = buildAuthorizationUrl({
      platform,
      redirectUri,
      pkce,
      state,
    });

    console.debug(`🔐 Opening auth window for ${platform}`);
    console.debug(`🔗 Redirect URI: ${redirectUri}`);

    // Create the auth window
    const window = new BrowserWindow({
      width: 500,
      height: 750,
      minWidth: 400,
      minHeight: 600,
      center: true,
      show: false, // Show when ready to avoid flicker
      title: `Sign in with ${platform.charAt(0).toUpperCase() + platform.slice(1)}`,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        // No preload needed for external OAuth pages
      },
    });

    // Store the session
    const session: AuthSession = {
      window,
      platform,
      pkce,
      state,
      redirectUri,
      port,
      startedAt: Date.now(),
    };
    this.sessions.set(platform, session);

    // Show window when ready
    window.once("ready-to-show", () => {
      window.show();
    });

    // Handle window close
    window.on("closed", () => {
      this.sessions.delete(platform);
      console.debug(`🔐 Auth window closed for ${platform}`);
    });

    // Handle external links (open in default browser)
    window.webContents.setWindowOpenHandler(({ url }) => {
      // Open external links in default browser
      if (url.startsWith("http://") || url.startsWith("https://")) {
        shell.openExternal(url);
      }
      return { action: "deny" };
    });

    // Handle navigation to localhost callback
    // Don't prevent navigation - let the local server show success/error page
    window.webContents.on("will-navigate", (_event, url) => {
      if (this.isCallbackUrl(url, port, platform)) {
        console.debug(`📥 Auth callback navigation detected for ${platform}`);
        // Let navigation proceed to localhost server
        // The server will respond with a success page that closes the window
      }
    });

    // Also check redirects
    window.webContents.on("will-redirect", (_event, url) => {
      if (this.isCallbackUrl(url, port, platform)) {
        console.debug(`📥 Auth redirect detected for ${platform}`);
        // Let redirect proceed to localhost server
      }
    });

    // When the localhost callback page loads, close the window after a delay
    window.webContents.on("did-navigate", (_event, url) => {
      if (this.isCallbackUrl(url, port, platform)) {
        console.debug(`✅ Auth callback page loaded for ${platform}`);
        // Close window after the success page displays briefly
        setTimeout(() => {
          this.closeAuthWindow(platform);
        }, 1500);
      }
    });

    // Platform-specific entry navigation:
    //
    // Twitch: load the OAuth URL directly — the Bearer token alone covers
    //   every Twitch API we need (Helix /channels/followed et al).
    //
    // Kick: load kick.com FIRST so the user signs in on kick.com (binding the
    //   `kick_session` cookie to a real user identity), then navigate the same
    //   window to id.kick.com for the OAuth handshake. Without the kick.com
    //   web session, the v2 followed-channels endpoint returns
    //   {"message":"Unauthenticated."} even with a valid Bearer token (live-
    //   tested 2026-05-22). If the user is already signed into kick.com,
    //   _waitForKickWebAuth returns immediately and the OAuth window
    //   navigates straight to id.kick.com with no visible difference from
    //   the previous single-redirect flow.
    if (platform === "kick") {
      console.debug("🌐 Loading kick.com for web sign-in (Kick OAuth flow)");
      window.loadURL("https://kick.com/");

      // Auto-click the Sign In button on the kick.com header once the page
      // is interactive. Same pattern KickTalk uses (src/main/index.js:543).
      // If Kick's UI changes the button selector, this becomes a no-op and
      // the user just clicks Sign In themselves — failure is silent.
      window.webContents.once("did-finish-load", () => {
        if (window.isDestroyed()) return;
        window.webContents
          .executeJavaScript(
            `(function() {
              let attempts = 0;
              const interval = setInterval(() => {
                attempts++;
                const el = document.querySelector('div.flex.items-center.gap-4 > button:last-child');
                if (el) {
                  el.click();
                  clearInterval(interval);
                }
                if (attempts > 30) clearInterval(interval);
              }, 100);
            })()`
          )
          .catch(() => {
            // Page can be Cloudflare-challenged; ignore — user can click manually.
          });
      });

      void this._waitForKickWebAuth(window).then((authenticated) => {
        if (!authenticated || window.isDestroyed()) return;
        console.debug("🔁 Kick web auth confirmed — proceeding to id.kick.com OAuth");
        window.loadURL(authUrl);
      });
    } else {
      window.loadURL(authUrl);
    }

    return { window, pkce, state, redirectUri, port };
  }

  /**
   * Detect kick.com web sign-in by polling the default session's cookie jar
   * for an authenticated session. KickTalk uses the same approach
   * (src/main/index.js:569-596). The fingerprint of an authenticated kick.com
   * session is the simultaneous presence of `session_token` AND `kick_session`
   * cookies — both set by Kick's normal login flow, neither set on a truly
   * fresh anonymous visit.
   *
   * Cross-checks with /api/v2/user via the window's webContents to confirm
   * the session is actually bound to a user (defends against the SSO-bridged
   * anonymous session that the previous post-OAuth detour produced, where
   * cookies were present but the v2 endpoint still returned Unauthenticated).
   *
   * Polls every 1.5s for up to 5 minutes. Returns false if the window closes
   * or the deadline elapses.
   */
  private async _waitForKickWebAuth(
    window: BrowserWindow,
    maxMs = 5 * 60 * 1000
  ): Promise<boolean> {
    const start = Date.now();
    let attempts = 0;
    let lastReason = "no-cookies";
    while (Date.now() - start < maxMs) {
      if (window.isDestroyed()) {
        console.debug(`[KickAuth] Window destroyed after ${attempts} poll(s) — aborting`);
        return false;
      }
      attempts++;
      try {
        const cookies = await session.defaultSession.cookies.get({ domain: "kick.com" });
        const hasSessionToken = cookies.some((c) => c.name === "session_token");
        const hasKickSession = cookies.some((c) => c.name === "kick_session");

        if (!hasSessionToken || !hasKickSession) {
          lastReason = `missing-cookies (session_token=${hasSessionToken} kick_session=${hasKickSession})`;
          if (attempts === 1 || attempts % 5 === 0) {
            console.debug(`[KickAuth] poll #${attempts}: ${lastReason}`);
          }
        } else {
          // Both cookies present — verify by hitting /api/v2/user via the
          // window's own context (so cookies are included). A real auth
          // returns user JSON; an anonymous SSO-bridged session returns
          // {"message":"Unauthenticated."}.
          const probe = await this._probeKickAuth(window);
          if (probe.authenticated) {
            console.debug(
              `✅ Kick web auth detected for "${probe.username}" after ${attempts} poll(s) (${Date.now() - start}ms)`
            );
            return true;
          }
          lastReason = `cookies present but /api/v2/user says ${probe.reason}`;
          if (attempts === 1 || attempts % 5 === 0) {
            console.debug(`[KickAuth] poll #${attempts}: ${lastReason}`);
          }
        }
      } catch (err) {
        lastReason = `poll error: ${err instanceof Error ? err.message : String(err)}`;
        console.debug(`[KickAuth] poll #${attempts}: ${lastReason}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    console.warn(
      `⚠️ Kick web sign-in not detected within ${Math.round(maxMs / 1000)}s — aborting OAuth handoff. Last poll reason: ${lastReason}`
    );
    return false;
  }

  private async _probeKickAuth(
    window: BrowserWindow
  ): Promise<{ authenticated: true; username: string } | { authenticated: false; reason: string }> {
    try {
      // Returns a JSON-encoded probe result so we can distinguish HTTP errors
      // from page-context fetch failures without conflating them.
      const probeJson = (await window.webContents.executeJavaScript(
        `(async () => {
          try {
            const r = await fetch('/api/v2/user', { credentials: 'include', headers: { Accept: 'application/json' } });
            const status = r.status;
            const body = await r.text().catch(() => '');
            return JSON.stringify({ status, body: body.slice(0, 300) });
          } catch (e) {
            return JSON.stringify({ status: 0, body: String(e) });
          }
        })()`
      )) as string;

      const probe = JSON.parse(probeJson) as { status: number; body: string };
      if (probe.status !== 200) {
        return { authenticated: false, reason: `status=${probe.status} body="${probe.body.slice(0, 80)}"` };
      }
      let parsed: { username?: string; user?: { username?: string } };
      try {
        parsed = JSON.parse(probe.body);
      } catch {
        return { authenticated: false, reason: `non-JSON body: "${probe.body.slice(0, 80)}"` };
      }
      const username = parsed.username ?? parsed.user?.username;
      if (username) return { authenticated: true, username };
      return {
        authenticated: false,
        reason: `200 OK but no username in body: "${probe.body.slice(0, 80)}"`,
      };
    } catch (err) {
      return {
        authenticated: false,
        reason: `probe threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Check if a URL is an OAuth callback URL
   */
  private isCallbackUrl(url: string, port: number, platform: Platform): boolean {
    return url.startsWith(`http://localhost:${port}/auth/${platform}/callback`);
  }

  /**
   * Close the auth window for a platform
   */
  closeAuthWindow(platform: Platform): void {
    const session = this.sessions.get(platform);
    if (session?.window && !session.window.isDestroyed()) {
      session.window.close();
    }
    this.sessions.delete(platform);
  }

  /**
   * Close all auth windows
   */
  closeAllAuthWindows(): void {
    for (const platform of this.sessions.keys()) {
      this.closeAuthWindow(platform);
    }
  }

  /**
   * Get the auth session for a platform
   */
  getSession(platform: Platform): AuthSession | undefined {
    return this.sessions.get(platform);
  }

  /**
   * Get the PKCE challenge for a platform's current session
   */
  getPkceChallenge(platform: Platform): PkceChallenge | undefined {
    return this.sessions.get(platform)?.pkce;
  }

  /**
   * Get the state for a platform's current session
   */
  getState(platform: Platform): string | undefined {
    return this.sessions.get(platform)?.state;
  }

  /**
   * Get the redirect URI for a platform's current session
   */
  getRedirectUri(platform: Platform): string | undefined {
    return this.sessions.get(platform)?.redirectUri;
  }

  /**
   * Validate that a state matches the current session
   */
  validateState(platform: Platform, state: string): boolean {
    const session = this.sessions.get(platform);
    if (!session) {
      return false;
    }

    // Check state matches
    if (session.state !== state) {
      console.warn(`⚠️ State mismatch for ${platform}`);
      return false;
    }

    // Check session is not too old (10 minutes max)
    const maxAge = 10 * 60 * 1000;
    if (Date.now() - session.startedAt > maxAge) {
      console.warn(`⚠️ Auth session expired for ${platform}`);
      return false;
    }

    return true;
  }

  /**
   * Check if an auth window is open for a platform
   */
  isAuthWindowOpen(platform: Platform): boolean {
    const session = this.sessions.get(platform);
    return !!session && !!session.window && !session.window.isDestroyed();
  }
}

// ========== Export Singleton ==========

export const authWindowManager = new AuthWindowManager();
