import type { Platform } from "@streamfusion/core/platform";

import type {
  InstallationIdentitySource,
  NetworkSource,
  PlatformReadOutcome,
  UserTokenSource,
} from "../capabilities/platform-reads";
import { selectPlatformReadPath } from "../domain/platform-read-path";

import {
  annotateAuthLost,
  cancelled,
  readAlongSelectedPath,
  retryOnceIfNeeded,
} from "./discovery-path-read";

export type ReaderSources = {
  readonly input: {
    readonly installation: InstallationIdentitySource;
    readonly network: NetworkSource;
    readonly userTokens: UserTokenSource;
  };
};

export async function cachedRead<T>(input: {
  readonly cacheFallback: (
    platform: Platform,
    language?: string,
  ) => Promise<
    | { readonly kind: "miss" }
    | {
        readonly kind: "hit";
        readonly cache: PlatformReadOutcome<T>["cache"];
        readonly items: readonly T[];
        readonly cursor?: string;
      }
  >;
  readonly language?: string;
  readonly platform: Platform;
  readonly readDirect: (
    platform: Platform,
    extra: { readonly signal?: AbortSignal },
  ) => Promise<PlatformReadOutcome<T>>;
  readonly readRelay: (
    platform: Platform,
    extra: { readonly signal?: AbortSignal },
  ) => Promise<PlatformReadOutcome<T>>;
  readonly signal?: AbortSignal;
  readonly sources: ReaderSources;
  readonly writeCache: (
    outcome: PlatformReadOutcome<T>,
    platform: Platform,
    language?: string,
  ) => Promise<void>;
}): Promise<PlatformReadOutcome<T>> {
  const annotated = await liveRead(input);
  if (
    (annotated.status === "complete" || annotated.status === "partial") &&
    annotated.items.length > 0
  ) {
    await input.writeCache(annotated, input.platform, input.language);
    return annotated;
  }
  const stored = await input.cacheFallback(input.platform, input.language);
  if (stored.kind === "miss") return annotated;
  return {
    cache: stored.cache,
    items: stored.items,
    path: annotated.path,
    platform: input.platform,
    status: "stale",
    ...(stored.cursor === undefined ? {} : { cursor: stored.cursor }),
    ...(annotated.error === undefined ? {} : { error: annotated.error }),
  };
}

export async function liveRead<T>(input: {
  readonly platform: Platform;
  readonly readDirect: (
    platform: Platform,
    extra: { readonly signal?: AbortSignal },
  ) => Promise<PlatformReadOutcome<T>>;
  readonly readRelay: (
    platform: Platform,
    extra: { readonly signal?: AbortSignal },
  ) => Promise<PlatformReadOutcome<T>>;
  readonly signal?: AbortSignal;
  readonly sources: ReaderSources;
}): Promise<PlatformReadOutcome<T>> {
  if (input.signal?.aborted) return cancelled(input.platform);
  const userToken = await input.sources.input.userTokens.read(input.platform);
  const installation = await input.sources.input.installation.read();
  const network = await input.sources.input.network.read();
  const path = selectPlatformReadPath({
    installation,
    network,
    platform: input.platform,
    userToken,
  });
  const extra = signalOf(input);
  const along = () =>
    readAlongSelectedPath({
      installation,
      path,
      readDirect: () => input.readDirect(input.platform, extra),
      readRelay: () => input.readRelay(input.platform, extra),
      ...extra,
    });
  return annotateAuthLost(
    await retryOnceIfNeeded(await along(), along, input.signal),
    userToken,
  );
}

export function availableMedia<T>(
  result:
    | PlatformReadOutcome<T>
    | {
        readonly kind: "unsupported";
        readonly platform: Platform;
        readonly reason: string;
      },
): PlatformReadOutcome<T> {
  if ("items" in result) return result;
  return {
    cache: { kind: "miss" },
    error: { code: result.reason, retry: "none" },
    items: [],
    path: {
      kind: "unavailable",
      platform: result.platform,
      reason: "relay-unavailable",
    },
    platform: result.platform,
    status: "failed",
  };
}

export function signalOf(input: { readonly signal?: AbortSignal }): {
  readonly signal?: AbortSignal;
} {
  return input.signal === undefined ? {} : { signal: input.signal };
}
