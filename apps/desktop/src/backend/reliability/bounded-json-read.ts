import { logger } from "@/backend/logging/logger";
import { createCancellableSleep } from "@/lib/sleep";
import { readResponseTextWithinLimit, ResponseBodyTooLargeError } from "./bounded-response-body";

type ReadFailureCode =
  "canceled" | "timeout" | "http" | "response_too_large" | "invalid_json" | "upstream_schema";

export class BoundedReadError extends Error {
  constructor(
    readonly code: ReadFailureCode,
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "BoundedReadError";
  }
}

interface BoundedJsonReadOptions<T> {
  dependency: string;
  signal?: AbortSignal;
  deadlineMs?: number;
  attemptTimeoutMs?: number;
  maxAttempts?: number;
  maxBodyBytes?: number;
  notFound?: "return-null" | "error";
  attempt: (signal: AbortSignal) => Promise<Response>;
  decode: (value: unknown) => T;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function retryAfterMs(value: string | null, now: number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function combineSignals(signals: readonly AbortSignal[]): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  for (const signal of signals) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      for (const signal of signals) signal.removeEventListener("abort", abort);
    },
  };
}

async function wait(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new BoundedReadError("canceled", "Read canceled");
  const delay = createCancellableSleep(delayMs);
  const abort = (): void => {
    delay.cancel();
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const result = await delay.result;
    if (!result.ok) throw new BoundedReadError("canceled", "Read canceled");
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

export async function runBoundedJsonRead<T>(
  options: BoundedJsonReadOptions<T> & { notFound: "return-null" }
): Promise<T | null>;
export async function runBoundedJsonRead<T>(options: BoundedJsonReadOptions<T>): Promise<T>;
export async function runBoundedJsonRead<T>(options: BoundedJsonReadOptions<T>): Promise<T | null> {
  const deadlineAt = Date.now() + (options.deadlineMs ?? 12_000);
  const maxAttempts = Math.max(1, options.maxAttempts ?? 2);
  const attemptTimeoutMs = options.attemptTimeoutMs ?? 6_000;
  const maxBodyBytes = options.maxBodyBytes ?? 2 * 1024 * 1024;
  let lastError: unknown;

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
    if (options.signal?.aborted) throw new BoundedReadError("canceled", "Read canceled");
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) throw new BoundedReadError("timeout", "Read deadline exceeded");

    const attemptTimeout = AbortSignal.timeout(Math.min(remainingMs, attemptTimeoutMs));
    const combined = combineSignals(
      options.signal ? [options.signal, attemptTimeout] : [attemptTimeout]
    );

    try {
      const response = await options.attempt(combined.signal);
      if (response.status === 404 && options.notFound === "return-null") return null;

      if (!response.ok) {
        const failure = new BoundedReadError(
          "http",
          `${options.dependency} returned HTTP ${response.status}`,
          response.status
        );
        if (!RETRYABLE_STATUS.has(response.status) || attemptNumber === maxAttempts) throw failure;

        const headerDelay = retryAfterMs(response.headers.get("retry-after"), Date.now());
        const jitteredDelay = Math.floor(Math.random() * 250 * 2 ** (attemptNumber - 1));
        const delayMs = Math.min(
          headerDelay ?? jitteredDelay,
          Math.max(0, deadlineAt - Date.now())
        );
        logger.warn("Reliability:Read", "Transient upstream response; retrying", {
          dependency: options.dependency,
          status: response.status,
          attempt: attemptNumber,
          maxAttempts,
          delayMs,
        });
        await wait(delayMs, options.signal);
        continue;
      }

      let body: string;
      try {
        body = await readResponseTextWithinLimit(response, maxBodyBytes);
      } catch (error) {
        if (error instanceof ResponseBodyTooLargeError) {
          throw new BoundedReadError("response_too_large", "Upstream response exceeded its limit");
        }
        throw error;
      }

      let json: unknown;
      try {
        json = JSON.parse(body) as unknown;
      } catch {
        throw new BoundedReadError("invalid_json", "Upstream returned invalid JSON");
      }
      try {
        return options.decode(json);
      } catch {
        throw new BoundedReadError("upstream_schema", "Upstream response shape changed");
      }
    } catch (error) {
      lastError = error;
      if (error instanceof BoundedReadError) throw error;
      if (options.signal?.aborted) throw new BoundedReadError("canceled", "Read canceled");
      if (isAbort(error) && Date.now() >= deadlineAt) {
        throw new BoundedReadError("timeout", "Read deadline exceeded");
      }
      if (attemptNumber === maxAttempts) {
        if (isAbort(error)) throw new BoundedReadError("timeout", "Read attempt timed out");
        throw error;
      }

      const delayMs = Math.min(
        Math.floor(Math.random() * 250 * 2 ** (attemptNumber - 1)),
        Math.max(0, deadlineAt - Date.now())
      );
      logger.warn("Reliability:Read", "Transient upstream read failed; retrying", {
        dependency: options.dependency,
        attempt: attemptNumber,
        maxAttempts,
        delayMs,
      });
      await wait(delayMs, options.signal);
    } finally {
      combined.cleanup();
    }
  }

  throw lastError ?? new BoundedReadError("timeout", "Read deadline exceeded");
}
