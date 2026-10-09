import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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

class CategoryReadError extends Error {
  constructor(readonly outcome: PlatformReadOutcome<CategoryMediaItem>) {
    super(outcome.error?.code);
  }
}

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
  const scoped = platformsForScope(identity.platformScope, identity.category);
  const readTwitch = enabled && scoped.includes("twitch");
  const readKick =
    enabled && scoped.includes("kick") && identity.tab === "live";
  const twitch = useQuery({
    enabled: readTwitch,
    queryFn: async ({ signal }) => {
      const outcome = await readMedia(
        input.session,
        identity,
        "twitch",
        signal,
      );
      if (shouldRetryCategoryRead(outcome))
        throw new CategoryReadError(outcome);
      return outcome;
    },
    queryKey: categoryMediaQueryKey(identity, "twitch"),
    refetchInterval: ({ state }) =>
      shouldRetryCategoryRead(
        state.error instanceof CategoryReadError
          ? state.error.outcome
          : state.data,
      ),
    retry: false,
  });
  const kick = useQuery({
    enabled: readKick,
    queryFn: async ({ signal }) => {
      const outcome = await readMedia(input.session, identity, "kick", signal);
      if (shouldRetryCategoryRead(outcome))
        throw new CategoryReadError(outcome);
      return outcome;
    },
    queryKey: categoryMediaQueryKey(identity, "kick"),
    refetchInterval: ({ state }) =>
      shouldRetryCategoryRead(
        state.error instanceof CategoryReadError
          ? state.error.outcome
          : state.data,
      ),
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
    view: composeCategoryDetail({
      identity,
      loading: (readTwitch && twitch.isPending) || (readKick && kick.isPending),
      ...detailOutcomes(
        identity,
        readTwitch ? twitch.data : undefined,
        readKick ? kick.data : undefined,
      ),
    }),
    recovering:
      (readTwitch &&
        (twitch.error instanceof CategoryReadError || twitch.isFetching)) ||
      (readKick &&
        (kick.error instanceof CategoryReadError || kick.isFetching)),
  };
}

export function shouldRetryCategoryRead(
  outcome: PlatformReadOutcome<CategoryMediaItem> | undefined,
): number | false {
  if (outcome?.error?.retry !== "after" && outcome?.error?.retry !== "manual")
    return false;
  if (
    outcome.error?.code === "offline" ||
    outcome.error?.code === "auth-lost" ||
    outcome.error?.code === "cancelled" ||
    outcome.error?.code === "signed-out-login-required"
  )
    return false;
  if (
    outcome.path.kind === "unavailable" &&
    (outcome.path.reason === "offline" ||
      outcome.path.reason === "auth-lost" ||
      outcome.path.reason === "cancelled" ||
      outcome.path.reason === "signed-out-login-required")
  )
    return false;
  return 5_000;
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
      ? {
          kind: "unavailable" as const,
          reason: "kick-clips-unsupported" as const,
        }
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
