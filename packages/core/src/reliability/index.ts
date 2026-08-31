import type { Platform } from "@core/platform/index.ts";

export const APP_ERROR_CODES = [
  "invalid_input",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "transient",
  "timeout",
  "offline",
  "canceled",
  "corrupt_local_data",
  "upstream_schema",
  "internal",
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

export type RetryDecision =
  | { readonly kind: "none" }
  | { readonly kind: "manual" }
  | { readonly kind: "after"; readonly retryAtMs: number };

export interface SafeAppError {
  readonly code: AppErrorCode;
  readonly retry: RetryDecision;
  readonly diagnosticId: string;
  readonly platform?: Platform;
}

export type Result<T, E = SafeAppError> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "error"; readonly error: E };

export type WriteReplayPolicy =
  | { readonly kind: "never" }
  | { readonly kind: "idempotency-key"; readonly key: string }
  | { readonly kind: "reconcile-before-replay"; readonly journalId: string };

export function ok<T>(value: T): Result<T, never> {
  return { kind: "ok", value };
}

export function err<E>(error: E): Result<never, E> {
  return { kind: "error", error };
}
