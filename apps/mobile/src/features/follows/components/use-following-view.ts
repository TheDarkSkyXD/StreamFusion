import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
  type GuestFollow,
} from "@streamfusion/core/follows";
import type {
  FollowedClipPeriod,
  FollowedRecordedSort,
} from "@streamfusion/core/relay";

import type {
  FollowingChip,
  FollowingSession,
  FollowingTab,
} from "../capabilities/following-session";
import { composeFollowingView } from "../domain/compose-following-view";

export function followingQueryKey(
  part: "membership" | "live" | "notifications" | "recorded",
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
      void queryClient.invalidateQueries({ queryKey: ["follows"] });
    },
    view: composeFollowingView({
      chip: input.chip,
      loadingLive: queries.membership.isPending || queries.live.isPending,
      loadingRecorded: queries.recordedEnabled && queries.recorded.isPending,
      membership: queries.membership.data ?? [],
      notifications:
        queries.notifications.data ?? DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      query: input.query,
      tab: input.tab,
      ...(queries.live.data === undefined ? {} : queries.live.data),
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
    retry: false,
  });
  const notifications = useQuery({
    queryFn: () => input.session.readNotifications(),
    queryKey: followingQueryKey("notifications"),
    retry: false,
  });
  const recordedChannel = recordedFollow(membership.data ?? [], input.chip);
  const recordedEnabled =
    (input.tab === "videos" || input.tab === "clips") &&
    recordedChannel !== null;
  const recorded = useQuery({
    enabled: recordedEnabled,
    queryFn: ({ signal }) =>
      input.session.hydrateRecorded({
        channelId: recordedChannel?.channelId ?? "",
        kind: input.tab === "clips" ? "clips" : "videos",
        period: input.period,
        platform: recordedChannel?.platform ?? "twitch",
        sort: input.sort,
        signal,
      }),
    queryKey: followingQueryKey("recorded", [
      input.tab,
      recordedChannel?.platform ?? "",
      recordedChannel?.channelId ?? "",
      input.sort,
      input.period,
    ]),
    retry: false,
  });
  return { live, membership, notifications, recorded, recordedEnabled };
}

function recordedFollow(
  membership: readonly GuestFollow[],
  chip: FollowingChip,
): GuestFollow | null {
  const filtered =
    chip === "twitch" || chip === "kick"
      ? membership.filter((follow) => follow.platform === chip)
      : membership;
  return filtered[0] ?? null;
}
