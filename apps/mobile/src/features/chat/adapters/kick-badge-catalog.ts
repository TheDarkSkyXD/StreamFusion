import { kickPublicChannelUrl } from "@mobile/features/discovery/adapters/kick/kick-public-catalog";
import type {
  WatchChatBadgeCatalog,
  WatchChatBadgeCatalogReader,
} from "../capabilities/chat-badge-catalog";
import { parseKickSubscriberCatalog } from "../domain/kick-chat-badges";

const TTL_MS = 60 * 60 * 1000;
const CHANNEL_LIMIT = 20;
const TIMEOUT_MS = 10_000;

type CacheEntry =
  | {
      readonly kind: "loading";
      readonly promise: Promise<WatchChatBadgeCatalog>;
      readonly cancel: () => void;
    }
  | {
      readonly kind: "loaded";
      readonly at: number;
      readonly catalog: WatchChatBadgeCatalog;
    };

export function createKickBadgeCatalogReader(
  fetch: typeof globalThis.fetch,
): WatchChatBadgeCatalogReader {
  const cache = new Map<string, CacheEntry>();
  return {
    read(target) {
      if (target.platform !== "kick") return Promise.resolve(new Map());
      const key = target.channelName.trim().toLowerCase();
      const previous = cache.get(key);
      if (
        previous &&
        (previous.kind === "loading" || Date.now() - previous.at < TTL_MS)
      ) {
        cache.delete(key);
        cache.set(key, previous);
        return previous.kind === "loading"
          ? previous.promise
          : Promise.resolve(previous.catalog);
      }
      cache.delete(key);
      const abort = new AbortController();
      let rejectTimeout: (error: Error) => void = () => undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        rejectTimeout = reject;
      });
      const timer = setTimeout(() => {
        abort.abort();
        rejectTimeout(new Error("Kick badge request timed out."));
      }, TIMEOUT_MS);
      const request = async (): Promise<WatchChatBadgeCatalog> => {
        const response = await fetch(kickPublicChannelUrl(key), {
          headers: { Accept: "application/json" },
          signal: abort.signal,
        });
        if (!response.ok)
          throw new Error("Kick channel badges are unavailable.");
        return parseKickSubscriberCatalog(await response.json());
      };
      const promise = Promise.race([request(), timeout])
        .then((catalog) => {
          if (cache.get(key) === entry)
            cache.set(key, { kind: "loaded", at: Date.now(), catalog });
          return catalog;
        })
        .catch((error: unknown) => {
          if (cache.get(key) === entry) cache.delete(key);
          throw error;
        })
        .finally(() => clearTimeout(timer));
      const entry: CacheEntry = {
        kind: "loading",
        promise,
        cancel: () => {
          clearTimeout(timer);
          abort.abort();
          rejectTimeout(new Error("Kick badge request was cancelled."));
        },
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
