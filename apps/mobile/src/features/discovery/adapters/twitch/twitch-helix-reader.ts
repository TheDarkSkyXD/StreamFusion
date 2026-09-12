import type { Category, Channel, Stream } from "@streamfusion/core/content";
import type { Platform } from "@streamfusion/core/platform";

import type { PlatformReadOutcome } from "../../capabilities/platform-reads";
import { requestInit } from "../../utils/optional";

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
      readonly query: string;
      readonly signal?: AbortSignal;
    }): Promise<PlatformReadOutcome<Stream | Channel | Category>> {
      return helixCollection({
        input,
        map: helixCategories,
        path: `/search/categories?query=${encodeURIComponent(read.query)}&first=20`,
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      });
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
        const payload: unknown = await response.json();
        const items = helixStreams(payload);
        return {
          cache: { kind: "miss" },
          items,
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

function helixStreams(value: unknown): readonly Stream[] {
  if (typeof value !== "object" || value === null || !("data" in value)) {
    return [];
  }
  const data = (value as { data: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    if (typeof row !== "object" || row === null) return [];
    const record = row as Record<string, unknown>;
    const id = stringField(record, "id");
    if (id === "") return [];
    return [
      {
        channelAvatar: "",
        channelDisplayName: stringField(record, "user_name"),
        channelId: stringField(record, "user_id"),
        channelName: stringField(record, "user_login"),
        id,
        isLive: stringField(record, "type") === "live",
        language: stringField(record, "language"),
        platform: "twitch" as const,
        startedAt: null,
        tags: [],
        thumbnailUrl: stringField(record, "thumbnail_url")
          .replaceAll("{width}", "640")
          .replaceAll("{height}", "360"),
        title: stringField(record, "title"),
        viewerCount:
          typeof record.viewer_count === "number" && record.viewer_count >= 0
            ? record.viewer_count
            : 0,
      },
    ];
  });
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

function helixCategories(value: unknown): readonly Category[] {
  if (typeof value !== "object" || value === null || !("data" in value)) {
    return [];
  }
  const data = (value as { data: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    if (typeof row !== "object" || row === null) return [];
    const record = row as Record<string, unknown>;
    const id = stringField(record, "id");
    if (id === "") return [];
    return [
      {
        boxArtUrl: stringField(record, "box_art_url")
          .replaceAll("{width}", "285")
          .replaceAll("{height}", "380"),
        id,
        name: stringField(record, "name"),
        platform: "twitch" as const,
      },
    ];
  });
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

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
