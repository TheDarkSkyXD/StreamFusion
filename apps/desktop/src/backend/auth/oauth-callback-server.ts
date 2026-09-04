/**
 * OAuth Callback Server
 *
 * Creates a local HTTP server to capture OAuth callbacks.
 * This is needed because Twitch requires HTTPS for custom protocols,
 * but allows http://localhost for desktop apps.
 */

import http from "node:http";
import { URL } from "node:url";

import { logger } from "@backend/logging/logger";
import { Platform } from "@streamfusion/core/platform";

// ========== Types ==========

export interface OAuthCallbackResult {
  code: string;
  state: string;
}

export interface CallbackServerOptions {
  port?: number;
  timeout?: number; // ms
}

export interface StartedOAuthCallback {
  port: number;
  callback: Promise<OAuthCallbackResult>;
}

// ========== Constants ==========

// Default port range for the callback server
const DEFAULT_PORT = 8765;
const PORT_RANGE_SIZE = 100; // Will try ports 8765-8864

// ========== Callback Server Class ==========

class OAuthCallbackServer {
  private server: http.Server | null = null;
  private currentPort: number = DEFAULT_PORT;
  private callbackTimeout: NodeJS.Timeout | null = null;

  /**
   * Get the redirect URI for a platform
   */
  getRedirectUri(platform: Platform): string {
    return `http://localhost:${this.currentPort}/auth/${platform}/callback`;
  }

  /**
   * Start the callback server and wait for the OAuth callback
   */
  async waitForCallback(
    platform: Platform,
    expectedState: string,
    options: CallbackServerOptions = {}
  ): Promise<OAuthCallbackResult> {
    const pending = await this.start(platform, expectedState, options);
    return pending.callback;
  }

