import type {
  WatchChatBadgeCatalog,
  WatchChatBadgeCatalogReader,
} from "../capabilities/chat-badge-catalog";
import type { WatchChatBadge } from "../capabilities/watch-chat";
import { array, object, string } from "../utils/provider-json";

const GQL_URL = "https://gql.twitch.tv/gql";
const CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp";
const CACHE_TTL_MS = 60 * 60 * 1000;
const CHANNEL_LIMIT = 20;
const QUERY =
  "query UserBadges($id: ID, $login: String, $quality: BadgeImageSize) { user(id: $id, login: $login, lookupType: ALL) { broadcastBadges { imageURL(size: $quality) setID title version } } }";

type CacheEntry =
  | {
      readonly kind: "loading";
      readonly cancel: () => void;
      readonly promise: Promise<WatchChatBadgeCatalog>;
    }
  | {
      readonly kind: "loaded";
      readonly loadedAt: number;
      readonly catalog: WatchChatBadgeCatalog;
    };

function parseCatalog(values: unknown): WatchChatBadgeCatalog {
  const catalog = new Map<string, Map<string, WatchChatBadge>>();
  for (const value of array(values)) {
    const badge = object(value);
    const setId = string(badge.setID);
    const version = string(badge.version);
    const imageUrl = string(badge.image4x) || string(badge.imageURL);
    if (!setId || !version || !imageUrl) continue;
    try {
      if (new URL(imageUrl).protocol !== "https:") continue;
    } catch {
      continue;
    }
    const versions = catalog.get(setId) ?? new Map<string, WatchChatBadge>();
    versions.set(version, {
      setId,
      version,
      imageUrl,
      title: string(badge.title) || setId,
    });
    catalog.set(setId, versions);
  }
  return catalog;
}

export function createTwitchChannelBadgeCatalogReader(
  fetch: typeof globalThis.fetch,
): WatchChatBadgeCatalogReader {
  const cache = new Map<string, CacheEntry>();
  const request = async (
    body: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> => {
    const response = await fetch(GQL_URL, {
      method: "POST",
      headers: { "Client-Id": CLIENT_ID, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) throw new Error("Twitch channel badges are unavailable.");
    const payload = object(await response.json());
    if (array(payload.errors).length)
      throw new Error("Twitch channel badges are unavailable.");
    return object(payload.data);
  };
  return {
    read(target) {
      const login = target.channelName.trim().replace(/^#/, "").toLowerCase();
      const key = `${target.channelId}:${login}`;
      const previous = cache.get(key);
      if (
        previous &&
        (previous.kind === "loading" ||
          Date.now() - previous.loadedAt < CACHE_TTL_MS)
      ) {
        cache.delete(key);
        cache.set(key, previous);
        return previous.kind === "loading"
          ? previous.promise
          : Promise.resolve(previous.catalog);
      }
      cache.delete(key);
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 10_000);
      const load = async () => {
        try {
          const data = await request(
            {
              operationName: "UserBadges",
              variables: {
                ...(/^\d+$/.test(target.channelId)
                  ? { id: target.channelId }
                  : {}),
                login,
                quality: "QUADRUPLE",
              },
              query: QUERY,
            },
            abort.signal,
          );
          const catalog = parseCatalog(object(data.user).broadcastBadges);
          if (catalog.size) return catalog;
        } catch {
          if (abort.signal.aborted)
            throw new Error("Twitch channel badge request was cancelled.");
        }
        const data = await request(
          {
            operationName: "ChatList_Badges",
            variables: { channelLogin: login },
            extensions: {
              persistedQuery: {
                sha256Hash:
                  "dd0997370fb7ca288bc52a96a9a7e3222c75c4a9a9b03df17d779666f07f7529",
                version: 1,
              },
            },
          },
          abort.signal,
        );
        if (!Array.isArray(data.badges))
          throw new Error("Twitch channel badges are unavailable.");
        return parseCatalog(data.badges);
      };
      const promise = load()
        .then((catalog) => {
          if (cache.get(key) === entry)
            cache.set(key, { kind: "loaded", loadedAt: Date.now(), catalog });
          return catalog;
        })
        .catch((error: unknown) => {
          if (cache.get(key) === entry) cache.delete(key);
          throw error;
        })
        .finally(() => clearTimeout(timer));
      const entry: CacheEntry = {
        kind: "loading",
        cancel: () => {
          clearTimeout(timer);
          abort.abort();
        },
        promise,
      };
      cache.set(key, entry);
      while (cache.size > CHANNEL_LIMIT) {
        const oldest = cache.entries().next().value;
        if (!oldest) break;
        cache.delete(oldest[0]);
        if (oldest[1].kind === "loading") oldest[1].cancel();
      }
      return promise;
    },
    dispose() {
      for (const entry of cache.values())
        if (entry.kind === "loading") entry.cancel();
      cache.clear();
    },
  };
}
