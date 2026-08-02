import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import type {
  UnifiedCategory,
  UnifiedChannel,
  UnifiedStream,
} from "@/backend/api/unified/platform-types";
import { prewarmViewportImages } from "@/lib/viewport-image-prewarm";
import { logger } from "@/renderer/logging/logger";
import type { Platform } from "@/shared/auth-types";
import { useAuthStore } from "@/store/auth-store";
import { useFollowStore } from "@/store/follow-store";
import { hydratePersistedChatHistory } from "@/store/persisted-chat-history";
import { getPersistedChannelEntries, hydratePersistedChannelLru } from "./persisted-channel-lru";
import { getPersistedSearchEntries, hydratePersistedSearchLru } from "./persisted-search-lru";
import { loadPersistedSnapshot } from "./persisted-snapshot";
import { CATEGORY_KEYS } from "./useCategories";
import { CHANNEL_KEYS } from "./useChannels";
import { SEARCH_KEYS, type SearchAllResponse } from "./useSearch";
import {
  createFollowedStreamSnapshotIdentity,
  type FollowedStreamSnapshotIdentity,
  STREAM_KEYS,
} from "./useStreams";

interface StoredSnapshot<T> {
  version: 1;
  identity: string;
  savedAt: number;
  data: T;
}

interface StreamPage {
  data: UnifiedStream[];
  nextCursor?: string;
}

const PREFIX = "browse-query-snapshot:v1:";
const TEN_MINUTES = 10 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

function decodeIdentity(value: string): unknown {
  try {
    const decoded = JSON.parse(value);
    if (typeof decoded !== "string") return decoded;
    try {
      return JSON.parse(decoded);
    } catch {
      return decoded;
    }
  } catch {
    return null;
  }
}

function isFresh(snapshot: StoredSnapshot<unknown> | null, maxAgeMs: number): boolean {
  return (
    snapshot?.version === 1 &&
    Number.isFinite(snapshot.savedAt) &&
    Date.now() - snapshot.savedAt <= maxAgeMs
  );
}

function setIfAbsent(
  client: QueryClient,
  key: readonly unknown[],
  data: unknown,
  updatedAt?: number
): void {
  if (client.getQueryData(key) === undefined) client.setQueryData(key, data, { updatedAt });
}

async function readSlot<T>(slot: string): Promise<StoredSnapshot<T> | null> {
  return window.electronAPI.store.get<StoredSnapshot<T>>(`${PREFIX}${slot}`);
}

function streamImages(streams: UnifiedStream[]): string[] {
  return streams.map((stream) => stream.thumbnailUrl);
}

function followedStreamImages(streams: UnifiedStream[]): Array<string | undefined> {
  return streams.flatMap((stream) => [stream.channelAvatar, stream.thumbnailUrl]);
}

function searchImages(data: SearchAllResponse): Array<string | undefined> {
  return [
    ...data.channels.map((channel) => channel.avatarUrl),
    ...data.categories.map((category) => category.boxArtUrl),
    ...data.streams.map((stream) => stream.thumbnailUrl),
    ...data.videos.map((video) => video.thumbnailUrl),
    ...data.clips.map((clip) => clip.thumbnailUrl),
  ];
}

export async function hydratePersistedFollowingSnapshot(
  client: QueryClient,
  identity: FollowedStreamSnapshotIdentity,
  platform?: Platform,
  options: { signal?: AbortSignal } = {}
): Promise<void> {
  const streams = await loadPersistedSnapshot({
    slot: `followed-streams:${platform ?? "all"}`,
    identity,
    maxAgeMs: ONE_DAY,
    isUsable: (data: UnifiedStream[]) => data.length > 0,
  });
  if (!streams || options.signal?.aborted) return;
  setIfAbsent(client, STREAM_KEYS.followed(platform), streams, 0);
  void prewarmViewportImages(followedStreamImages(streams));
}

interface FollowingSnapshotHydrationInput {
  twitchUserId: string;
  kickUserId: string;
  follows: ReadonlyArray<Pick<UnifiedChannel, "platform" | "id" | "avatarUrl">>;
}

export async function hydratePersistedFollowingSnapshots(
  client: QueryClient,
  { twitchUserId, kickUserId, follows }: FollowingSnapshotHydrationInput,
  options: { signal?: AbortSignal } = {}
): Promise<void> {
  void prewarmViewportImages(follows.map((follow) => follow.avatarUrl));
  await Promise.all(
    ([undefined, "twitch", "kick"] as const).map((platform) =>
      hydratePersistedFollowingSnapshot(
        client,
        createFollowedStreamSnapshotIdentity(platform, twitchUserId, kickUserId, follows),
        platform,
        options
      )
    )
  );
}

