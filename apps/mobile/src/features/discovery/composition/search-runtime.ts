import type { Platform } from "@streamfusion/core/platform";

import { createKickOfficialReader } from "../adapters/kick/kick-official-reader";
import { createTwitchHelixReader } from "../adapters/twitch/twitch-helix-reader";
import type {
  MobileSearchKind,
  SearchPageOutcome,
  SearchPageRequest,
} from "../capabilities/platform-reads";
import { createDiscoveryCacheStore } from "../data/cache-discovery-store";

export async function readSearchPage<K extends MobileSearchKind>(
  input: {
    readonly cache: ReturnType<typeof createDiscoveryCacheStore>;
    readonly kick: ReturnType<typeof createKickOfficialReader>;
    readonly network: "online" | "offline";
    readonly platform: Platform;
    readonly twitch: ReturnType<typeof createTwitchHelixReader>;
  } & SearchPageRequest<K>,
): Promise<SearchPageOutcome<K>> {
  if (input.signal?.aborted) return failed(input, "cancelled");
  if (input.network === "offline") {
    return cachedOrFailed(input, failed(input, "offline"));
  }
  const read = {
    kind: input.kind,
    query: input.query,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  };
  const outcome =
    input.platform === "twitch"
      ? await input.twitch.searchPage(read)
      : await input.kick.searchPage(read);
  if (input.signal?.aborted) return failed(input, "cancelled");
  if (outcome.status === "failed") return cachedOrFailed(input, outcome);
  if (input.cursor === undefined && outcome.items.length > 0) {
    await input.cache.writeSearchPage({
      items: outcome.items,
      kind: input.kind,
      liveOnly: input.liveOnly === true,
      platform: input.platform,
      query: input.query,
    });
  }
  return outcome;
}

async function cachedOrFailed<K extends MobileSearchKind>(
  input: {
    readonly cache: ReturnType<typeof createDiscoveryCacheStore>;
    readonly platform: Platform;
  } & SearchPageRequest<K>,
  outcome: SearchPageOutcome<K>,
): Promise<SearchPageOutcome<K>> {
  if (input.cursor !== undefined || input.signal?.aborted) return outcome;
  const stored = await input.cache.readSearchPage({
    kind: input.kind,
    liveOnly: input.liveOnly === true,
    platform: input.platform,
    query: input.query,
  });
  if (stored.kind === "miss") return outcome;
  return {
    ...outcome,
    cache: stored.cache,
    items: stored.items,
    status: "stale",
  };
}

function failed<K extends MobileSearchKind>(
  input: { readonly platform: Platform } & SearchPageRequest<K>,
  code: "offline" | "cancelled",
): SearchPageOutcome<K> {
  return {
    cache: { kind: "miss" },
    error: { code, retry: code === "cancelled" ? "none" : "manual" },
    items: [],
    path: { kind: "unavailable", platform: input.platform, reason: code },
    platform: input.platform,
    resultKind: input.kind,
    status: "failed",
  } as unknown as SearchPageOutcome<K>;
}
