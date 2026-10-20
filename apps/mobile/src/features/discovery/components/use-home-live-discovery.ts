import { useMemo } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { Stream } from "@streamfusion/core/content";
import type { Platform } from "@streamfusion/core/platform";

import type {
  HomeDiscoverySession,
  PlatformReadOutcome,
} from "../capabilities/platform-reads";
import {
  composeHomeLiveDiscovery,
  shouldAutoRetryHomeRead,
} from "../domain/home-live-discovery";

const RECOVERY_INTERVAL_MS = 5_000;

export function topStreamsQueryKey(
  platform: Platform,
  language?: string,
): readonly ["discovery", "top-streams", Platform, string] {
  return ["discovery", "top-streams", platform, language ?? "all"];
}

function nextHomeCursor(
  last: PlatformReadOutcome<Stream>,
  pages: readonly PlatformReadOutcome<Stream>[],
): string | undefined {
  const cursor = last.cursor;
  return last.status === "complete" &&
    cursor !== undefined &&
    cursor !== "" &&
    !pages.slice(0, -1).some((page) => page.cursor === cursor)
    ? cursor
    : undefined;
}

function collapseHomePages(
  pages: readonly PlatformReadOutcome<Stream>[] | undefined,
): PlatformReadOutcome<Stream> | undefined {
  const first = pages?.[0];
  if (!first) return undefined;
  const seen = new Set<string>();
  const items = pages.flatMap((page) =>
    page.items.filter((stream) => {
      const identity = `${stream.platform}:${stream.id}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    }),
  );
  return { ...first, items };
}

function useTopStreams(input: {
  readonly enabled: boolean;
  readonly language?: string;
  readonly platform: Platform;
  readonly session: HomeDiscoverySession;
}) {
  return useInfiniteQuery({
    enabled: input.enabled,
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }) => {
      const outcome = await input.session.readTopStreams({
        platform: input.platform,
        ...(input.language === undefined ? {} : { language: input.language }),
        ...(pageParam === "" ? {} : { cursor: pageParam }),
        ...(signal === undefined ? {} : { signal }),
      });
      if (pageParam !== "" && outcome.status === "failed") {
        throw new Error(outcome.error?.code ?? `${input.platform}-page-failed`);
      }
      return outcome;
    },
    queryKey: topStreamsQueryKey(input.platform, input.language),
    getNextPageParam: nextHomeCursor,
    refetchInterval: ({ state }) =>
      (state.status === "error" && state.data === undefined) ||
      shouldAutoRetryHomeRead(state.data?.pages[0])
        ? RECOVERY_INTERVAL_MS
        : false,
    retry: false,
  });
}

export function useHomeLiveDiscovery(input: {
  readonly enabled?: boolean;
  readonly language?: string;
  readonly session: HomeDiscoverySession;
}) {
  const queryClient = useQueryClient();
  const enabled = input.enabled !== false;
  const twitch = useTopStreams({
    enabled,
    platform: "twitch",
    session: input.session,
    ...(input.language === undefined ? {} : { language: input.language }),
  });
  const kick = useTopStreams({
    enabled,
    platform: "kick",
    session: input.session,
    ...(input.language === undefined ? {} : { language: input.language }),
  });
  const twitchPages = twitch.data?.pages;
  const kickPages = kick.data?.pages;
  const twitchOutcome = useMemo(() => collapseHomePages(twitchPages), [twitchPages]);
  const kickOutcome = useMemo(() => collapseHomePages(kickPages), [kickPages]);
  const loading = enabled && (twitch.isPending || kick.isPending);
  const view = useMemo(
    () =>
      composeHomeLiveDiscovery({
        loading,
        ...(kickOutcome === undefined ? {} : { kick: kickOutcome }),
        ...(twitchOutcome === undefined ? {} : { twitch: twitchOutcome }),
      }),
    [loading, kickOutcome, twitchOutcome],
  );
  const canLoadMore =
    (twitch.hasNextPage && !twitch.isFetching && !twitch.isFetchNextPageError) ||
    (kick.hasNextPage && !kick.isFetching && !kick.isFetchNextPageError);
  return {
    canLoadMore,
    loadMore() {
      if (twitch.hasNextPage && !twitch.isFetching && !twitch.isFetchNextPageError)
        void twitch.fetchNextPage({ cancelRefetch: false });
      if (kick.hasNextPage && !kick.isFetching && !kick.isFetchNextPageError)
        void kick.fetchNextPage({ cancelRefetch: false });
    },
    loadingMore: twitch.isFetchingNextPage || kick.isFetchingNextPage,
    pageErrors: {
      twitch: twitch.isFetchNextPageError,
      kick: kick.isFetchNextPageError,
    },
    refresh: () =>
      queryClient.resetQueries({ queryKey: ["discovery", "top-streams"] }),
    refreshing: twitch.isRefetching || kick.isRefetching,
    retryPage(platform: Platform) {
      if (platform === "twitch") void twitch.fetchNextPage({ cancelRefetch: false });
      else void kick.fetchNextPage({ cancelRefetch: false });
    },
    view,
  };
}
