import { keepPreviousData } from "@tanstack/react-query";

type CacheStorage = "memory" | "persisted-local";

export interface AppDataCachePolicy {
  staleTime: number | null;
  gcTime: number | null;
  refetchInterval: number | null;
  staleFirst: boolean;
  storage: CacheStorage;
  refetchIntervalInBackground?: boolean;
}

export const APP_DATA_CACHE_POLICIES = {
  followedStreamStatus: {
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchInterval: 30_000,
    staleFirst: true,
    storage: "memory",
    refetchIntervalInBackground: false,
  },
  streamChannelDetail: {
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchInterval: 30_000,
    staleFirst: true,
    storage: "memory",
    refetchIntervalInBackground: false,
  },
  streamList: {
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchInterval: null,
    staleFirst: true,
    storage: "memory",
  },
  followedChannelList: {
    staleTime: 5 * 60_000,
    gcTime: 5 * 60_000,
    refetchInterval: null,
    staleFirst: true,
    storage: "memory",
  },
  followedContent: {
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
    refetchInterval: null,
    staleFirst: true,
    storage: "memory",
  },
  searchResults: {
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchInterval: null,
    staleFirst: true,
    storage: "memory",
  },
  categories: {
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    refetchInterval: null,
    staleFirst: true,
    storage: "memory",
  },
  categoryReference: {
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    refetchInterval: null,
    staleFirst: true,
    storage: "memory",
  },
  localUserState: {
    staleTime: null,
    gcTime: null,
    refetchInterval: null,
    staleFirst: false,
    storage: "persisted-local",
  },
} as const satisfies Record<string, AppDataCachePolicy>;

export type AppDataCachePolicyName = keyof typeof APP_DATA_CACHE_POLICIES;

export function getQueryCacheOptions(policyName: AppDataCachePolicyName) {
  const policy: AppDataCachePolicy = APP_DATA_CACHE_POLICIES[policyName];
  if (policy.storage === "persisted-local") {
    return {
      staleTime: policy.staleTime ?? Number.POSITIVE_INFINITY,
      gcTime: policy.gcTime ?? Number.POSITIVE_INFINITY,
      refetchInterval: undefined,
      refetchIntervalInBackground: false,
    };
  }

  return {
    staleTime: policy.staleTime ?? undefined,
    gcTime: policy.gcTime ?? undefined,
    refetchInterval: policy.refetchInterval ?? undefined,
    refetchIntervalInBackground: policy.refetchIntervalInBackground ?? false,
    ...(policy.staleFirst ? { placeholderData: keepPreviousData } : {}),
  };
}