  /** Bind the callback listener before an authorization URL is opened. */
  async start(
    platform: Platform,
    expectedState: string,
    options: CallbackServerOptions = {}
  ): Promise<StartedOAuthCallback> {
    const timeout = options.timeout ?? 5 * 60 * 1000; // 5 minute default
    const port = options.port ?? DEFAULT_PORT;

    let resolveStarted!: (started: StartedOAuthCallback) => void;
    let rejectStarted!: (error: Error) => void;
    const started = new Promise<StartedOAuthCallback>((resolve, reject) => {
      resolveStarted = resolve;
      rejectStarted = reject;
    });

    const callback = new Promise<OAuthCallbackResult>((resolve, reject) => {
      let resolved = false;

      // Create the server
      this.server = http.createServer((req, res) => {
        try {
          const url = new URL(req.url || "", `http://localhost:${port}`);

          // Check if this is the callback path
          if (url.pathname === `/auth/${platform}/callback`) {
            const code = url.searchParams.get("code");
            const state = url.searchParams.get("state");
            const error = url.searchParams.get("error");
            const errorDescription = url.searchParams.get("error_description");

            // Send response to browser
            res.writeHead(200, { "Content-Type": "text/html" });

            if (error) {
              res.end(`
                                <!DOCTYPE html>
                                <html>
                                <head>
                                    <meta charset="UTF-8">
                                    <title>Authentication Failed</title>
                                </head>
                                <body style="font-family: system-ui; text-align: center; padding: 50px; background: #ef4444; color: white; min-height: 100vh; margin: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                                    <h1>Authentication Failed</h1>
                                    <p style="opacity: 0.9;">${errorDescription || error}</p>
                                    <p style="opacity: 0.8;">You can close this window.</p>
                                </body>
                                </html>
                            `);

              if (!resolved) {
                resolved = true;
                this.stop();
                reject(new Error(errorDescription || error || "Authentication failed"));
              }
              return;
            }

            if (!code || !state) {
              res.end(`
                                <!DOCTYPE html>
                                <html>
                                <head>
                                    <meta charset="UTF-8">
                                    <title>Authentication Failed</title>
                                </head>
                                <body style="font-family: system-ui; text-align: center; padding: 50px; background: #ef4444; color: white; min-height: 100vh; margin: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                                    <h1>Invalid Callback</h1>
                                    <p style="opacity: 0.9;">Missing authorization code or state.</p>
                                    <p style="opacity: 0.8;">You can close this window.</p>
                                </body>
                                </html>
                            `);

              if (!resolved) {
                resolved = true;
                this.stop();
                reject(new Error("Invalid callback: missing code or state"));
              }
              return;
            }

            // Validate state
            if (state !== expectedState) {
              res.end(`
                                <!DOCTYPE html>
                                <html>
                                <head>
                                    <meta charset="UTF-8">
                                    <title>Authentication Failed</title>
                                </head>
                                <body style="font-family: system-ui; text-align: center; padding: 50px; background: #ef4444; color: white; min-height: 100vh; margin: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                                    <h1>Security Error</h1>
                                    <p style="opacity: 0.9;">State mismatch - possible CSRF attack.</p>
                                    <p style="opacity: 0.8;">You can close this window.</p>
                                </body>
                                </html>
                            `);

              if (!resolved) {
                resolved = true;
                this.stop();
                reject(new Error("State mismatch"));
              }
              return;
            }

            // Success!
            // Use platform-specific colors
            const bgColor =
              platform === "twitch" ? "#9146FF" : platform === "kick" ? "#53FC18" : "#1a1a2e";
            const spinnerColor =
              platform === "twitch" ? "#ffffff" : platform === "kick" ? "#1a1a2e" : "#9146ff";
            const textColor = platform === "kick" ? "#1a1a2e" : "#ffffff";

            res.end(`
                            <!DOCTYPE html>
                            <html>
                            <head>
                                <meta charset="UTF-8">
                                <title>Connected!</title>
                                <style>
                                    body {
                                        font-family: system-ui, -apple-system, sans-serif;
                                        text-align: center;
                                        padding: 50px;
                                        background: ${bgColor};
                                        color: ${textColor};
                                        min-height: 100vh;
                                        margin: 0;
                                        display: flex;
                                        flex-direction: column;
                                        align-items: center;
                                        justify-content: center;
                                    }
                                    h1 { font-size: 2rem; margin-bottom: 16px; }
                                    p { color: ${textColor}; opacity: 0.8; margin: 8px 0; }
                                    .spinner {
                                        width: 40px;
                                        height: 40px;
                                        border: 3px solid rgba(255,255,255,0.3);
                                        border-top-color: ${spinnerColor};
                                        border-radius: 50%;
                                        animation: spin 1s linear infinite;
                                        margin: 20px auto;
                                    }
                                    @keyframes spin { to { transform: rotate(360deg); } }
                                </style>
                            </head>
                            <body>
                                <h1>Connected to ${platform}!</h1>
                                <div class="spinner"></div>
                                <p>Completing authentication...</p>
                                <p style="font-size: 12px;">This window will close automatically.</p>
                            </body>
                            </html>
                        `);

            if (!resolved) {
              resolved = true;
              this.stop();
              resolve({ code, state });
            }
          } else {
            // Not the callback path
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not found");
          }
        } catch (error) {
          logger.error("Auth:OAuthCallback", "Error handling callback", {
            error:
              error instanceof Error
                ? { name: error.name, message: error.message, stack: error.stack }
                : String(error),
          });
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("Internal server error");
        }
      });

      // Handle server errors
      this.server.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") {
          // Port in use, try next port
          this.currentPort++;
          if (this.currentPort < port + PORT_RANGE_SIZE) {
            logger.debug("Auth:OAuthCallback", "Port in use, trying next", {
              port,
              nextPort: this.currentPort,
            });
            this.server?.close();
            this.server?.listen(this.currentPort);
          } else {
            const unavailable = new Error("No available ports for OAuth callback server");
            resolved = true;
            rejectStarted(unavailable);
            reject(unavailable);
          }
        } else {
          resolved = true;
          rejectStarted(error);
          reject(error);
        }
      });

      // Start listening
      this.currentPort = port;
      this.server.listen(port, () => {
        logger.debug("Auth:OAuthCallback", "OAuth callback server listening", {
          url: `http://localhost:${this.currentPort}`,
        });
        resolveStarted({ port: this.currentPort, callback });
      });

      // Set timeout
      // timer-allowlist: raw new Promise reject timeout for callback-server wait (no fetch/AbortSignal integration)
      this.callbackTimeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.stop();
          reject(new Error("OAuth timeout - no callback received"));
        }
      }, timeout);
    });

    return started;
  }

  /**
   * Stop the callback server
   */
  stop(): void {
    if (this.callbackTimeout) {
      clearTimeout(this.callbackTimeout);
      this.callbackTimeout = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
      logger.debug("Auth:OAuthCallback", "OAuth callback server stopped");
    }
  }

  /**
   * Get the current port
   */
  getPort(): number {
    return this.currentPort;
  }
}

// ========== Export Singleton ==========

export const oauthCallbackServer = new OAuthCallbackServer();
