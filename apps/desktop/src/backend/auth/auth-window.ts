/**
 * Auth Window Manager
 *
 * Manages BrowserWindow popups for OAuth authentication.
 * Opens the OAuth login page and handles window lifecycle.
 */

import { BrowserWindow, session, shell } from "electron";
import { logger } from "@backend/logging/logger";
import { persistDefaultKickWebSessionCookies } from "@backend/api/platforms/kick/kick-web-session";
import {
  installKickWebBearerCapture,
  persistKickWebBearerCandidate,
} from "@backend/api/platforms/kick/kick-web-credential";
import { sleep } from "@shared/utils/sleep";
import { Platform } from "@streamfusion/core/platform";
import { waitForWebContentsCondition } from "../services/web-contents-ready";
import {
  buildAuthorizationUrl,
  DEFAULT_CALLBACK_PORT,
  generatePkceChallenge,
  generateState,
  getRedirectUri,
  type PkceChallenge,
} from "./oauth-config";
import { HEADER_RENDERED_PREDICATE } from "./auth-header-predicate";

export { HEADER_RENDERED_PREDICATE } from "./auth-header-predicate";

export function shouldConfirmKickWebAuthentication(
  cookieRotated: boolean,
  renderedAuthenticatedState: boolean
): boolean {
  return cookieRotated && renderedAuthenticatedState;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isAuthenticatedKickWebUserPayload(value: unknown): boolean {
  if (!isUnknownRecord(value)) return false;
  const data = isUnknownRecord(value.data) ? value.data : null;
  const candidates = [
    value,
    data,
    isUnknownRecord(value.user) ? value.user : null,
    isUnknownRecord(data?.user) ? data.user : null,
  ];

  return candidates.some(
    (candidate) =>
      candidate !== null &&
      (typeof candidate.id === "number" || typeof candidate.id === "string") &&
      (typeof candidate.username === "string" || typeof candidate.slug === "string")
  );
}

export function isAuthenticatedKickWebProbe(value: unknown): boolean {
  if (!isUnknownRecord(value)) return false;
  return (
    value.accountIdentityRendered === true || isAuthenticatedKickWebUserPayload(value.userPayload)
  );
}

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
  pkce?: PkceChallenge;
  state?: string;
}

// ========== Auth Window Manager Class ==========

class AuthWindowManager {
  private async _persistCurrentKickWebSession(): Promise<number> {
    try {
      const persistedCount = await persistDefaultKickWebSessionCookies();
      const cookies = await session.defaultSession.cookies.get({ domain: "kick.com" });
      const sessionToken = cookies.find((cookie) => cookie.name === "session_token")?.value;
      if (sessionToken) persistKickWebBearerCandidate(sessionToken);
      logger.info("Auth:Window", "Kick web session persistence completed", {
        persistedCount,
      });
      return persistedCount;
    } catch (error) {
      logger.warn("Auth:Window", "Kick web session persistence failed", {
        error: error instanceof Error ? { name: error.name } : "unknown",
      });
      return 0;
    }
  }

  private sessions: Map<Platform, AuthSession> = new Map();

  /**
   * Open an OAuth authentication window for a platform
   */
  openAuthWindow(platform: Platform, options: OpenAuthWindowOptions = {}): OpenAuthWindowResult {
    // Close any existing auth window for this platform
    this.closeAuthWindow(platform);

    const port = options.port ?? DEFAULT_CALLBACK_PORT;

    // Generate PKCE challenge and state
    const pkce = options.pkce ?? generatePkceChallenge();
    const state = options.state ?? generateState();
    const redirectUri = getRedirectUri(platform, port);

    // Build the authorization URL
    const authUrl = buildAuthorizationUrl({
      platform,
      redirectUri,
      pkce,
      state,
    });

    logger.debug("Auth:Window", "Opening auth window", { platform });
    logger.debug("Auth:Window", "Redirect URI assigned", { platform, redirectUri });

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
    const authSession: AuthSession = {
      window,
      platform,
      pkce,
      state,
      redirectUri,
      port,
      startedAt: Date.now(),
    };
    this.sessions.set(platform, authSession);

    // Show window when ready
    window.once("ready-to-show", () => {
      window.show();
    });

    // Handle window close
    window.on("closed", () => {
      this.sessions.delete(platform);
      logger.debug("Auth:Window", "Auth window closed", { platform });
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
        logger.debug("Auth:Window", "Auth callback navigation detected", { platform });
        // Let navigation proceed to localhost server
        // The server will respond with a success page that closes the window
      }
    });

