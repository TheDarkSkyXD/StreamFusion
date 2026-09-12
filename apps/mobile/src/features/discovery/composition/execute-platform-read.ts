import type { Channel, Stream } from "@streamfusion/core/content";
import type { Platform } from "@streamfusion/core/platform";

import type {
  CacheProjection,
  ChannelPageOutcome,
  InstallationIdentityRead,
  PlatformReadOutcome,
  PlatformReadPath,
  UserTokenRead,
} from "../capabilities/platform-reads";
import { selectPlatformReadPath } from "../domain/platform-read-path";

const AUTOMATIC_RETRY_CODES = new Set([
  "kick-failed",
  "relay-unavailable",
  "twitch-failed",
]);

export async function executePlatformRead<T>(input: {
  readonly cacheFallback: (
    outcome: PlatformReadOutcome<T>,
    path: PlatformReadPath,
  ) => Promise<PlatformReadOutcome<T>>;
  readonly cacheWrite: (outcome: PlatformReadOutcome<T>) => Promise<void>;
  readonly installation: InstallationIdentityRead;
  readonly network: "online" | "offline";
  readonly platform: Platform;
  readonly readDirect: () => Promise<PlatformReadOutcome<T>>;
  readonly readRelay: () => Promise<PlatformReadOutcome<T>>;
  readonly signal?: AbortSignal;
  readonly userToken: UserTokenRead;
}): Promise<PlatformReadOutcome<T>> {
  if (input.signal?.aborted) return cancelled(input.platform);
  const path = selectPlatformReadPath({
    installation: input.installation,
    network: input.network,
    platform: input.platform,
    userToken: input.userToken,
  });
  const first = await readAlongPath({
    installation: input.installation,
    path,
    readDirect: input.readDirect,
    readRelay: input.readRelay,
  });
  const retried =
    shouldRetryOnce(first) && input.signal?.aborted !== true
      ? await readAlongPath({
          installation: input.installation,
          path,
          readDirect: input.readDirect,
          readRelay: input.readRelay,
        })
      : first;
  const annotated = annotateAuthLost(retried, input.userToken);
  if (annotated.status === "complete" || annotated.status === "partial") {
    if (annotated.items.length > 0) await input.cacheWrite(annotated);
    return annotated;
  }
  return input.cacheFallback(annotated, path);
}

export function cancelled<T>(platform: Platform): PlatformReadOutcome<T> {
  return unavailableOutcome({
    kind: "unavailable",
    platform,
    reason: "cancelled",
  });
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

export async function executeChannelRead(input: {
  readonly cacheFallback: (
    outcome: ChannelPageOutcome,
    path: PlatformReadPath,
  ) => Promise<ChannelPageOutcome>;
  readonly cacheWrite: (outcome: ChannelPageOutcome) => Promise<void>;
  readonly installation: InstallationIdentityRead;
  readonly network: "online" | "offline";
  readonly platform: Platform;
  readonly readDirect: () => Promise<ChannelPageOutcome>;
  readonly readRelay: () => Promise<ChannelPageOutcome>;
  readonly signal?: AbortSignal;
  readonly userToken: UserTokenRead;
}): Promise<ChannelPageOutcome> {
  const asPage = await executePlatformRead({
    cacheFallback: async (outcome, path) =>
      pageToOutcome(
        await input.cacheFallback(outcomeToPage(outcome), path),
      ),
    cacheWrite: async (outcome) => {
      await input.cacheWrite(outcomeToPage(outcome));
    },
    installation: input.installation,
    network: input.network,
    platform: input.platform,
    readDirect: async () => pageToOutcome(await input.readDirect()),
    readRelay: async () => pageToOutcome(await input.readRelay()),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    userToken: input.userToken,
  });
  return outcomeToPage(asPage);
}

function outcomeToPage(
  outcome: PlatformReadOutcome<Channel>,
): ChannelPageOutcome {
  const live = "live" in outcome && isStream(outcome.live) ? outcome.live : null;
  return {
    cache: outcome.cache,
    channel: outcome.items[0] ?? null,
    live,
    path: outcome.path,
    platform: outcome.platform,
    status: outcome.status,
    ...(outcome.error === undefined ? {} : { error: outcome.error }),
  };
}

function pageToOutcome(
  page: ChannelPageOutcome,
): PlatformReadOutcome<Channel> & { readonly live: Stream | null } {
  return {
    cache: page.cache,
    items: page.channel === null ? [] : [page.channel],
    live: page.live,
    path: page.path,
    platform: page.platform,
    status: page.status,
    ...(page.error === undefined ? {} : { error: page.error }),
  };
}

function isStream(value: unknown): value is Stream {
  return typeof value === "object" && value !== null && "channelId" in value;
}

export function staleFromCache<T>(input: {
  readonly cache: CacheProjection;
  readonly error?: PlatformReadOutcome<T>["error"];
  readonly items: readonly T[];
  readonly path: PlatformReadPath;
  readonly platform: Platform;
}): PlatformReadOutcome<T> {
  return {
    cache: input.cache,
    items: input.items,
    path: input.path,
    platform: input.platform,
    status: "stale",
    ...(input.error === undefined ? {} : { error: input.error }),
  };
}

async function readAlongPath<T>(input: {
  readonly installation: InstallationIdentityRead;
  readonly path: PlatformReadPath;
  readonly readDirect: () => Promise<PlatformReadOutcome<T>>;
  readonly readRelay: () => Promise<PlatformReadOutcome<T>>;
}): Promise<PlatformReadOutcome<T>> {
  if (input.path.kind === "unavailable") return unavailableOutcome(input.path);
  if (input.path.kind === "direct") {
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
  return input.readRelay();
}

function annotateAuthLost<T>(
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

function shouldRetryOnce<T>(outcome: PlatformReadOutcome<T>): boolean {
  return (
    outcome.status === "failed" &&
    outcome.error !== undefined &&
    AUTOMATIC_RETRY_CODES.has(outcome.error.code)
  );
}
