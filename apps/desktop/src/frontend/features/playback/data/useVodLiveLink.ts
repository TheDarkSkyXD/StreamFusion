import { useQuery } from "@tanstack/react-query";

import type { UnifiedStream } from "@shared/platform-types";
import type { Platform } from "@shared/auth-types";

export const VOD_LIVE_LINK_KEYS = {
  byChannel: (username: string, platform: Platform) =>
    ["vod-live-link", platform, username.trim().toLowerCase()] as const,
};

export type VodLiveLinkState =
  { kind: "checking" } | { kind: "available" } | { kind: "unavailable" };

function matchesRoute(stream: UnifiedStream, username: string, platform: Platform): boolean {
  return (
    stream.isLive === true &&
    stream.platform === platform &&
    stream.channelName.trim().toLowerCase() === username.trim().toLowerCase()
  );
}

export function useVodLiveLink(username: string, platform: Platform): VodLiveLinkState {
  const enabled = username.length > 0;
  const query = useQuery({
    queryKey: VOD_LIVE_LINK_KEYS.byChannel(username, platform),
    queryFn: async () => {
      const response = await window.electronAPI.streams.getByChannel({ username, platform });
      if (response.error) throw new Error(response.error);
      return response.data as UnifiedStream | null;
    },
    enabled,
    staleTime: 0,
    gcTime: 60_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: false,
  });

  if (!enabled || !query.isFetchedAfterMount) return { kind: "checking" };
  if (!query.isSuccess || !query.data) return { kind: "unavailable" };
  return matchesRoute(query.data, username, platform)
    ? { kind: "available" }
    : { kind: "unavailable" };
}
