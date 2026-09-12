import type { Category, Stream } from "@streamfusion/core/content";
import type { Platform } from "@streamfusion/core/platform";

import type {
  PlatformReadOutcome,
  SearchReadOutcome,
} from "../../capabilities/platform-reads";
import { emptySearchCatalog, streamsFromLiveChannels } from "../../domain/search-catalog";
import { requestInit } from "../../utils/optional";

import {
  helixCategories,
  helixChannels,
  helixStreams,
} from "./helix-catalog-map";

const HELIX = "https://api.twitch.tv/helix";

export function createTwitchHelixReader(input: {
  readonly clientId: string | null;
  readonly fetch: typeof globalThis.fetch;
  readonly readAccessToken: () => Promise<string | null>;
  readonly readUserId?: () => Promise<string | null>;
}) {
  return {
    platform: "twitch" as const,
    async getCategories(read: {
      readonly signal?: AbortSignal;
    } = {}): Promise<PlatformReadOutcome<Category>> {
      return helixCollection({
        input,
        map: helixCategories,
        path: "/games/top?first=20",
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      });
    },
    async getFollowedStreams(read: {
      readonly signal?: AbortSignal;
    } = {}): Promise<PlatformReadOutcome<Stream>> {
      const userId = (await input.readUserId?.()) ?? null;
      if (userId === null) {
        return missingToken("twitch", "signed-out-login-required");
      }
      return helixCollection({
        input,
        map: helixStreams,
        path: `/streams/followed?user_id=${encodeURIComponent(userId)}&first=20`,
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      });
    },
    async search(read: {
      readonly guest?: boolean;
      readonly query: string;
      readonly signal?: AbortSignal;
    }): Promise<SearchReadOutcome> {
      if (read.guest === true) {
        return searchFailed("twitch", "guest-unavailable");
      }
      const [channels, categories] = await Promise.all([
        helixCollection({
          input,
          map: helixChannels,
          path: `/search/channels?query=${encodeURIComponent(read.query)}&first=20`,
          ...(read.signal === undefined ? {} : { signal: read.signal }),
        }),
        helixCollection({
          input,
          map: helixCategories,
          path: `/search/categories?query=${encodeURIComponent(read.query)}&first=20`,
          ...(read.signal === undefined ? {} : { signal: read.signal }),
        }),
      ]);
      if (channels.status === "failed") {
        return searchFromOutcome(channels);
      }
      if (categories.status === "failed") {
        return searchFromOutcome(categories);
      }
      return {
        cache: { kind: "miss" },
        catalog: {
          categories: categories.items,
          channels: channels.items,
          clips: [],
          streams: streamsFromLiveChannels(channels.items),
          videos: [],
        },
        path: { kind: "direct", platform: "twitch" },
        platform: "twitch",
        status: "complete",
      };
    },
    async getTopStreams(read: {
      readonly language?: string;
      readonly signal?: AbortSignal;
    } = {}): Promise<PlatformReadOutcome<Stream>> {
      if (read.signal?.aborted) return cancelled("twitch");
      const accessToken = await input.readAccessToken();
      if (accessToken === null || input.clientId === null) {
        return missingToken("twitch", "signed-out-login-required");
      }
      const params = new URLSearchParams({ first: "20" });
      if (read.language) params.set("language", read.language);
      try {
        const response = await input.fetch(
          `${HELIX}/streams?${params}`,
          requestInit(
            {
              Authorization: `Bearer ${accessToken}`,
              "Client-Id": input.clientId,
            },
            read.signal,
          ),
        );
        if (!response.ok) {
          return failed(response.status === 401 ? "auth-lost" : "twitch-failed");
        }
        return {
          cache: { kind: "miss" },
          items: helixStreams(await response.json()),
          path: { kind: "direct", platform: "twitch" },
          platform: "twitch",
          status: "complete",
        };
      } catch (error) {
        if (read.signal?.aborted || isAbort(error)) return cancelled("twitch");
        return failed("twitch-failed");
      }
    },
  };
}

async function helixCollection<T>(input: {
  readonly input: {
    readonly clientId: string | null;
    readonly fetch: typeof globalThis.fetch;
    readonly readAccessToken: () => Promise<string | null>;
  };
  readonly map: (value: unknown) => readonly T[];
  readonly path: string;
  readonly signal?: AbortSignal;
}): Promise<PlatformReadOutcome<T>> {
  if (input.signal?.aborted) return cancelled("twitch");
  const accessToken = await input.input.readAccessToken();
  if (accessToken === null || input.input.clientId === null) {
    return missingToken("twitch", "signed-out-login-required");
  }
  try {
    const response = await input.input.fetch(
      `${HELIX}${input.path}`,
      requestInit(
        {
          Authorization: `Bearer ${accessToken}`,
          "Client-Id": input.input.clientId,
        },
        input.signal,
      ),
    );
    if (!response.ok) {
      return failed(response.status === 401 ? "auth-lost" : "twitch-failed");
    }
    return {
      cache: { kind: "miss" },
      items: input.map(await response.json()),
      path: { kind: "direct", platform: "twitch" },
      platform: "twitch",
      status: "complete",
    };
  } catch (error) {
    if (input.signal?.aborted || isAbort(error)) return cancelled("twitch");
    return failed("twitch-failed");
  }
}

function searchFromOutcome<T>(
  outcome: PlatformReadOutcome<T>,
): SearchReadOutcome {
  return {
    cache: outcome.cache,
    catalog: emptySearchCatalog(),
    path: outcome.path,
    platform: "twitch",
    status: outcome.status,
    ...(outcome.error === undefined ? {} : { error: outcome.error }),
  };
}

function searchFailed(
  platform: Platform,
  reason: "guest-unavailable",
): SearchReadOutcome {
  return {
    cache: { kind: "miss" },
    catalog: emptySearchCatalog(),
    error: { code: reason, retry: "manual" },
    path: { kind: "unavailable", platform, reason },
    platform,
    status: "failed",
  };
}

function missingToken<T>(
  platform: Platform,
  reason: "signed-out-login-required",
): PlatformReadOutcome<T> {
  return {
    cache: { kind: "miss" },
    error: { code: reason, retry: "manual" },
    items: [],
    path: { kind: "unavailable", platform, reason },
    platform,
    status: "failed",
  };
}

function failed<T>(code: string): PlatformReadOutcome<T> {
  return {
    cache: { kind: "miss" },
    error: { code, retry: "manual" },
    items: [],
    path:
      code === "auth-lost"
        ? { kind: "unavailable", platform: "twitch", reason: "auth-lost" }
        : { kind: "direct", platform: "twitch" },
    platform: "twitch",
    status: "failed",
  };
}

function cancelled<T>(platform: Platform): PlatformReadOutcome<T> {
  return {
    cache: { kind: "miss" },
    error: { code: "cancelled", retry: "none" },
    items: [],
    path: { kind: "unavailable", platform, reason: "cancelled" },
    platform,
    status: "failed",
  };
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
