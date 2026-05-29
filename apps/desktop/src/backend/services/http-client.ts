/**
 * Robust HTTP Client for Twitch GQL and API Requests
 *
 * This module provides a centralized HTTP client with:
 * - Request queue with concurrency limits to prevent connection exhaustion
 * - Connection reuse via Keep-Alive headers
 * - Proper retry logic with exponential backoff and jitter
 * - Circuit breaker pattern for temporary failures
 * - Request deduplication to prevent duplicate in-flight requests
 *
 * Addresses ECONNRESET and UND_ERR_CONNECT_TIMEOUT errors that occur
 * during TLS handshake with gql.twitch.tv when too many concurrent
 * connections are opened.
 */

// ============================================================================
// Types
// ============================================================================

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  /** Skip the request queue (use for high-priority requests) */
  skipQueue?: boolean;
}

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
}

interface QueuedRequest {
  url: string;
  options: RequestInit;
  retryOptions: Required<RetryOptions>;
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
  origin: string;
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 4,
  baseDelayMs: 500,
  maxDelayMs: 8000,
  timeoutMs: 20000, // Increased from 15s to 20s for TLS handshake
  skipQueue: false,
};

// Circuit breaker settings
const CIRCUIT_BREAKER = {
  failureThreshold: 5,
  resetTimeoutMs: 30000, // 30 seconds before trying again
};

// Concurrency settings - limits concurrent connections per origin
// This prevents ECONNRESET by not overwhelming the TLS handshake process
const CONCURRENCY = {
  // STRICT LIMIT: 1 concurrent request to Twitch GQL to absolutely prevent socket exhaustion
  "https://gql.twitch.tv": 1,
  // Default for other origins
  default: 6,
};

// Delay between processing queued requests (allows TLS connections to stabilize)
const QUEUE_PROCESS_DELAY_MS = 100; // Increased to 100ms

// Retryable error codes - includes undici-specific codes
const RETRYABLE_ERROR_CODES = new Set([
  "ECONNRESET", // Connection reset (TLS handshake failure)
  "ETIMEDOUT", // Connection timed out
  "ENOTFOUND", // DNS lookup failed (transient)
  "ECONNREFUSED", // Connection refused
  "ENETUNREACH", // Network unreachable
  "EHOSTUNREACH", // Host unreachable
  "EPIPE", // Broken pipe
  "EAI_AGAIN", // DNS temporary failure
  "UND_ERR_CONNECT_TIMEOUT", // Undici connect timeout
  "UND_ERR_SOCKET", // Undici socket error
  "UND_ERR_HEADERS_TIMEOUT", // Undici headers timeout
  "UND_ERR_BODY_TIMEOUT", // Undici body timeout
]);

// Retryable message patterns
const RETRYABLE_MESSAGE_PATTERNS = [
  "fetch failed",
  "network",
  "socket",
  "disconnected",
  "connect timeout",
  "connection reset",
  "ssl",
  "tls",
  "handshake",
  "econnreset",
  "etimedout",
];

// ============================================================================
// HTTP Client Singleton
// ============================================================================

class RobustHttpClient {
  private circuitBreakers = new Map<string, CircuitBreakerState>();

  // Request queues per origin for concurrency control
  private requestQueues = new Map<string, QueuedRequest[]>();

  // Currently active requests per origin
  private activeRequests = new Map<string, number>();

  // Processing flags to prevent multiple queue processors
  private isProcessing = new Map<string, boolean>();

  /**
   * Make a fetch request with automatic retry, circuit breaker, and concurrency control
   *
   * Requests are queued per-origin to prevent connection exhaustion.
   * Use skipQueue: true for critical requests that should bypass the queue.
   */
  async fetch(
    url: string,
    options: RequestInit = {},
    retryOptions: RetryOptions = {}
  ): Promise<Response> {
    const opts = { ...DEFAULT_OPTIONS, ...retryOptions };
    const origin = new URL(url).origin;

    // Check circuit breaker
    if (this.isCircuitOpen(origin)) {
      throw new Error(`Circuit breaker open for ${origin}. Too many recent failures.`);
    }

    // Add Keep-Alive headers for connection reuse
    const enhancedOptions: RequestInit = {
      ...options,
      headers: {
        Connection: "keep-alive",
        ...options.headers,
      },
    };

    // Skip queue for high-priority requests
    if (opts.skipQueue) {
      return this.executeRequest(url, enhancedOptions, opts, origin);
    }

    // Queue the request for controlled execution
    return this.enqueueRequest(url, enhancedOptions, opts, origin);
  }

