import { IPC_FEATURES, type IpcFeature } from "./ipc-channels";
import { Result as IpcReply, SafeAppError } from "@streamfusion/core/reliability";

export interface StructuralSchema<T> {
  safeParse(
    value: unknown
  ): { success: true; data: T } | { success: false; error: { name: string } };
}

const APP_ERROR_CODES: ReadonlySet<SafeAppError["code"]> = new Set([
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
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FEATURE_VALUES: ReadonlySet<unknown> = new Set(Object.values(IPC_FEATURES));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isSafeAppError(value: unknown): value is SafeAppError {
  if (
    !isRecord(value) ||
    typeof value.code !== "string" ||
    !APP_ERROR_CODES.has(value.code as SafeAppError["code"])
  ) {
    return false;
  }
  if (typeof value.diagnosticId !== "string" || !UUID_PATTERN.test(value.diagnosticId))
    return false;
  if (value.platform !== undefined && value.platform !== "twitch" && value.platform !== "kick")
    return false;
  if (!isRecord(value.retry)) return false;
  const retryValid =
    ((value.retry.kind === "none" || value.retry.kind === "manual") &&
      hasOnlyKeys(value.retry, ["kind"])) ||
    (value.retry.kind === "after" &&
      typeof value.retry.retryAtMs === "number" &&
      Number.isFinite(value.retry.retryAtMs) &&
      hasOnlyKeys(value.retry, ["kind", "retryAtMs"]));
  return retryValid && hasOnlyKeys(value, ["code", "retry", "diagnosticId", "platform"]);
}

export function isFeatureLoaderReply(value: unknown): value is IpcReply<null> {
  if (!isRecord(value)) return false;
  if (value.kind === "ok") return value.value === null && hasOnlyKeys(value, ["kind", "value"]);
  return (
    value.kind === "error" && isSafeAppError(value.error) && hasOnlyKeys(value, ["kind", "error"])
  );
}

function schemaFromGuard<T>(guard: (value: unknown) => value is T): StructuralSchema<T> {
  return {
    safeParse(value) {
      return guard(value)
        ? { success: true as const, data: value }
        : { success: false as const, error: { name: "StructuralValidationError" } };
    },
  };
}

export const featureLoaderIpcContract = {
  request: schemaFromGuard<IpcFeature>((value): value is IpcFeature => FEATURE_VALUES.has(value)),
  response: schemaFromGuard<IpcReply<null>>(isFeatureLoaderReply),
} as const;
