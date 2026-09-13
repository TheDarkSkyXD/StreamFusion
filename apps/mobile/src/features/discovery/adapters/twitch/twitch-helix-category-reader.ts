import type { Category, Clip, Stream, Video } from "@streamfusion/core/content";
import type { ClipTimeRange } from "@streamfusion/core/discovery";

import type { PlatformReadOutcome } from "../../capabilities/platform-reads";
import { requestInit } from "../../utils/optional";

import {
  clipWindow,
  helixCategories,
  helixClips,
  helixStreams,
  helixVideos,
} from "./twitch-helix-category-map";

const HELIX = "https://api.twitch.tv/helix";

type TwitchInput = {
  readonly clientId: string | null;
  readonly fetch: typeof globalThis.fetch;
  readonly readAccessToken: () => Promise<string | null>;
};

export function createTwitchHelixCategoryReads(input: TwitchInput) {
  return {
    async getCategory(read: {
      readonly categoryId: string;
      readonly signal?: AbortSignal;
    }): Promise<PlatformReadOutcome<Category>> {
      return helixCollection({
        input,
        map: helixCategories,
        path: `/games?id=${encodeURIComponent(read.categoryId)}`,
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      });
    },
    async getCategoryStreams(read: {
      readonly categoryId: string;
      readonly language?: string;
      readonly signal?: AbortSignal;
    }): Promise<PlatformReadOutcome<Stream>> {
      const params = new URLSearchParams({
        first: "20",
        game_id: read.categoryId,
      });
      if (read.language) params.set("language", read.language);
      return helixCollection({
        input,
        map: helixStreams,
        path: `/streams?${params}`,
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      });
    },
    async getCategoryClips(read: {
      readonly categoryId: string;
      readonly signal?: AbortSignal;
      readonly timeRange: ClipTimeRange;
    }): Promise<PlatformReadOutcome<Clip>> {
      const params = new URLSearchParams({
        first: "20",
        game_id: read.categoryId,
      });
      const window = clipWindow(read.timeRange);
      if (window) {
        params.set("started_at", window.startedAt);
        params.set("ended_at", window.endedAt);
      }
      return helixCollection({
        input,
        map: helixClips,
        path: `/clips?${params}`,
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      });
    },
    async getCategoryVideos(read: {
      readonly categoryId: string;
      readonly signal?: AbortSignal;
      readonly sort: "views" | "recent";
    }): Promise<PlatformReadOutcome<Video>> {
      const params = new URLSearchParams({
        first: "20",
        game_id: read.categoryId,
        sort: read.sort === "recent" ? "time" : "views",
      });
      return helixCollection({
        input,
        map: helixVideos,
        path: `/videos?${params}`,
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      });
    },
    async searchCategories(read: {
      readonly query: string;
      readonly signal?: AbortSignal;
    }): Promise<PlatformReadOutcome<Category>> {
      return helixCollection({
        input,
        map: helixCategories,
        path: `/search/categories?query=${encodeURIComponent(read.query)}&first=20`,
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      });
    },
  };
}

async function helixCollection<T>(input: {
  readonly input: TwitchInput;
  readonly map: (value: unknown) => readonly T[];
  readonly path: string;
  readonly signal?: AbortSignal;
}): Promise<PlatformReadOutcome<T>> {
  if (input.signal?.aborted) return failed("cancelled");
  const accessToken = await input.input.readAccessToken();
  if (accessToken === null || input.input.clientId === null) {
    return failed("signed-out-login-required");
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
    if (input.signal?.aborted || isAbort(error)) return failed("cancelled");
    return failed("twitch-failed");
  }
}

function failed<T>(code: string): PlatformReadOutcome<T> {
  const cancelled = code === "cancelled";
  const auth = code === "auth-lost" || code === "signed-out-login-required";
  return {
    cache: { kind: "miss" },
    error: { code, retry: cancelled ? "none" : "manual" },
    items: [],
    path: auth
      ? {
          kind: "unavailable",
          platform: "twitch",
          reason:
            code === "auth-lost" ? "auth-lost" : "signed-out-login-required",
        }
      : cancelled
        ? { kind: "unavailable", platform: "twitch", reason: "cancelled" }
        : { kind: "direct", platform: "twitch" },
    platform: "twitch",
    status: "failed",
  };
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
