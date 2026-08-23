import type { Platform } from "./auth-types";

export type AppErrorCode =
  | "invalid_input"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "transient"
  | "timeout"
  | "offline"
  | "canceled"
  | "corrupt_local_data"
  | "upstream_schema"
  | "internal";

export type RetryAdvice =
  | { readonly kind: "none" }
  | { readonly kind: "manual" }
  | { readonly kind: "after"; readonly retryAtMs: number };

/** Serializable failure information safe to expose to the renderer. */
export interface SafeAppError {
  readonly code: AppErrorCode;
  readonly retry: RetryAdvice;
  readonly diagnosticId: string;
  readonly platform?: Platform;
}

export type IpcReply<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "error"; readonly error: SafeAppError };

export type WriteReplayPolicy =
  | { readonly kind: "never" }
  | { readonly kind: "idempotency-key"; readonly key: string }
  | { readonly kind: "reconcile-before-replay"; readonly journalId: string };