export async function hydratePersistedBrowseSnapshots(client: QueryClient): Promise<void> {
  const searchLruHydration = hydratePersistedSearchLru();
  const channelLruHydration = hydratePersistedChannelLru();
  const chatHistoryHydration = hydratePersistedChatHistory();
  const platforms: Array<Platform | undefined> = [undefined, "twitch", "kick"];
  await Promise.all(
    platforms.flatMap((platform) => {
      const suffix = platform ?? "all";
      return [
        readSlot<UnifiedStream[]>(`top-streams:${suffix}`).then((snapshot) => {
          const identity = decodeIdentity(snapshot?.identity ?? "") as {
            platform?: string;
            limit?: number;
          } | null;
          if (!isFresh(snapshot, TEN_MINUTES) || !snapshot?.data.length) return;
          if (identity?.platform !== suffix || !Number.isFinite(identity.limit)) return;
          setIfAbsent(
            client,
            STREAM_KEYS.top(platform, identity.limit),
            snapshot.data,
            snapshot.savedAt
          );
          void prewarmViewportImages(streamImages(snapshot.data));
        }),
        readSlot<UnifiedCategory[]>(`categories:${suffix}`).then((snapshot) => {
          const identity = decodeIdentity(snapshot?.identity ?? "");
          if (!isFresh(snapshot, ONE_DAY) || !snapshot?.data.length || identity !== suffix) return;
          setIfAbsent(client, CATEGORY_KEYS.top(platform), snapshot.data, snapshot.savedAt);
          for (const category of snapshot.data) {
            setIfAbsent(
              client,
              CATEGORY_KEYS.byId(category.id, category.platform),
              category,
              snapshot.savedAt
            );
          }
          void prewarmViewportImages(snapshot.data.map((category) => category.boxArtUrl));
        }),
        readSlot<InfiniteData<StreamPage, unknown>>(`category-streams:${suffix}`).then(
          (snapshot) => {
            const identity = decodeIdentity(snapshot?.identity ?? "") as {
              categoryId?: string;
              platform?: string;
              limit?: number;
              categoryName?: string;
              language?: string;
            } | null;
            const streams = snapshot?.data.pages.flatMap((page) => page.data) ?? [];
            // Category rows are a stale-while-revalidate fallback. Ten minutes was
            // too short for a cold app start: the snapshot still existed, but the
            // first category click discarded it and blocked on both platform APIs.
            if (!isFresh(snapshot, ONE_DAY) || streams.length === 0) return;
            if (
              identity?.platform !== suffix ||
              !identity.categoryId ||
              !Number.isFinite(identity.limit)
            )
              return;
            const key = [
              ...STREAM_KEYS.byCategory(identity.categoryId, platform),
              "infinite",
              identity.categoryName || undefined,
              identity.language || undefined,
            ] as const;
            setIfAbsent(client, key, snapshot?.data, snapshot?.savedAt);
            void prewarmViewportImages(streamImages(streams));
          }
        ),
      ];
    })
  );

  await Promise.all(
    (["twitch", "kick"] as const).map(async (platform) => {
      const snapshot = await readSlot<SearchAllResponse>(`search:${platform}`);
      const identity = decodeIdentity(snapshot?.identity ?? "") as {
        query?: string;
        platform?: string;
        limit?: number;
      } | null;
      const count = snapshot
        ? snapshot.data.channels.length +
          snapshot.data.categories.length +
          snapshot.data.streams.length +
          snapshot.data.videos.length +
          snapshot.data.clips.length
        : 0;
      if (!isFresh(snapshot, ONE_HOUR) || count === 0) return;
      if (identity?.platform !== platform || !identity.query || !Number.isFinite(identity.limit))
        return;
      setIfAbsent(
        client,
        SEARCH_KEYS.everything(identity.query, platform, identity.limit),
        snapshot?.data,
        snapshot?.savedAt
      );
      if (snapshot) void prewarmViewportImages(searchImages(snapshot.data));
    })
  );

  await searchLruHydration;
  for (const entry of getPersistedSearchEntries()) {
    const key =
      entry.kind === "channels"
        ? SEARCH_KEYS.channels(entry.query, entry.platform, entry.limit)
        : SEARCH_KEYS.categories(entry.query, entry.platform, entry.limit);
    // Seed as stale so the exact cached first page paints immediately while
    // TanStack starts the live platform refresh in the background on use.
    setIfAbsent(client, key, entry.data, 0);
  }

  await channelLruHydration;
  for (const entry of getPersistedChannelEntries()) {
    // Exact normalized identities prevent one provider or similarly named
    // channel from supplying the Stream page's chatroom metadata. Seed stale
    // so the route paints immediately and still refreshes in the background.
    setIfAbsent(client, CHANNEL_KEYS.byUsername(entry.username, entry.platform), entry.data, 0);
  }

  await chatHistoryHydration;
}

export function useBrowseSnapshotBootstrap(client: QueryClient): void {
  const authInitialized = useAuthStore((state) => state.initialized);
  const twitchUserId = useAuthStore((state) => state.twitchUser?.id ?? "guest");
  const kickUserId = useAuthStore((state) => String(state.kickUser?.id ?? "guest"));
  const localFollows = useFollowStore((state) => state.localFollows);
  const followsHydrated = useFollowStore((state) => state.isHydrated);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void hydratePersistedBrowseSnapshots(client).catch((error) => {
        logger.warn("Hook:Queries:BrowseBootstrap", "failed to hydrate persisted browse data", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [client]);

  useEffect(() => {
    if (!authInitialized || !followsHydrated) return;
    const controller = new AbortController();
    const frame = requestAnimationFrame(() => {
      void hydratePersistedFollowingSnapshots(
        client,
        {
          twitchUserId,
          kickUserId,
          follows: localFollows,
        },
        { signal: controller.signal }
      ).catch((error) => {
        logger.warn("Hook:Queries:BrowseBootstrap", "failed to hydrate persisted following data", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });
    return () => {
      controller.abort();
      cancelAnimationFrame(frame);
    };
  }, [authInitialized, client, followsHydrated, kickUserId, localFollows, twitchUserId]);
}
