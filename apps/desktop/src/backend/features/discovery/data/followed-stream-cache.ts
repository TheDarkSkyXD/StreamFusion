import { dbService } from "@backend/services/database-service";
interface KickFollowedStreamsCache {
  cachedAt: number;
  streams: unknown[];
}

const FOLLOWED_STREAM_CACHE_KEY = "operational:kickFollowedStreamsCache";

class FollowedStreamCache {
  getKickFollowedStreamsCache(): KickFollowedStreamsCache | undefined {
    return (
      dbService.get(FOLLOWED_STREAM_CACHE_KEY, (value) => {
        if (
          typeof value === "object" &&
          value !== null &&
          "cachedAt" in value &&
          typeof value.cachedAt === "number" &&
          "streams" in value &&
          Array.isArray(value.streams)
        ) {
          return { cachedAt: value.cachedAt, streams: value.streams };
        }
        return null;
      }) ?? undefined
    );
  }

  saveKickFollowedStreamsCache(snapshot: KickFollowedStreamsCache): void {
    dbService.set(FOLLOWED_STREAM_CACHE_KEY, snapshot);
  }
}

export const followedStreamCache = new FollowedStreamCache();
