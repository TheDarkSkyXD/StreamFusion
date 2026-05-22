/**
 * Auth Window Manager
 *
 * Manages BrowserWindow popups for OAuth authentication.
 * Opens the OAuth login page and handles window lifecycle.
 */

import { BrowserWindow, shell } from "electron";

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

        if (platform === "kick") {
          // Kick's official OAuth API has no followed-channels endpoint, so
          // we fetch the user's follows from kick.com/api/v2/channels/followed
          // which needs apex `kick.com` session cookies. Those cookies aren't
          // set by id.kick.com OAuth on its own. Detour the same window to
          // kick.com while the id.kick.com auth context is still fresh —
          // Kick's SPA on kick.com bootstraps and may auto-bridge an SSO
          // session via the existing id.kick.com state, landing the
          // `kick_session` cookie in the default partition where the
          // follow-endpoints BrowserWindow fallback reads from.
          console.debug("🍪 Establishing kick.com web session via post-OAuth detour...");
          window.loadURL("https://kick.com/");

          // Close after kick.com has had time to bootstrap + 2.5s buffer
          // for the SPA's async auth-bridge fetch to fire and set cookies.
          // Hard 10s deadline so a hung kick.com load can't keep the window
          // open forever.
          const closeAfter = (ms: number) => {
            setTimeout(() => this.closeAuthWindow(platform), ms);
          };

          let closedOnLoad = false;
          window.webContents.once("did-finish-load", () => {
            if (closedOnLoad) return;
            closedOnLoad = true;
            console.debug("🍪 kick.com loaded after OAuth — giving 2.5s for session bridge");
            closeAfter(2500);
          });

          // Backstop deadline.
          setTimeout(() => {
            if (!closedOnLoad) {
              closedOnLoad = true;
              console.debug("🍪 kick.com detour timed out (10s); closing auth window");
              this.closeAuthWindow(platform);
            }
          }, 10000);
        } else {
          // Twitch and others: just close after the success page displays.
          setTimeout(() => {
            this.closeAuthWindow(platform);
          }, 1500);
        }
      }
    });

    // Load the authorization URL
    window.loadURL(authUrl);

    return { window, pkce, state, redirectUri, port };
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
