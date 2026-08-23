import { logger } from "@/backend/logging/logger";
import {
  readResponseTextWithinLimit,
  ResponseBodyTooLargeError,
} from "@/backend/reliability/bounded-response-body";
import { sleep } from "@/lib/sleep";
import { net } from "electron";
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
        "Twitch public client ID is missing; Twitch API requests will fail."
      );
    }
  }

  // Retry configuration (attempts include the initial request).
  private readonly MAX_ATTEMPTS = 3;
  private readonly BASE_DELAY = 1000;
  private readonly REQUEST_TIMEOUT = 15000;
  private readonly MAX_RESPONSE_BYTES = 2_000_000;

  /**
   * Check if an error is retryable (transient network issues)
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      if (error.name === "AbortError") return false;
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
  private async netRequest(
    url: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      signal?: AbortSignal;
    } = {}
  ): Promise<{ data: unknown | null; status: number; headers: Record<string, string> }> {
    const timeoutSignal = AbortSignal.timeout(this.REQUEST_TIMEOUT);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;
    const response = await net.fetch(url, {
      method: options.method || "GET",
      headers: options.headers,
      body: options.body,
      signal,
    });

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value: string, key: string) => {
      responseHeaders[key.toLowerCase()] = value;
    });

    let text: string;
    try {
      text = await readResponseTextWithinLimit(response, this.MAX_RESPONSE_BYTES);
    } catch (error) {
      if (error instanceof ResponseBodyTooLargeError) {
        throw new Error("Twitch API response exceeded the size limit");
      }
      throw error;
    }
    let data: unknown | null;
    try {
      data = text ? (JSON.parse(text) as unknown) : null;
    } catch (_e) {
      // Proxies and upstream outages frequently return HTML/text for a 5xx.
      // Preserve the status so the request policy can retry it; successful
      // responses still require valid JSON.
      if (response.ok) throw new Error("Failed to parse JSON response");
      data = null;
    }

    return { data, status: response.status, headers: responseHeaders };
  }

  /**
   * Make an authenticated request to the Twitch API with retry logic
   * Uses Electron's net module for better network compatibility
   */
  async request(endpoint: string, options: RequestInit = {}): Promise<unknown> {
    // Only user tokens are supported. Public browsing continues to use the
    // existing unauthenticated GQL path.
    let accessToken = await twitchAuthService.getValidAccessToken();

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
    let refreshAttempted = false;

    for (let attempt = 0; attempt < this.MAX_ATTEMPTS; attempt++) {
      options.signal?.throwIfAborted();
      try {
        const response = await this.netRequest(url, {
          method: (options.method as string) || "GET",
          headers,
          body: options.body as string | undefined,
          signal: options.signal ?? undefined,
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
          if (refreshAttempted) throw new Error("Authentication failed");
          refreshAttempted = true;
          logger.debug("Twitch:Requestor", "Token expired, refreshing");
          const refreshed = await twitchAuthService.refreshToken();
          if (refreshed) {
            accessToken = await twitchAuthService.getValidAccessToken();
            if (!accessToken) throw new Error("Authentication failed");
            headers.Authorization = `Bearer ${accessToken}`;
            continue;
          }
          throw new Error("Authentication failed");
        }

        // Retry on transient server errors (500-504)
        if (response.status >= 500 && response.status <= 504) {
          if (attempt < this.MAX_ATTEMPTS - 1) {
            const delay = this.BASE_DELAY * 2 ** attempt;
            logger.warn("Twitch:Requestor", "Twitch API server error, retrying", {
              status: response.status,
              attempt: attempt + 1,
              maxAttempts: this.MAX_ATTEMPTS,
              delayMs: delay,
            });
            await sleep(delay);
            continue;
          }
        }

        if (response.status < 200 || response.status >= 300) {
          const message =
            typeof response.data === "object" &&
            response.data !== null &&
            "message" in response.data &&
            typeof response.data.message === "string"
              ? response.data.message
              : undefined;
          throw new Error(message || `Twitch API error: ${response.status}`);
        }

        recordPlatformSuccess("twitch");
        return response.data;
      } catch (error) {
        lastError = error as Error;
        const isRetryable = this.isRetryableError(error);

        // Don't retry non-retryable errors or if we've exhausted retries
        if (!isRetryable || attempt === this.MAX_ATTEMPTS - 1) {
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
          maxAttempts: this.MAX_ATTEMPTS,
          delayMs: delay,
          errorMessage: errorMsg,
        });
        await sleep(delay);
      }
    }

    // Should never reach here, but just in case
    throw lastError || new Error("Request failed after retries");
  }

  /**
   * Request JSON from Helix and validate it at the transport boundary.
   * New endpoint code should prefer this over the legacy caller-selected generic.
   */
  async requestDecoded<T>(
    endpoint: string,
    decode: (value: unknown) => T,
    options: RequestInit = {}
  ): Promise<T> {
    const payload = await this.request(endpoint, options);
    return decode(payload);
  }

  /** Model successful 204/empty responses without inventing a JSON object. */
  async requestEmpty(endpoint: string, options: RequestInit = {}): Promise<void> {
    const payload = await this.request(endpoint, options);
    if (payload !== null) {
      throw new Error("Expected Twitch API response body to be empty");
    }
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
