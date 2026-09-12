import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Platform } from "@streamfusion/core/platform";

import type { DiscoveryPreferenceStore } from "../capabilities/discovery-preferences";
import type {
  DiscoverySession,
  PlatformReadOutcome,
} from "../capabilities/platform-reads";
import type { CategoryMediaItem } from "../domain/category-detail";
import { composeCategoryDetail } from "../domain/category-detail";
import {
  categoryIdForPlatform,
  defaultCategoryRequest,
  platformsForScope,
  type CategoryIdentity,
  type CategoryRequestIdentity,
} from "../domain/category-identity";

export function categoryMediaQueryKey(
  identity: CategoryRequestIdentity,
  platform: Platform,
): readonly unknown[] {
  return [
    "discovery",
    "category-media",
    platform,
    identity.tab,
    categoryIdForPlatform(identity.category, platform),
    identity.language,
    identity.clipTimeRange,
    identity.videoSort,
  ];
}

export function useCategoryDetail(input: {
  readonly category: CategoryIdentity;
  readonly enabled?: boolean;
  readonly preferences: DiscoveryPreferenceStore;
  readonly session: DiscoverySession;
}) {
  const queryClient = useQueryClient();
  const enabled = input.enabled !== false;
  const [identity, setIdentity] = useState<CategoryRequestIdentity>(() =>
    defaultCategoryRequest(input.category, "all", "all"),
  );
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      input.preferences.readLanguage(),
      input.preferences.readClipTimeRange(),
    ]).then(([language, clipTimeRange]) => {
      if (cancelled) return;
      setIdentity((current) => ({
        ...current,
        category: input.category,
        clipTimeRange,
        language,
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [input.category, input.preferences]);
  const scoped = platformsForScope(
    identity.platformScope,
    identity.category,
  );
  const twitch = useQuery({
    enabled: enabled && scoped.includes("twitch"),
    queryFn: ({ signal }) =>
      readMedia(input.session, identity, "twitch", signal),
    queryKey: categoryMediaQueryKey(identity, "twitch"),
    retry: false,
  });
  const kick = useQuery({
    enabled: enabled && scoped.includes("kick") && identity.tab === "live",
    queryFn: ({ signal }) =>
      readMedia(input.session, identity, "kick", signal),
    queryKey: categoryMediaQueryKey(identity, "kick"),
    retry: false,
  });
  return {
    async change(next: CategoryRequestIdentity) {
      setIdentity(next);
      if (next.language !== identity.language) {
        await input.preferences.writeLanguage(next.language);
      }
      if (next.clipTimeRange !== identity.clipTimeRange) {
        await input.preferences.writeClipTimeRange(next.clipTimeRange);
      }
    },
    retry(platform: Platform) {
      void queryClient.invalidateQueries({
        queryKey: ["discovery", "category-media", platform],
      });
    },
    view: composeCategoryDetail({
      identity,
      loading:
        enabled &&
        (twitch.isPending || (identity.tab === "live" && kick.isPending)),
      ...detailOutcomes(identity, twitch.data, kick.data),
    }),
  };
}

async function readMedia(
  session: DiscoverySession,
  identity: CategoryRequestIdentity,
  platform: Platform,
  signal?: AbortSignal,
): Promise<PlatformReadOutcome<CategoryMediaItem>> {
  const categoryId = categoryIdForPlatform(identity.category, platform);
  if (categoryId === null) {
    return {
      cache: { kind: "miss" },
      items: [],
      path: { kind: "unavailable", platform, reason: "cancelled" },
      platform,
      status: "failed",
      error: { code: "cancelled", retry: "none" },
    };
  }
  const extra = signal === undefined ? {} : { signal };
  if (identity.tab === "clips") {
    const result = await session.readCategoryClips({
      categoryId,
      platform,
      timeRange: identity.clipTimeRange,
      ...extra,
    });
    if ("items" in result) return result;
    return unsupportedOutcome(platform, result.reason);
  }
  if (identity.tab === "videos") {
    const result = await session.readCategoryVideos({
      categoryId,
      platform,
      sort: identity.videoSort,
      ...extra,
    });
    if ("items" in result) return result;
    return unsupportedOutcome(platform, result.reason);
  }
  return session.readCategoryStreams({
    categoryId,
    platform,
    ...extra,
    ...(identity.language === "all" ? {} : { language: identity.language }),
  });
}

function unsupportedOutcome(
  platform: Platform,
  reason: string,
): PlatformReadOutcome<CategoryMediaItem> {
  return {
    cache: { kind: "miss" },
    error: { code: reason, retry: "none" },
    items: [],
    path: { kind: "unavailable", platform, reason: "relay-unavailable" },
    platform,
    status: "failed",
  };
}

function detailOutcomes(
  identity: CategoryRequestIdentity,
  twitch: PlatformReadOutcome<CategoryMediaItem> | undefined,
  kick: PlatformReadOutcome<CategoryMediaItem> | undefined,
) {
  const twitchInScope = platformsForScope(
    identity.platformScope,
    identity.category,
  ).includes("twitch");
  const kickUnavailable =
    identity.tab === "clips" && !twitchInScope
      ? { kind: "unavailable" as const, reason: "kick-clips-unsupported" as const }
      : identity.tab === "videos" && !twitchInScope
        ? {
            kind: "unavailable" as const,
            reason: "kick-videos-unsupported" as const,
          }
        : undefined;
  return {
    ...(twitch === undefined ? {} : { twitch }),
    ...(kick === undefined ? {} : { kick }),
    ...(kickUnavailable === undefined ? {} : { kickUnavailable }),
  };
}