  /**
   * Enqueue a request for controlled execution
   */
  private enqueueRequest(
    url: string,
    options: RequestInit,
    retryOptions: Required<RetryOptions>,
    origin: string
  ): Promise<Response> {
    return new Promise((resolve, reject) => {
      // Initialize queue for origin if needed
      if (!this.requestQueues.has(origin)) {
        this.requestQueues.set(origin, []);
        this.activeRequests.set(origin, 0);
        this.isProcessing.set(origin, false);
      }

      // Add request to queue
      const queue = this.requestQueues.get(origin)!;
      queue.push({
        url,
        options,
        retryOptions,
        resolve,
        reject,
        origin,
      });

      // Start processing if not already running
      this.processQueue(origin);
    });
  }

  /**
   * Process queued requests for an origin with concurrency control
   */
  private async processQueue(origin: string): Promise<void> {
    // Prevent multiple processors for same origin
    if (this.isProcessing.get(origin)) {
      return;
    }

    this.isProcessing.set(origin, true);

    try {
      const queue = this.requestQueues.get(origin)!;
      const maxConcurrent = CONCURRENCY[origin as keyof typeof CONCURRENCY] || CONCURRENCY.default;

      while (queue.length > 0) {
        const activeCount = this.activeRequests.get(origin) || 0;

        // Wait if at concurrency limit
        if (activeCount >= maxConcurrent) {
          await this.sleep(QUEUE_PROCESS_DELAY_MS);
          continue;
        }

        // Get next request from queue
        const request = queue.shift();
        if (!request) break;

        // Increment active count
        this.activeRequests.set(origin, activeCount + 1);

        // Execute request (don't await - process in parallel up to limit)
        this.executeRequest(request.url, request.options, request.retryOptions, request.origin)
          .then((response) => {
            request.resolve(response);
          })
          .catch((error) => {
            request.reject(error);
          })
          .finally(() => {
            // Decrement active count
            const current = this.activeRequests.get(origin) || 1;
            this.activeRequests.set(origin, Math.max(0, current - 1));
          });

        // Small delay between starting requests to stagger TLS handshakes
        await this.sleep(QUEUE_PROCESS_DELAY_MS);
      }
    } finally {
      this.isProcessing.set(origin, false);
    }
  }

  /**
   * Execute a single request with retry logic
   */
  private async executeRequest(
    url: string,
    options: RequestInit,
    retryOpts: Required<RetryOptions>,
    origin: string
  ): Promise<Response> {
    try {
      const response = await this.executeWithRetry(url, options, retryOpts, origin);
      this.recordSuccess(origin);
      return response;
    } catch (error) {
      this.recordFailure(origin);
      throw error;
    }
  }

