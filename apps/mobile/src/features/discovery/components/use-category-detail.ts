import { useEffect, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { Platform } from "@streamfusion/core/platform";

import type { DiscoveryPreferenceStore } from "../capabilities/discovery-preferences";
import type {
  DiscoverySession,
  PlatformReadOutcome,
} from "../capabilities/platform-reads";
import type { CategoryMediaItem } from "../domain/category-detail";
import {
  collapseCategoryMediaPages,
  composeCategoryDetail,
  nextCategoryMediaCursor,
} from "../domain/category-detail";
import {
  categoryIdForPlatform,
  defaultCategoryRequest,
  platformsForScope,
  type CategoryIdentity,
  type CategoryRequestIdentity,
} from "../domain/category-identity";
import { normalizeCategoryName } from "../domain/category-name";

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
  const lookup = useCategoryMatch(input, enabled);
  const resolvedIdentity =
    lookup.data === undefined || lookup.data === null
      ? identity
      : {
          ...identity,
          category: { ...identity.category, otherId: lookup.data },
        };
  const scoped = platformsForScope(
    resolvedIdentity.platformScope,
    resolvedIdentity.category,
  );
  const readTwitch = shouldReadCategoryPlatform(
    resolvedIdentity,
    "twitch",
    enabled,
  );
  const readKick = shouldReadCategoryPlatform(
    resolvedIdentity,
    "kick",
    enabled,
  );
  const twitch = useCategoryMediaQuery(
    input.session,
    resolvedIdentity,
    "twitch",
    readTwitch,
  );
  const kick = useCategoryMediaQuery(
    input.session,
    resolvedIdentity,
    "kick",
    readKick,
  );
  const queries = { twitch, kick };
  const canLoadMore = {
    twitch: twitch.canLoadMore,
    kick: kick.canLoadMore,
  };
  return {
    canLoadMore,
    categoryMatch: categoryMatchStatus(input.category, lookup),
    async change(next: CategoryRequestIdentity) {
      setIdentity(next);
      if (next.language !== identity.language) {
        await input.preferences.writeLanguage(next.language);
      }
      if (next.clipTimeRange !== identity.clipTimeRange) {
        await input.preferences.writeClipTimeRange(next.clipTimeRange);
      }
    },
    loadMore(platform: "all" | Platform) {
      for (const provider of ["twitch", "kick"] as const)
        if (
          (platform === "all" || platform === provider) &&
          canLoadMore[provider]
        )
          void queries[provider].fetchNextPage({ cancelRefetch: false });
    },
    retryPage(platform: Platform) {
      const query = queries[platform];
      if (query.enabled && query.hasNextPage && !query.isFetching)
        void query.fetchNextPage({ cancelRefetch: false });
    },
    retryCategoryMatch() {
      void lookup.refetch();
    },
    retryProvider(platform: Platform) {
      if (queries[platform].enabled) void queries[platform].refetch();
    },
    pageErrors: {
      twitch: twitch.pageError,
      kick: kick.pageError,
    },
    view: composeCategoryDetail({
      identity: resolvedIdentity,
      loading:
        (readTwitch && twitch.isPending) ||
        (readKick && kick.isPending) ||
        (lookup.isPending &&
          scoped.some(
            (platform) =>
              categoryIdForPlatform(resolvedIdentity.category, platform) ===
              null,
          )),
      ...detailOutcomes(
        resolvedIdentity,
        readTwitch ? twitch.outcome : undefined,
        readKick ? kick.outcome : undefined,
      ),
    }),
    recovering: twitch.recovering || kick.recovering,
  };
}

function useCategoryMatch(
  input: {
    readonly category: CategoryIdentity;
    readonly session: DiscoverySession;
  },
  enabled: boolean,
) {
  const otherPlatform =
    input.category.platform === "twitch" ? "kick" : "twitch";
  return useQuery({
    enabled: enabled && input.category.otherId === undefined,
    queryKey: [
      "discovery",
      "category-match",
      otherPlatform,
      input.category.name,
    ],
    queryFn: async ({ signal }) => {
      let cursor: string | undefined;
      const seen = new Set<string>();
      while (true) {
        const outcome = await input.session.searchPage({
          kind: "categories",
          platform: otherPlatform,
          query: input.category.name,
          ...(cursor === undefined ? {} : { cursor }),
          ...(signal === undefined ? {} : { signal }),
        });
        const match = outcome.items.find(
          (item) =>
            normalizeCategoryName(item.name) ===
            normalizeCategoryName(input.category.name),
        );
        if (match) return match.id;
        if (outcome.status !== "complete")
          throw new Error(outcome.error?.code ?? "category-search-failed");
        if (!outcome.cursor) return null;
        if (seen.has(outcome.cursor))
          throw new Error("category-search-cursor-loop");
        seen.add(outcome.cursor);
        cursor = outcome.cursor;
      }
    },
    retry: false,
  });
}

function categoryMatchStatus(
  category: CategoryIdentity,
  lookup: ReturnType<typeof useCategoryMatch>,
): "found" | "loading" | "failed" | "missing" {
  if (category.otherId !== undefined || lookup.data) return "found";
  if (lookup.isPending) return "loading";
  return lookup.isError ? "failed" : "missing";
}

function shouldReadCategoryPlatform(
  identity: CategoryRequestIdentity,
  platform: Platform,
  enabled: boolean,
): boolean {
  return (
    enabled &&
    platformsForScope(identity.platformScope, identity.category).includes(
      platform,
    ) &&
    categoryIdForPlatform(identity.category, platform) !== null &&
    (platform === "twitch" || identity.tab === "live")
  );
}

function useCategoryMediaQuery(
  session: DiscoverySession,
  identity: CategoryRequestIdentity,
  platform: Platform,
  enabled: boolean,
) {
  const query = useInfiniteQuery({
    enabled,
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }) => {
      const outcome = await readMedia(
        session,
        identity,
        platform,
        pageParam,
        signal,
      );
      if (outcome.status === "failed") throw new CategoryReadError(outcome);
      return outcome;
    },
    queryKey: categoryMediaQueryKey(identity, platform),
    getNextPageParam:
      identity.tab === "live" ? nextCategoryMediaCursor : () => undefined,
    staleTime: ({ state }) =>
      state.error instanceof CategoryReadError &&
      state.fetchMeta?.fetchMore?.direction === "forward"
        ? "static"
        : 0,
    refetchInterval: ({ state }) =>
      state.error instanceof CategoryReadError &&
      state.fetchMeta?.fetchMore?.direction === "forward"
        ? false
        : shouldRetryCategoryRead(
            state.error instanceof CategoryReadError
              ? state.error.outcome
              : state.data?.pages.at(-1),
          ),
    retry: false,
  });
  return {
    ...query,
    enabled,
    canLoadMore:
      enabled && query.hasNextPage && !query.isFetching && query.error === null,
    outcome: query.data
      ? collapseCategoryMediaPages(query.data.pages)
      : query.error instanceof CategoryReadError
        ? query.error.outcome
        : undefined,
    pageError:
      enabled &&
      query.error instanceof CategoryReadError &&
      query.data !== undefined
        ? query.error.outcome.error?.code
        : undefined,
    recovering: enabled && query.isFetching && query.data !== undefined,
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
  cursor: string,
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
    ...(cursor === "" ? {} : { cursor }),
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
