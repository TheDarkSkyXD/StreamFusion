import type { Platform } from "@streamfusion/core/platform";

import type {
  InstallationIdentityRead,
  PlatformReadOutcome,
  PlatformReadPath,
  UserTokenRead,
} from "../capabilities/platform-reads";

const AUTOMATIC_RETRY_CODES = new Set([
  "kick-failed",
  "relay-unavailable",
  "twitch-failed",
]);

export async function readAlongSelectedPath<T>(input: {
  readonly installation: InstallationIdentityRead;
  readonly path: PlatformReadPath;
  readonly readDirect: () => Promise<PlatformReadOutcome<T>>;
  readonly readRelay: () => Promise<PlatformReadOutcome<T>>;
  readonly signal?: AbortSignal;
}): Promise<PlatformReadOutcome<T>> {
  if (input.signal?.aborted) return cancelled(input.path.platform);
  if (input.path.kind === "unavailable") return unavailableOutcome(input.path);
  if (input.path.kind === "relay") return input.readRelay();
  const direct = await input.readDirect();
  if (
    direct.error?.code === "auth-lost" &&
    input.installation.kind === "ready"
  ) {
    const relayed = await input.readRelay();
    if (relayed.status === "complete" || relayed.status === "partial") {
      return {
        ...relayed,
        error: { code: "auth-lost", retry: "manual" },
        status: "partial",
      };
    }
  }
  return direct;
}

export async function retryOnceIfNeeded<T>(
  first: PlatformReadOutcome<T>,
  retry: () => Promise<PlatformReadOutcome<T>>,
  signal?: AbortSignal,
): Promise<PlatformReadOutcome<T>> {
  if (
    first.status !== "failed" ||
    first.error === undefined ||
    !AUTOMATIC_RETRY_CODES.has(first.error.code) ||
    signal?.aborted === true
  ) {
    return first;
  }
  return retry();
}

export function annotateAuthLost<T>(
  outcome: PlatformReadOutcome<T>,
  userToken: UserTokenRead,
): PlatformReadOutcome<T> {
  if (userToken.kind !== "auth-lost" || outcome.status === "failed") {
    return outcome;
  }
  return {
    ...outcome,
    error: { code: "auth-lost", retry: "manual" },
    status: "partial",
  };
}

export function unavailableOutcome<T>(
  path: Extract<PlatformReadPath, { kind: "unavailable" }>,
): PlatformReadOutcome<T> {
  return {
    cache: { kind: "miss" },
    error: {
      code: path.reason,
      retry: path.reason === "cancelled" ? "none" : "manual",
    },
    items: [],
    path,
    platform: path.platform,
    status: "failed",
  };
}

export function cancelled<T>(platform: Platform): PlatformReadOutcome<T> {
  return unavailableOutcome({
    kind: "unavailable",
    platform,
    reason: "cancelled",
  });
}
