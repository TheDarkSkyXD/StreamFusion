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

    // Create the auth window.
    //
    // Kick gets sandbox: false because Kick.com's sign-in flow is gated by
    // Kasada's bot-detection (KP_UIDz cookies). The page's JS needs full
    // access to its own context to solve Kasada's challenges, mirror real
    // mouse/keyboard interactions, and rotate session_token on successful
    // login. KickTalk uses the same config (src/main/index.js:535). Twitch
    // OAuth has no Kasada and stays in the safer sandboxed config.
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
        sandbox: platform !== "kick",
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

      // After kick.com loads, decide whether the user is already authenticated
      // (skip straight to OAuth) or needs to sign in (auto-click + poll).
      window.webContents.once("did-finish-load", async () => {
        if (window.isDestroyed()) return;

        // Give the SPA ~1.2s to bootstrap and render the header (logged-in
        // users see avatar; anonymous users see Sign In button).
        await new Promise((resolve) => setTimeout(resolve, 1200));
        if (window.isDestroyed()) return;

        const alreadyAuthed = await this._isKickWebAuthenticated(window);
        if (alreadyAuthed) {
          console.debug(
            "✅ kick.com session already authenticated — proceeding directly to id.kick.com OAuth"
          );
          if (!window.isDestroyed()) window.loadURL(authUrl);
          return;
        }

        // Not yet authed: auto-click the Sign In button so the user lands
        // in the login modal without needing to find it themselves. Same
        // selector KickTalk uses (src/main/index.js:543).
        window.webContents
          .executeJavaScript(
            `(function() {
              let attempts = 0;
              const interval = setInterval(() => {
                attempts++;
                const el = document.querySelector('div.flex.items-center.gap-4 > button:last-child');
                if (el) { el.click(); clearInterval(interval); }
                if (attempts > 30) clearInterval(interval);
              }, 100);
            })()`
          )
          .catch(() => {});

        // Start polling for cookie rotation that signals successful sign-in.
        void this._waitForKickWebAuth(window).then((authenticated) => {
          if (!authenticated || window.isDestroyed()) return;
          console.debug(
            "🔁 Kick web auth confirmed — proceeding to id.kick.com OAuth"
          );
          window.loadURL(authUrl);
        });
      });
    } else {
      window.loadURL(authUrl);
    }

    return { window, pkce, state, redirectUri, port };
  }

  /**
   * Detect kick.com web sign-in by watching for cookie-value rotation in the
   * default session.
   *
   * Live testing on 2026-05-22 confirmed:
   *   - kick.com sets session_token AND kick_session on its initial anonymous
   *     load, BEFORE the user signs in. Presence alone gives false positives.
   *   - /api/v2/user is gated by Kasada bot-detection (KP_UIDz cookies). A
   *     programmatic fetch() from the BrowserWindow returns a Cloudflare
   *     challenge HTML page instead of JSON. We can't use API probes to
   *     verify auth state.
   *   - When the user actually completes kick.com's login form, Kick rotates
   *     session_token to a new value (Laravel-style session regeneration).
   *     That value change is the only reliable signal we have.
   *
   * Strategy: capture session_token's initial value on first poll, then watch
   * for it to differ from that baseline on subsequent polls. Rotation = login.
   * Polls every 1.5s for up to 5 minutes. Also handles the case where
   * session_token wasn't initially present (transitions on first appearance,
   * not just rotation).
   */
  private async _waitForKickWebAuth(
    window: BrowserWindow,
    maxMs = 5 * 60 * 1000
  ): Promise<boolean> {
    const start = Date.now();
    let attempts = 0;
    let baselineSessionToken: string | null = null;
    let baselineKickSession: string | null = null;
    let baselineCaptured = false;
    let lastReason = "polling-not-started";

    while (Date.now() - start < maxMs) {
      if (window.isDestroyed()) {
        console.debug(`[KickAuth] window destroyed after ${attempts} poll(s) — aborting`);
        return false;
      }
      attempts++;
      try {
        const cookies = await session.defaultSession.cookies.get({ domain: "kick.com" });
        const sessionToken = cookies.find((c) => c.name === "session_token")?.value ?? null;
        const kickSession = cookies.find((c) => c.name === "kick_session")?.value ?? null;

        if (!baselineCaptured) {
          // Wait one full poll to let kick.com finish its initial bootstrap
          // (the homepage sets anonymous cookies as it loads).
          if (attempts === 1) {
            lastReason = "capturing-baseline";
            console.debug(`[KickAuth] poll #1: baseline read pending`);
          } else {
            baselineSessionToken = sessionToken;
            baselineKickSession = kickSession;
            baselineCaptured = true;
            lastReason = "baseline-captured";
            console.debug(
              `[KickAuth] poll #${attempts}: baseline captured — session_token=${this._fp(sessionToken)} kick_session=${this._fp(kickSession)}`
            );
          }
        } else {
          const sessionTokenChanged =
            !!sessionToken && sessionToken !== baselineSessionToken;
          const kickSessionChanged =
            !!kickSession && kickSession !== baselineKickSession;

          if (sessionTokenChanged || kickSessionChanged) {
            console.debug(
              `✅ Kick web auth detected via cookie rotation after ${attempts} poll(s) (${Date.now() - start}ms): session_token ${sessionTokenChanged ? "ROTATED" : "unchanged"}, kick_session ${kickSessionChanged ? "ROTATED" : "unchanged"}`
            );
            return true;
          }
          lastReason = `cookies unchanged from baseline (session_token=${this._fp(sessionToken)})`;
          if (attempts === 3 || attempts % 10 === 0) {
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

  /** Compact fingerprint for logging cookie values without exposing the full token. */
  private _fp(value: string | null): string {
    if (!value) return "(absent)";
    if (value.length <= 12) return `"${value}"`;
    return `"${value.slice(0, 8)}…${value.slice(-4)}"`;
  }

  /**
   * Check whether the user is already authenticated on kick.com by inspecting
   * the rendered page's header. Logged-in users have an avatar / user-menu
   * trigger and no visible "Sign In" / "Sign Up" buttons; anonymous users
   * have the opposite. Used to short-circuit the polling loop when a prior
   * kick.com session is still valid — the user just signed in (or never
   * signed out) and we shouldn't make them log in again.
   *
   * Returns false on any executeJavaScript failure (Cloudflare challenge,
   * SPA not yet rendered, page destroyed) — fail-closed means we'll fall
   * through to the polling path, which is correct behavior when uncertain.
   */
  private async _isKickWebAuthenticated(window: BrowserWindow): Promise<boolean> {
    try {
      const result = await window.webContents.executeJavaScript(
        `(function() {
          const buttons = Array.from(document.querySelectorAll('button, a'));
          const hasSignIn = buttons.some((el) => /^\\s*(Sign\\s*In|Log\\s*In)\\s*$/i.test((el.textContent || '').trim()));
          const hasSignUp = buttons.some((el) => /^\\s*Sign\\s*Up\\s*$/i.test((el.textContent || '').trim()));
          const hasAvatar =
            !!document.querySelector('img[alt][src*="profile"]') ||
            !!document.querySelector('img[alt][src*="default-avatar"]') ||
            !!document.querySelector('button[aria-haspopup="menu"]') ||
            !!document.querySelector('[data-testid*="user"]');
          return !hasSignIn && !hasSignUp && hasAvatar;
        })()`
      );
      return !!result;
    } catch {
      return false;
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
