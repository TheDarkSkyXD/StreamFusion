import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Platform } from "@streamfusion/core/platform";

import type { HomeDiscoverySession } from "../capabilities/platform-reads";
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

export function useHomeLiveDiscovery(input: {
  readonly enabled?: boolean;
  readonly language?: string;
  readonly session: HomeDiscoverySession;
}) {
  const queryClient = useQueryClient();
  const enabled = input.enabled !== false;
  const twitch = useQuery({
    enabled,
    queryFn: ({ signal }) =>
      input.session.readTopStreams({
        platform: "twitch",
        ...(input.language === undefined ? {} : { language: input.language }),
        ...(signal === undefined ? {} : { signal }),
      }),
    queryKey: topStreamsQueryKey("twitch", input.language),
    refetchInterval: ({ state }) =>
      state.status === "error" || shouldAutoRetryHomeRead(state.data)
        ? RECOVERY_INTERVAL_MS
        : false,
    retry: false,
  });
  const kick = useQuery({
    enabled,
    queryFn: ({ signal }) =>
      input.session.readTopStreams({
        platform: "kick",
        ...(input.language === undefined ? {} : { language: input.language }),
        ...(signal === undefined ? {} : { signal }),
      }),
    queryKey: topStreamsQueryKey("kick", input.language),
    refetchInterval: ({ state }) =>
      state.status === "error" || shouldAutoRetryHomeRead(state.data)
        ? RECOVERY_INTERVAL_MS
        : false,
    retry: false,
  });
  const loading = enabled && (twitch.isPending || kick.isPending);
  const view = useMemo(
    () =>
      composeHomeLiveDiscovery({
        loading,
        ...(kick.data === undefined ? {} : { kick: kick.data }),
        ...(twitch.data === undefined ? {} : { twitch: twitch.data }),
      }),
    [loading, kick.data, twitch.data],
  );
  const refresh = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: ["discovery", "top-streams"],
      }),
    [queryClient],
  );
  return {
    refresh,
    refreshing: twitch.isFetching || kick.isFetching,
    view,
  };
}
