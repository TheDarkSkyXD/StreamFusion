import type { Platform } from "@streamfusion/core/platform";

import { createKickOfficialReader } from "../adapters/kick/kick-official-reader";
import { createRelaySignedOutReader } from "../adapters/relay/relay-signed-out-reader";
import { createTwitchHelixReader } from "../adapters/twitch/twitch-helix-reader";
import type {
  InstallationIdentityRead,
  PlatformReadPath,
  SearchReadOutcome,
  UserTokenRead,
} from "../capabilities/platform-reads";
import { createDiscoveryCacheStore } from "../data/cache-discovery-store";
import { emptySearchCatalog } from "../domain/search-catalog";
import { selectSearchReadPath } from "../domain/platform-read-path";

const AUTOMATIC_RETRY_CODES = new Set([
  "kick-failed",
  "relay-unavailable",
  "twitch-failed",
  "guest-unavailable",
]);

export async function readSearchCatalog(input: {
  readonly cache: ReturnType<typeof createDiscoveryCacheStore>;
  readonly installation: InstallationIdentityRead;
  readonly kick: ReturnType<typeof createKickOfficialReader>;
  readonly network: "online" | "offline";
  readonly platform: Platform;
  readonly query: string;
  readonly relay: ReturnType<typeof createRelaySignedOutReader>;
  readonly signal?: AbortSignal;
  readonly twitch: ReturnType<typeof createTwitchHelixReader>;
  readonly userToken: UserTokenRead;
}): Promise<SearchReadOutcome> {
  if (input.signal?.aborted) return cancelledSearch(input.platform);
  const path = selectSearchReadPath({
    installation: input.installation,
    network: input.network,
    platform: input.platform,
    userToken: input.userToken,
  });
  const first = await searchAlongPath({ ...input, path });
  const retried =
    shouldRetryOnce(first) && input.signal?.aborted !== true
      ? await searchAlongPath({ ...input, path })
      : first;
  if (retried.status === "complete" || retried.status === "partial") {
    if (catalogHasItems(retried.catalog)) {
      await input.cache.writeSearch({
        catalog: retried.catalog,
        platform: input.platform,
        query: input.query,
      });
    }
    return retried;
  }
  return withSearchCache({
    cache: input.cache,
    outcome: retried,
    path,
    platform: input.platform,
    query: input.query,
  });
}

async function searchAlongPath(input: {
  readonly installation: InstallationIdentityRead;
  readonly kick: ReturnType<typeof createKickOfficialReader>;
  readonly path: PlatformReadPath;
  readonly platform: Platform;
  readonly query: string;
  readonly relay: ReturnType<typeof createRelaySignedOutReader>;
  readonly signal?: AbortSignal;
  readonly twitch: ReturnType<typeof createTwitchHelixReader>;
}): Promise<SearchReadOutcome> {
  if (input.path.kind === "unavailable") {
    return unavailableSearch(input.path);
  }
  if (input.path.kind === "guest") {
    return input.platform === "kick"
      ? input.kick.search({
          guest: true,
          query: input.query,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        })
      : {
          cache: { kind: "miss" },
          catalog: emptySearchCatalog(),
          error: { code: "guest-unavailable", retry: "manual" },
          path: {
            kind: "unavailable",
            platform: "twitch",
            reason: "guest-unavailable",
          },
          platform: "twitch",
          status: "failed",
        };
  }
  if (input.path.kind === "direct") {
    const direct =
      input.platform === "twitch"
        ? await input.twitch.search({
            query: input.query,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          })
        : await input.kick.search({
            query: input.query,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          });
    if (
      direct.error?.code === "auth-lost" &&
      input.installation.kind === "ready"
    ) {
      const relayed = await input.relay.search({
        platform: input.platform,
        query: input.query,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
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
  return input.relay.search({
    platform: input.platform,
    query: input.query,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
}

async function withSearchCache(input: {
  readonly cache: ReturnType<typeof createDiscoveryCacheStore>;
  readonly outcome: SearchReadOutcome;
  readonly path: PlatformReadPath;
  readonly platform: Platform;
  readonly query: string;
}): Promise<SearchReadOutcome> {
  const stored = await input.cache.readSearch(input.platform, input.query);
  if (stored.kind === "miss") return input.outcome;
  return {
    cache: stored.cache,
    catalog: stored.catalog,
    path: input.path,
    platform: input.platform,
    status: "stale",
    ...(input.outcome.error === undefined ? {} : { error: input.outcome.error }),
  };
}

function shouldRetryOnce(outcome: SearchReadOutcome): boolean {
  return (
    outcome.status === "failed" &&
    outcome.error !== undefined &&
    AUTOMATIC_RETRY_CODES.has(outcome.error.code)
  );
}

function unavailableSearch(
  path: Extract<PlatformReadPath, { kind: "unavailable" }>,
): SearchReadOutcome {
  return {
    cache: { kind: "miss" },
    catalog: emptySearchCatalog(),
    error: {
      code: path.reason,
      retry: path.reason === "cancelled" ? "none" : "manual",
    },
    path,
    platform: path.platform,
    status: "failed",
  };
}

function cancelledSearch(platform: Platform): SearchReadOutcome {
  return unavailableSearch({
    kind: "unavailable",
    platform,
    reason: "cancelled",
  });
}

function catalogHasItems(catalog: SearchReadOutcome["catalog"]): boolean {
  return (
    catalog.channels.length +
      catalog.streams.length +
      catalog.categories.length +
      catalog.videos.length +
      catalog.clips.length >
    0
  );
}
