import { getOAuthConfig } from "../../../auth/oauth-config";
import { twitchAuthService } from "../../../auth/twitch-auth";
import { storageService } from "../../../services/storage-service";

import { TWITCH_API_BASE, type TwitchClientError } from "./twitch-types";

export class TwitchRequestor {
  private readonly baseUrl = "https://streamstorm.leveluptogetherbiz.workers.dev/twitch";
  private config = getOAuthConfig("twitch");

  constructor() {
    if (!this.config.clientId) {
      console.error("❌ TWITCH_CLIENT_ID is missing! Twitch API requests will fail. Check .env or build configuration.");
    }
  }

  // Retry configuration
  private readonly MAX_RETRIES = 3;
  private readonly BASE_DELAY = 1000;
  private readonly REQUEST_TIMEOUT = 15000;

  /**
   * Check if an error is retryable (transient network issues)
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      // Check for error code property (Node.js / undici errors)
      const errorWithCause = error as Error & { cause?: { code?: string }; code?: string };
      const code = errorWithCause.cause?.code || errorWithCause.code;

      // Network-level error codes that are typically transient
      const retryableCodes = [
        "ECONNRESET", // Connection reset (TLS handshake failure)
        "ETIMEDOUT", // Connection timed out
        "ENOTFOUND", // DNS lookup failed
        "ECONNREFUSED", // Connection refused
        "ENETUNREACH", // Network unreachable
        "EHOSTUNREACH", // Host unreachable
        "EPIPE", // Broken pipe
        "EAI_AGAIN", // DNS temporary failure
        "UND_ERR_CONNECT_TIMEOUT", // Undici connect timeout
        "UND_ERR_SOCKET", // Undici socket error
        "UND_ERR_HEADERS_TIMEOUT", // Undici headers timeout
        "UND_ERR_BODY_TIMEOUT", // Undici body timeout
      ];

      if (code && retryableCodes.includes(code)) {
        return true;
      }

      const message = error.message.toLowerCase();

      // Network-level errors that are typically transient
      if (
        message.includes("timeout") ||
        message.includes("network") ||
        message.includes("socket") ||
        message.includes("econnreset") ||
        message.includes("econnrefused") ||
        message.includes("enetunreach") ||
        message.includes("ehostunreach") ||
        message.includes("aborted") ||
        message.includes("disconnected") ||
        message.includes("connect timeout") ||
        message.includes("ssl") ||
        message.includes("tls") ||
        message.includes("handshake") ||
        message.includes("fetch failed")
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Make an HTTP request using Electron's net module
   * This uses Chromium's network stack which is more reliable in Electron
   * and respects system proxy settings
   */
  private async netRequest<T>(
    url: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    } = {}
  ): Promise<{ data: T; status: number; headers: Record<string, string> }> {
    const { net } = require("electron");

    return new Promise((resolve, reject) => {
      const request = net.request({
        method: options.method || "GET",
        url: url,
      });

      // Set headers
      if (options.headers) {
        for (const [key, value] of Object.entries(options.headers)) {
          request.setHeader(key, value);
        }
      }

      // Set timeout
      const timeout = setTimeout(() => {
        request.abort();
        reject(new Error(`Request timeout after ${this.REQUEST_TIMEOUT}ms`));
      }, this.REQUEST_TIMEOUT);

      request.on("response", (response: any) => {
        clearTimeout(timeout);

        const responseHeaders: Record<string, string> = {};
        const rawHeaders = response.headers || {};
        for (const [key, value] of Object.entries(rawHeaders)) {
          if (Array.isArray(value)) {
            responseHeaders[key.toLowerCase()] = value[0];
          } else if (typeof value === "string") {
            responseHeaders[key.toLowerCase()] = value;
          }
        }

        let body = "";
        response.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });

        response.on("end", () => {
          try {
            const data = body ? JSON.parse(body) : {};
            resolve({
              data: data as T,
              status: response.statusCode,
              headers: responseHeaders,
            });
          } catch (_e) {
            reject(new Error("Failed to parse JSON response"));
          }
        });

        response.on("error", (error: Error) => {
          reject(error);
        });
      });

      request.on("error", (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      });

      // Send body if present
      if (options.body) {
        request.write(options.body);
      }

      request.end();
    });
  }

  /**
   * Make an authenticated request to the Twitch API with retry logic
   * Uses Electron's net module for better network compatibility
   */
  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    // Only User Token is supported — App Token (Client Credentials) flow is
    // intentionally disabled because client secrets live on the Cloudflare Worker
    // and no /auth/twitch/app-token proxy endpoint has been created yet.
    // Callers should use GQL-based methods for unauthenticated access.
    let accessToken: string | undefined;

    const hasUserToken = await twitchAuthService.ensureValidToken();
    if (hasUserToken) {
      const userToken = storageService.getToken("twitch");
      if (userToken) {
        accessToken = userToken.accessToken;
      }
    }

    if (!accessToken) {
      throw new Error("Not authenticated with Twitch. Use GQL API for unauthenticated access.");
    }

    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      // "Client-Id": this.config.clientId, // Handled by Worker Proxy
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const response = await this.netRequest<T>(url, {
          method: (options.method as string) || "GET",
          headers,
          body: options.body as string | undefined,
        });

        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = parseInt(response.headers["retry-after"] || "60", 10);
          const error: TwitchClientError = {
            status: 429,
            message: "Rate limited by Twitch API",
            retryAfter,
          };
          console.warn(`⚠️ Twitch API rate limited, retry after ${retryAfter}s`);
          throw error;
        }

        // Handle unauthorized (try token refresh)
        if (response.status === 401) {
          console.debug("🔄 Token expired, refreshing...");
          const refreshed = await twitchAuthService.refreshToken();
          if (refreshed) {
            // Retry the request with new token
            return this.request<T>(endpoint, options);
          }
          throw new Error("Authentication failed");
        }

        // Retry on transient server errors (502, 503, 504)
        if (response.status >= 502 && response.status <= 504) {
          if (attempt < this.MAX_RETRIES) {
            const delay = this.BASE_DELAY * 2 ** attempt;
            console.warn(
              `⚠️ Twitch API server error ${response.status} (attempt ${attempt + 1}/${this.MAX_RETRIES + 1}). Retrying in ${delay}ms...`
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
        }

        if (response.status < 200 || response.status >= 300) {
          const errorData = response.data as { message?: string };
          throw new Error(errorData?.message || `Twitch API error: ${response.status}`);
        }

        return response.data;
      } catch (error) {
        lastError = error as Error;
        const isRetryable = this.isRetryableError(error);

        // Don't retry non-retryable errors or if we've exhausted retries
        if (!isRetryable || attempt === this.MAX_RETRIES) {
          console.error(`❌ Twitch API request failed: ${endpoint}`, error);
          throw error;
        }

        const delay = this.BASE_DELAY * 2 ** attempt;
        const errorMsg = (error as Error).message || "Unknown error";
        console.warn(
          `⚠️ Twitch API request failed (attempt ${attempt + 1}/${this.MAX_RETRIES + 1}). Retrying in ${delay}ms... Error: ${errorMsg}`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // Should never reach here, but just in case
    throw lastError || new Error("Request failed after retries");
  }

  /**
   * Check if the client is authenticated
   */
  isAuthenticated(): boolean {
    return twitchAuthService.isAuthenticated();
  }

  /**
   * Get the current access token
   */
  getAccessToken(): string | null {
    return twitchAuthService.getAccessToken();
  }
}
