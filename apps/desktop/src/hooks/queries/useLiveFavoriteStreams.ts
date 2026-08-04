import { useQueries } from "@tanstack/react-query";

import type { UnifiedStream } from "@/backend/api/unified/platform-types";
import { useMultiStreamStore } from "@/store/multistream-store";

import { getStreamByChannelQueryOptions } from "./useStreams";

export interface LiveFavoriteStreamsResult {
  streams: UnifiedStream[];
  isLoading: boolean;
  error: Error | null;
}

export function useLiveFavoriteStreams(): LiveFavoriteStreamsResult {
  const favoriteStreams = useMultiStreamStore((state) => state.favoriteStreams);
  const queries = useQueries({
    queries: favoriteStreams.map((favorite) =>
      getStreamByChannelQueryOptions(favorite.channelName, favorite.platform)
    ),
  });

  return {
    streams: queries.flatMap((query) => (query.data?.isLive ? [query.data] : [])),
    isLoading: queries.some((query) => query.isPending),
    error: queries.find((query) => query.error !== null)?.error ?? null,
  };
}
