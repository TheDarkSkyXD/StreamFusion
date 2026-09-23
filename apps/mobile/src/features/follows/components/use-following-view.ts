import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_LIVE_NOTIFICATION_PREFERENCES } from "@streamfusion/core/follows";
import type {
  FollowedClipPeriod,
  FollowedRecordedSort,
} from "@streamfusion/core/relay";

import type { Stream } from "@streamfusion/core/content";
import type { Platform } from "@streamfusion/core/platform";

import type {
  FollowedReadOutcome,
  FollowingChip,
  FollowingSession,
  FollowingTab,
} from "../capabilities/following-session";
import { composeFollowingView } from "../domain/compose-following-view";
import { recordedFollows } from "../domain/following-filters";
import { mapPool, RECORDED_READ_CONCURRENCY } from "../utils/following-query";

const FOLLOW_LIVE_REFETCH_MS = 30_000;

export function followingQueryKey(
  part: "membership" | "live" | "notifications" | "notification-permission" | "recorded",
  extra: readonly string[] = [],
): readonly string[] {
  return ["follows", part, ...extra];
}

export function useFollowingView(input: {
  readonly chip: FollowingChip;
  readonly period: FollowedClipPeriod;
  readonly query: string;
  readonly session: FollowingSession;
  readonly sort: FollowedRecordedSort;
  readonly tab: FollowingTab;
}) {
  const queryClient = useQueryClient();
  const queries = useFollowingQueries(input);
  return {
    refresh() {
      return queryClient.invalidateQueries({ queryKey: ["follows"] });
    },
    refreshing:
      queries.membership.isFetching ||
      queries.live.isFetching ||
      queries.notifications.isFetching ||
      (queries.recordedEnabled && queries.recorded.isFetching),
    view: composeFollowingView({
      chip: input.chip,
      loadingLive: queries.membership.isPending || queries.live.isPending,
      loadingRecorded: queries.recordedEnabled && queries.recorded.isPending,
      membership: queries.membership.data ?? [],
      notifications:
        queries.notifications.data ?? DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      query: input.query,
      tab: input.tab,
      ...liveOutcomes(queries.live),
      ...(queries.recorded.data === undefined
        ? {}
        : { recorded: queries.recorded.data }),
    }),
  };
}

function useFollowingQueries(input: {
  readonly chip: FollowingChip;
  readonly period: FollowedClipPeriod;
  readonly session: FollowingSession;
  readonly sort: FollowedRecordedSort;
  readonly tab: FollowingTab;
}) {
  const membership = useQuery({
    queryFn: () => input.session.listMembership(),
    queryKey: followingQueryKey("membership"),
    retry: false,
  });
  const live = useQuery({
    queryFn: ({ signal }) => input.session.hydrateLive({ signal }),
    queryKey: followingQueryKey("live"),
    refetchInterval: FOLLOW_LIVE_REFETCH_MS,
    refetchOnReconnect: true,
    retry: 2,
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 8_000),
    staleTime: 15_000,
  });
  const notifications = useQuery({
    queryFn: () => input.session.readNotifications(),
    queryKey: followingQueryKey("notifications"),
    retry: false,
  });
  const follows = recordedFollows(membership.data ?? [], input.chip);
  const recordedEnabled =
    (input.tab === "videos" || input.tab === "clips") && follows.length > 0;
  const recorded = useQuery({
    enabled: recordedEnabled,
    queryFn: ({ signal }) =>
      mapPool(follows, RECORDED_READ_CONCURRENCY, (follow) =>
        input.session.hydrateRecorded({
          channelId: follow.channelId,
          channelLogin: follow.channelLogin,
          kind: input.tab === "clips" ? "clips" : "videos",
          period: input.period,
          platform: follow.platform,
          sort: input.sort,
          signal,
        }),
      ),
    queryKey: followingQueryKey("recorded", [
      input.tab,
      input.chip,
      input.sort,
      input.period,
      ...follows.map((follow) => `${follow.platform}:${follow.channelId}`),
    ]),
    refetchInterval: FOLLOW_LIVE_REFETCH_MS,
    refetchOnReconnect: true,
    retry: 2,
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 8_000),
    staleTime: 15_000,
  });
  return { live, membership, notifications, recorded, recordedEnabled };
}

function liveOutcomes(live: {
  readonly data:
    | Readonly<Record<Platform, FollowedReadOutcome<Stream>>>
    | undefined;
  readonly isError: boolean;
}): Partial<Record<Platform, FollowedReadOutcome<Stream>>> {
  if (live.data !== undefined) return live.data;
  if (!live.isError) return {};
  return {
    kick: failedLiveOutcome("kick"),
    twitch: failedLiveOutcome("twitch"),
  };
}

function failedLiveOutcome(
  platform: Platform,
): FollowedReadOutcome<Stream> {
  return {
    error: "live-query-failed",
    items: [],
    missing: [],
    offline: false,
    platform,
    retryable: true,
    stale: false,
    status: "failed",
  };
}
