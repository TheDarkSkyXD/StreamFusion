/**
 * Protocol Handler
 *
 * Handles the custom `streamfusion://` protocol for OAuth callbacks.
 * Registers the protocol with the OS and captures OAuth redirects.
 */

import { app, BrowserWindow } from "electron";

import type { Platform } from "../../shared/auth-types";

import { PROTOCOL_PREFIX, PROTOCOL_SCHEME } from "./oauth-config";

// ========== Types ==========

export interface OAuthCallback {
  platform: Platform;
  code: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}

export type OAuthCallbackHandler = (callback: OAuthCallback) => void;

// ========== Protocol Handler Class ==========

class ProtocolHandler {
  private callbackHandlers: Map<Platform, OAuthCallbackHandler> = new Map();
  private isRegistered: boolean = false;

  /**
   * Register the custom protocol with the operating system
   * Must be called before app is ready for production builds,
   * but works after ready in development
   */
  registerProtocol(): boolean {
    if (this.isRegistered) {
      console.debug("🔗 Protocol already registered");
      return true;
    }

    try {
      // Register as the default protocol handler for streamfusion://
      // This will handle URLs like streamfusion://auth/twitch/callback?code=xxx
      if (process.defaultApp) {
        // In development (running with electron .)
        if (process.argv.length >= 2) {
          app.setAsDefaultProtocolClient(PROTOCOL_SCHEME, process.execPath, [process.argv[1]]);
        }
      } else {
        // In production (packaged app)
        app.setAsDefaultProtocolClient(PROTOCOL_SCHEME);
      }

      this.isRegistered = true;
      console.debug(`✅ Registered protocol: ${PROTOCOL_SCHEME}://`);

      // Handle protocol URLs on Windows and Linux
      this.setupProtocolUrlHandler();

      return true;
    } catch (error) {
      console.error("❌ Failed to register protocol:", error);
      return false;
    }
  }

  /**
   * Unregister the custom protocol
   */
  unregisterProtocol(): void {
    if (this.isRegistered) {
      app.removeAsDefaultProtocolClient(PROTOCOL_SCHEME);
      this.isRegistered = false;
      console.debug(`🗑️ Unregistered protocol: ${PROTOCOL_SCHEME}://`);
    }
  }

  /**
   * Set up handlers for protocol URLs
   * On Windows and Linux, the URL comes through second-instance or open-url event
   * On macOS, it comes through open-url event
   */
  private setupProtocolUrlHandler(): void {
    // macOS: Handle protocol URLs via open-url event
    app.on("open-url", (event, url) => {
      event.preventDefault();
      this.handleProtocolUrl(url);
    });

    // Windows/Linux: Handle protocol URLs when app is already running
    // The second instance will pass the URL to the first instance
    const gotTheLock = app.requestSingleInstanceLock();

    if (!gotTheLock) {
      // Another instance is running, quit this one
      app.quit();
    } else {
      app.on("second-instance", (_event, commandLine) => {
        // Someone tried to run a second instance, we should focus our window
        const mainWindow = BrowserWindow.getAllWindows()[0];
        if (mainWindow) {
          if (mainWindow.isMinimized()) {
            mainWindow.restore();
          }
          mainWindow.focus();
        }

        // Find the protocol URL in command line arguments
        const url = commandLine.find((arg) => arg.startsWith(PROTOCOL_PREFIX));
        if (url) {
          this.handleProtocolUrl(url);
        }
      });
    }

    // Also check if app was opened via protocol URL on startup
    const url = process.argv.find((arg) => arg.startsWith(PROTOCOL_PREFIX));
    if (url) {
      // Delay slightly to ensure handlers are registered
      setImmediate(() => this.handleProtocolUrl(url));
    }
  }

  /**
   * Handle an incoming protocol URL
   * Parses the URL and calls the appropriate callback handler
   */
  handleProtocolUrl(url: string): void {
    console.debug(`📥 Received protocol URL: ${url}`);

    try {
      const parsed = new URL(url);

      // Expected format: streamfusion://auth/{platform}/callback?code=xxx&state=xxx
      const pathParts = parsed.pathname.split("/").filter(Boolean);

      if (pathParts.length < 2 || pathParts[0] !== "auth") {
        console.warn("⚠️ Invalid protocol URL path:", parsed.pathname);
        return;
      }

      const platform = pathParts[1] as Platform;

      // Validate platform
      if (platform !== "twitch" && platform !== "kick") {
        console.warn("⚠️ Unknown platform in callback:", platform);
        return;
      }

      // Parse query parameters
      const code = parsed.searchParams.get("code");
      const state = parsed.searchParams.get("state");
      const error = parsed.searchParams.get("error");
      const errorDescription = parsed.searchParams.get("error_description");

      const callback: OAuthCallback = {
        platform,
        code: code || "",
        state: state || undefined,
        error: error || undefined,
        errorDescription: errorDescription || undefined,
      };

      // Check for errors from OAuth provider
      if (callback.error) {
        console.error(`❌ OAuth error for ${platform}:`, callback.error, callback.errorDescription);
      }

      // Call the registered handler for this platform
      const handler = this.callbackHandlers.get(platform);
      if (handler) {
        handler(callback);
      } else {
        console.warn(`⚠️ No handler registered for platform: ${platform}`);
      }
    } catch (error) {
      console.error("❌ Failed to parse protocol URL:", error);
    }
  }

  /**
   * Register a callback handler for a platform
   */
  onCallback(platform: Platform, handler: OAuthCallbackHandler): void {
    this.callbackHandlers.set(platform, handler);
    console.debug(`📝 Registered callback handler for ${platform}`);
  }

  /**
   * Remove a callback handler for a platform
   */
  offCallback(platform: Platform): void {
    this.callbackHandlers.delete(platform);
  }

  /**
   * Check if the protocol is registered
   */
  get registered(): boolean {
    return this.isRegistered;
  }
}

// ========== Export Singleton ==========

export const protocolHandler = new ProtocolHandler();
