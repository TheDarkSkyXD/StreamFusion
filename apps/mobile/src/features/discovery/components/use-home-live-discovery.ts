import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Platform } from "@streamfusion/core/platform";

import type { HomeDiscoverySession } from "../capabilities/platform-reads";
import { composeHomeLiveDiscovery } from "../domain/home-live-discovery";

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
    retry: false,
  });
  return {
    retry(platform: Platform) {
      void queryClient.invalidateQueries({
        queryKey: ["discovery", "top-streams", platform],
      });
    },
    view: composeHomeLiveDiscovery({
      loading: enabled && (twitch.isPending || kick.isPending),
      ...(kick.data === undefined ? {} : { kick: kick.data }),
      ...(twitch.data === undefined ? {} : { twitch: twitch.data }),
    }),
  };
}
