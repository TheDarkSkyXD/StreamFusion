import { useQuery } from "@tanstack/react-query";

import type {
  UnifiedCategory,
  UnifiedChannel,
  UnifiedClip,
  UnifiedStream,
  UnifiedVideo,
} from "../../backend/api/unified/platform-types";
import type { Platform } from "../../shared/auth-types";

export const SEARCH_KEYS = {
  all: ["search"] as const,
  channels: (query: string, platform?: Platform) =>
    [...SEARCH_KEYS.all, "channels", query, platform] as const,
  categories: (query: string, platform?: Platform) =>
    [...SEARCH_KEYS.all, "categories", query, platform] as const,
  everything: (query: string, platform?: Platform) =>
    [...SEARCH_KEYS.all, "everything", query, platform] as const,
};

export function useSearchChannels(query: string, platform?: Platform, limit: number = 20) {
  return useQuery({
    queryKey: SEARCH_KEYS.channels(query, platform),
    queryFn: async () => {
      const response = await window.electronAPI.search.channels({ query, platform, limit });
      if (response.error) {
        throw new Error(response.error as unknown as string);
      }
      return response.data as UnifiedChannel[];
    },
    enabled: !!query,
    staleTime: 60_000,
  });
}

export function useSearchCategories(query: string, platform?: Platform, limit: number = 20) {
  return useQuery({
    queryKey: SEARCH_KEYS.categories(query, platform),
    queryFn: async () => {
      const response = await window.electronAPI.categories.search({ query, platform, limit });
      if (response.error) {
        throw new Error(response.error as unknown as string);
      }
      return response.data as UnifiedCategory[];
    },
    enabled: !!query,
    staleTime: 60_000,
  });
}

export interface SearchAllResponse {
  channels: UnifiedChannel[];
  categories: UnifiedCategory[];
  streams: UnifiedStream[];
  videos: UnifiedVideo[];
  clips: UnifiedClip[];
}

export function useSearchAll(query: string, platform?: Platform, limit: number = 5) {
  return useQuery({
    queryKey: SEARCH_KEYS.everything(query, platform),
    queryFn: async () => {
      const response = await window.electronAPI.search.all({ query, platform, limit });
      if (response.error) {
        throw new Error(response.error as unknown as string);
      }
      return response.data as SearchAllResponse;
    },
    enabled: !!query,
  });
}
