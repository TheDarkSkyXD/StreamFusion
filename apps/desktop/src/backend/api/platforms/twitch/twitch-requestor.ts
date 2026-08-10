import { logger } from "@/backend/logging/logger";
import { sleep } from "@/lib/sleep";
import { getOAuthConfig } from "../../../auth/oauth-config";
import { twitchAuthService } from "../../../auth/twitch-auth";
import type { PlatformFailureClass } from "../../unified/platform-health";
import { recordPlatformFailure, recordPlatformSuccess } from "../../unified/platform-health";
import { TWITCH_API_BASE, type TwitchClientError } from "./twitch-types";

export class TwitchRequestor {
  private readonly baseUrl = TWITCH_API_BASE;
  private config = getOAuthConfig("twitch");

  constructor() {
    if (!this.config.clientId) {
      logger.error(
        "Twitch:Requestor",
        "TWITCH_CLIENT_ID is missing! Twitch API requests will fail. Check .env or build configuration."
      );
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

    const response = await net.fetch(url, {
      method: options.method || "GET",
      headers: options.headers,
      body: options.body,
      signal: AbortSignal.timeout(this.REQUEST_TIMEOUT),
    });

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value: string, key: string) => {
      responseHeaders[key.toLowerCase()] = value;
    });

    const text = await response.text();
    let data: T;
    try {
      data = text ? (JSON.parse(text) as T) : ({} as T);
    } catch (_e) {
      throw new Error("Failed to parse JSON response");
    }

    return { data, status: response.status, headers: responseHeaders };
  }

  /**
   * Make an authenticated request to the Twitch API with retry logic
   * Uses Electron's net module for better network compatibility
   */
  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    // Only user tokens are supported. Public browsing continues to use the
    // existing unauthenticated GQL path.
    const accessToken = await twitchAuthService.getValidAccessToken();

    if (!accessToken) {
      throw new Error("Not authenticated with Twitch. Use GQL API for unauthenticated access.");
    }

    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
      Authorization: `Bearer ${accessToken}`,
      "Client-Id": this.config.clientId,
      "Content-Type": "application/json",
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
          logger.warn("Twitch:Requestor", "Twitch API rate limited", { retryAfter });
          throw error;
        }

        // Handle unauthorized (try token refresh)
        if (response.status === 401) {
          logger.debug("Twitch:Requestor", "Token expired, refreshing");
          const refreshed = await twitchAuthService.refreshToken();
          if (refreshed) {
            // Retry the request with new token
            return this.request<T>(endpoint, options);
          }
          throw new Error("Authentication failed");
        }

        // Retry on transient server errors (500-504)
        if (response.status >= 500 && response.status <= 504) {
          if (attempt < this.MAX_RETRIES) {
            const delay = this.BASE_DELAY * 2 ** attempt;
            logger.warn("Twitch:Requestor", "Twitch API server error, retrying", {
              status: response.status,
              attempt: attempt + 1,
              maxAttempts: this.MAX_RETRIES + 1,
              delayMs: delay,
            });
            await sleep(delay);
            continue;
          }
        }

        if (response.status < 200 || response.status >= 300) {
          const errorData = response.data as { message?: string };
          throw new Error(errorData?.message || `Twitch API error: ${response.status}`);
        }

        recordPlatformSuccess("twitch");
        return response.data;
      } catch (error) {
        lastError = error as Error;
        const isRetryable = this.isRetryableError(error);

        // Don't retry non-retryable errors or if we've exhausted retries
        if (!isRetryable || attempt === this.MAX_RETRIES) {
          const failureClass = this.classifyErrorForHealth(error);
          if (failureClass) recordPlatformFailure("twitch", failureClass);

          logger.error("Twitch:Requestor", "Twitch API request failed", {
            endpoint,
            error:
              error instanceof Error
                ? { name: error.name, message: error.message, stack: error.stack }
                : String(error),
          });
          throw error;
        }

        const delay = this.BASE_DELAY * 2 ** attempt;
        const errorMsg = (error as Error).message || "Unknown error";
        logger.warn("Twitch:Requestor", "Twitch API request failed, retrying", {
          attempt: attempt + 1,
          maxAttempts: this.MAX_RETRIES + 1,
          delayMs: delay,
          errorMessage: errorMsg,
        });
        await sleep(delay);
      }
    }

    // Should never reach here, but just in case
    throw lastError || new Error("Request failed after retries");
  }

  private classifyErrorForHealth(error: unknown): PlatformFailureClass | null {
    // 429 (rate limit) and 401 (auth) are not platform failures
    if (typeof error === "object" && error !== null && "status" in error) {
      const status = (error as { status: number }).status;
      if (status === 429 || status === 401) return null;
    }
    if (error instanceof Error && error.message === "Authentication failed") return null;

    if (error instanceof Error) {
      const msg = error.message.toLowerCase();

      if (msg.includes("timeout")) return "timeout";

      // 502/503/504 thrown as "Twitch API error: 5xx"
      if (/twitch api error: 50[234]/.test(msg)) return "server-5xx";

      const errorWithCause = error as Error & { cause?: { code?: string }; code?: string };
      const code = errorWithCause.cause?.code || errorWithCause.code;
      if (
        code &&
        [
          "ECONNRESET",
          "ETIMEDOUT",
          "ENOTFOUND",
          "ECONNREFUSED",
          "ENETUNREACH",
          "EHOSTUNREACH",
          "EPIPE",
          "EAI_AGAIN",
        ].includes(code)
      ) {
        return code === "ETIMEDOUT" ? "timeout" : "net-error";
      }

      if (
        msg.includes("fetch failed") ||
        msg.includes("network") ||
        msg.includes("socket") ||
        msg.includes("econnreset") ||
        msg.includes("ssl") ||
        msg.includes("tls") ||
        msg.includes("handshake")
      ) {
        return "net-error";
      }
    }

    return null;
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