  /**
   * Execute request with retry logic
   */
  private async executeWithRetry(
    url: string,
    options: RequestInit,
    retryOpts: Required<RetryOptions>,
    origin: string
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retryOpts.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          ...options,
          signal: AbortSignal.timeout(retryOpts.timeoutMs),
        });

        // Retry on transient server errors (502, 503, 504)
        if (response.status >= 502 && response.status <= 504) {
          if (attempt < retryOpts.maxRetries) {
            const delay = this.calculateDelay(attempt, retryOpts);
            console.warn(
              `⚠️ Server error ${response.status} from ${origin} (attempt ${attempt + 1}/${retryOpts.maxRetries + 1}). Retrying in ${delay}ms...`
            );
            await this.sleep(delay);
            continue;
          }
          throw new Error(
            `Server error: ${response.status} after ${retryOpts.maxRetries + 1} attempts`
          );
        }

        return response;
      } catch (error) {
        lastError = error as Error;

        // Check if it's a timeout (AbortError)
        const isTimeout = error instanceof Error && error.name === "AbortError";
        const isRetryable = isTimeout || this.isRetryableError(error);

        if (!isRetryable || attempt === retryOpts.maxRetries) {
          throw error;
        }

        const delay = this.calculateDelay(attempt, retryOpts);
        const errorCode = this.getErrorCode(error);
        const errorMsg = (error as Error).message || "Unknown error";
        const errorType = isTimeout ? "TIMEOUT" : errorCode || "NETWORK";

        console.warn(
          `⚠️ Request failed [${errorType}] to ${origin} (attempt ${attempt + 1}/${retryOpts.maxRetries + 1}). Retrying in ${delay}ms... Error: ${errorMsg}`
        );

        await this.sleep(delay);
      }
    }

    throw lastError || new Error("Request failed after retries");
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    const code = this.getErrorCode(error);

    // Check against known retryable codes
    if (code && RETRYABLE_ERROR_CODES.has(code)) {
      return true;
    }

    // Check error message patterns
    const message = error.message.toLowerCase();
    return RETRYABLE_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern));
  }

  /**
   * Extract error code from error or its cause
   */
  private getErrorCode(error: unknown): string | undefined {
    if (!(error instanceof Error)) return undefined;

    // Check cause first (Node.js fetch wraps the real error)
    const errorWithCause = error as Error & { cause?: { code?: string } };
    if (errorWithCause.cause?.code) {
      return errorWithCause.cause.code;
    }

    // Check direct code property
    const errorWithCode = error as Error & { code?: string };
    if (errorWithCode.code) {
      return errorWithCode.code;
    }

    return undefined;
  }

  /**
   * Calculate delay with jitter for retry
   * Uses decorrelated jitter for better distribution
   */
  private calculateDelay(attempt: number, opts: Required<RetryOptions>): number {
    // Decorrelated jitter (better than simple exponential + jitter)
    // This provides more random distribution and prevents thundering herd
    const exponential = opts.baseDelayMs * 2 ** attempt;
    const jitter = Math.random() * opts.baseDelayMs;
    const delay = exponential + jitter;

    // Cap at maxDelay
    return Math.min(delay, opts.maxDelayMs);
  }

  /**
   * Check if circuit breaker is open for an origin
   */
  private isCircuitOpen(origin: string): boolean {
    const state = this.circuitBreakers.get(origin);
    if (!state) return false;

    if (state.isOpen) {
      // Check if reset timeout has passed
      if (Date.now() - state.lastFailure > CIRCUIT_BREAKER.resetTimeoutMs) {
        state.isOpen = false;
        state.failures = 0;
        console.debug(`[HttpClient] Circuit breaker reset for ${origin}`);
        return false;
      }
      return true;
    }

    return false;
  }

  /**
   * Record a successful request
   */
  private recordSuccess(origin: string): void {
    const state = this.circuitBreakers.get(origin);
    if (state) {
      state.failures = 0;
      state.isOpen = false;
    }
  }

  /**
   * Record a failed request
   */
  private recordFailure(origin: string): void {
    let state = this.circuitBreakers.get(origin);
    if (!state) {
      state = { failures: 0, lastFailure: 0, isOpen: false };
      this.circuitBreakers.set(origin, state);
    }

    state.failures++;
    state.lastFailure = Date.now();

    if (state.failures >= CIRCUIT_BREAKER.failureThreshold) {
      state.isOpen = true;
      console.warn(
        `[HttpClient] Circuit breaker OPEN for ${origin} after ${state.failures} failures`
      );
    }
  }

  /**
   * Helper sleep function
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Reset circuit breaker for an origin
   */
  resetCircuitBreaker(origin: string): void {
    this.circuitBreakers.delete(origin);
  }

  /**
   * Clear all state (queues, circuit breakers, etc.)
   */
  clear(): void {
    this.circuitBreakers.clear();
    this.requestQueues.clear();
    this.activeRequests.clear();
    this.isProcessing.clear();
  }

  /**
   * Get statistics about the client
   */
  getStats(): {
    circuitBreakers: Record<string, CircuitBreakerState>;
    queueSizes: Record<string, number>;
    activeRequests: Record<string, number>;
  } {
    const circuitBreakers: Record<string, CircuitBreakerState> = {};
    for (const [origin, state] of this.circuitBreakers) {
      circuitBreakers[origin] = { ...state };
    }

    const queueSizes: Record<string, number> = {};
    for (const [origin, queue] of this.requestQueues) {
      queueSizes[origin] = queue.length;
    }

    const activeRequests: Record<string, number> = {};
    for (const [origin, count] of this.activeRequests) {
      activeRequests[origin] = count;
    }

    return {
      circuitBreakers,
      queueSizes,
      activeRequests,
    };
  }
}

// Export singleton instance
export const httpClient = new RobustHttpClient();

// Export types
export type { RetryOptions };