    // Also check redirects
    window.webContents.on("will-redirect", (_event, url) => {
      if (this.isCallbackUrl(url, port, platform)) {
        logger.debug("Auth:Window", "Auth redirect detected", { platform });
        // Let redirect proceed to localhost server
      }
    });

    // When the localhost callback page loads, close the window after a delay
    window.webContents.on("did-navigate", (_event, url) => {
      if (this.isCallbackUrl(url, port, platform)) {
        logger.debug("Auth:Window", "Auth callback page loaded", { platform });
        // Close window after the success page displays briefly
        // timer-allowlist: 1.5s success-page dwell before closing OAuth window (deliberate UX pause)
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
      installKickWebBearerCapture(session.defaultSession);
      logger.debug("Auth:Window", "Loading kick.com for web sign-in (Kick OAuth flow)");
      window.loadURL("https://kick.com/");

      // After kick.com loads, decide whether the user is already authenticated
      // (skip straight to OAuth) or needs to sign in (auto-click + poll).
      window.webContents.once("did-finish-load", async () => {
        if (window.isDestroyed()) return;

        // Wait for the header to actually render (avatar for logged-in users,
        // Sign In button for anonymous) instead of guessing ~1.2s, so the auth
        // check below runs against real DOM. On a slow machine the old fixed
        // wait could fire pre-render, fail-close to "not authed", and needlessly
        // re-prompt an already-signed-in user. Return value ignored — the auth
        // check runs either way.
        await waitForWebContentsCondition(window.webContents, HEADER_RENDERED_PREDICATE, {
          timeoutMs: 4000,
        });
        if (window.isDestroyed()) return;

        const alreadyAuthed = await this._isKickWebAuthenticated(window);
        if (alreadyAuthed) {
          logger.debug(
            "Auth:Window",
            "kick.com session already authenticated — proceeding directly to id.kick.com OAuth"
          );
          await this._persistCurrentKickWebSession();
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
              // timer-allowlist: 100ms click poll inside executeJavaScript template (runs in page DOM, not Node)
              const interval = setInterval(() => {
                attempts++;
                const buttons = Array.from(document.querySelectorAll('button, a'));
                const textualSignIn = buttons.find((button) => /^\\s*(sign|log)\\s*in\\s*$/i.test((button.textContent || '').trim()));
                const explicitSignIn = document.querySelector('[data-testid="login"], [data-testid="navbar-login"], [data-testid="login-button"]');
                const el = textualSignIn || explicitSignIn;
                if (el) { el.click(); clearInterval(interval); }
                if (attempts > 30) clearInterval(interval);
              }, 100);
            })()`
          )
          .catch(() => {});

        // Start polling for cookie rotation that signals successful sign-in.
        void this._waitForKickWebAuth(window).then((authenticated) => {
          if (!authenticated || window.isDestroyed()) return;
          logger.debug("Auth:Window", "Kick web auth confirmed — proceeding to id.kick.com OAuth");
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
        logger.debug("Auth:Window", "window destroyed during Kick web-auth polling — aborting", {
          attempts,
        });
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
            logger.debug("Auth:Window", "poll #1: baseline read pending");
          } else {
            baselineSessionToken = sessionToken;
            baselineKickSession = kickSession;
            baselineCaptured = true;
            lastReason = "baseline-captured";
            logger.debug("Auth:Window", "baseline captured", {
              attempts,
              sessionToken: this._fp(sessionToken),
              kickSession: this._fp(kickSession),
            });
          }
        } else {
          // The authenticated header can finish rendering after the initial
          // readiness wait. Existing sessions do not rotate cookies, so check
          // the account UI on every poll instead of requiring another login.
          if (await this._isKickWebAuthenticated(window)) {
            await this._persistCurrentKickWebSession();
            return true;
          }
          const sessionTokenChanged = !!sessionToken && sessionToken !== baselineSessionToken;
          const kickSessionChanged = !!kickSession && kickSession !== baselineKickSession;

          if (sessionTokenChanged || kickSessionChanged) {
            logger.debug("Auth:Window", "Kick web auth cookie rotation observed", {
              attempts,
              elapsedMs: Date.now() - start,
              sessionToken: sessionTokenChanged ? "ROTATED" : "unchanged",
              kickSession: kickSessionChanged ? "ROTATED" : "unchanged",
            });
            // Login and 2FA transitions can rotate Laravel session cookies
            // before authentication is complete. Rotation is necessary but
            // never sufficient: only the post-navigation authenticated DOM may
            // authorize the OAuth handoff.
            baselineSessionToken = sessionToken;
            baselineKickSession = kickSession;
            if (
              shouldConfirmKickWebAuthentication(true, await this._isKickWebAuthenticated(window))
            ) {
              await this._persistCurrentKickWebSession();
              return true;
            }
            lastReason = "cookie rotated while login or verification UI remained visible";
            logger.debug("Auth:Window", "Kick web auth still awaiting rendered account state", {
              attempts,
            });
          }
          lastReason = `cookies unchanged from baseline (session_token=${this._fp(sessionToken)})`;
          if (attempts === 3 || attempts % 10 === 0) {
            logger.debug("Auth:Window", "poll status", { attempts, reason: lastReason });
          }
        }
      } catch (err) {
        lastReason = `poll error: ${err instanceof Error ? err.message : String(err)}`;
        logger.debug("Auth:Window", "poll error", { attempts, reason: lastReason });
      }
      await sleep(1500);
    }
    logger.warn(
      "Auth:Window",
      `Kick web sign-in not detected within ${Math.round(maxMs / 1000)}s — aborting OAuth handoff`,
      { lastReason }
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
   * Confirm Kick website authentication with either an identity-bearing API
   * response or Kick's explicit account control. Kick currently returns HTTP
   * 200 with an empty object even for some authenticated sessions, so API
   * status alone is not sufficient proof.
   *
   * Fail closed whenever the response does not contain a recognizable user.
   */
  private async _isKickWebAuthenticated(window: BrowserWindow): Promise<boolean> {
    try {
      const result: unknown = await window.webContents.executeJavaScript(
        `(async function() {
          const hasCredentialForm = !!document.querySelector(
            'input[type="password"], input[name*="password" i], input[autocomplete="current-password"]'
          );
          const hasVerificationForm = !!document.querySelector(
            'input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="code" i], [data-testid*="otp" i], [data-testid*="two-factor" i]'
          );
          if (hasCredentialForm || hasVerificationForm) {
            return { userPayload: null, accountIdentityRendered: false };
          }
          const accountImage = document.querySelector(
            'button[data-testid="navbar-account"] img[alt]'
          );
          const accountIdentityRendered =
            (accountImage?.getAttribute('alt') || '').trim().length > 0;
          let userPayload = null;
          try {
            const response = await fetch('/api/v1/user', {
              method: 'GET',
              credentials: 'include',
              headers: { 'Accept': 'application/json' }
            });
            if (response.ok) userPayload = await response.json();
          } catch {}
          return { userPayload, accountIdentityRendered };
        })()`
      );
      return isAuthenticatedKickWebProbe(result);
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
      logger.warn("Auth:Window", "State mismatch", { platform });
      return false;
    }

    // Check session is not too old (10 minutes max)
    const maxAge = 10 * 60 * 1000;
    if (Date.now() - session.startedAt > maxAge) {
      logger.warn("Auth:Window", "Auth session expired", { platform });
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
