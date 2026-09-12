import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Platform } from "@streamfusion/core/platform";

import type { DiscoveryPreferenceStore } from "../capabilities/discovery-preferences";
import type { DiscoverySession } from "../capabilities/platform-reads";
import { composeCategoryCatalog } from "../domain/category-catalog";
import type { LanguageFilter } from "../domain/broadcast-languages";

const REMOTE_SEARCH_MIN = 2;

export function categoriesQueryKey(
  platform: Platform,
): readonly ["discovery", "categories", Platform] {
  return ["discovery", "categories", platform];
}

export function categorySearchQueryKey(
  platform: Platform,
  query: string,
): readonly ["discovery", "category-search", Platform, string] {
  return ["discovery", "category-search", platform, query];
}

export function useCategoryCatalog(input: {
  readonly enabled?: boolean;
  readonly preferences: DiscoveryPreferenceStore;
  readonly query: string;
  readonly session: DiscoverySession;
}) {
  const queryClient = useQueryClient();
  const enabled = input.enabled !== false;
  const [language, setLanguage] = useState<LanguageFilter>("all");
  const trimmedQuery = input.query.trim();
  const remoteQuery =
    trimmedQuery.length >= REMOTE_SEARCH_MIN ? trimmedQuery : "";
  useEffect(() => {
    let cancelled = false;
    void input.preferences.readLanguage().then((value) => {
      if (!cancelled) setLanguage(value);
    });
    return () => {
      cancelled = true;
    };
  }, [input.preferences]);
  const twitch = useQuery({
    enabled,
    queryFn: ({ signal }) =>
      input.session.readCategories({
        platform: "twitch",
        ...(signal === undefined ? {} : { signal }),
      }),
    queryKey: categoriesQueryKey("twitch"),
    retry: false,
  });
  const kick = useQuery({
    enabled,
    queryFn: ({ signal }) =>
      input.session.readCategories({
        platform: "kick",
        ...(signal === undefined ? {} : { signal }),
      }),
    queryKey: categoriesQueryKey("kick"),
    retry: false,
  });
  const remoteEnabled = enabled && remoteQuery.length >= REMOTE_SEARCH_MIN;
  const remoteTwitch = useQuery({
    enabled: remoteEnabled,
    queryFn: ({ signal }) =>
      input.session.searchCategories({
        platform: "twitch",
        query: remoteQuery,
        ...(signal === undefined ? {} : { signal }),
      }),
    queryKey: categorySearchQueryKey("twitch", remoteQuery),
    retry: false,
  });
  const remoteKick = useQuery({
    enabled: remoteEnabled,
    queryFn: ({ signal }) =>
      input.session.searchCategories({
        platform: "kick",
        query: remoteQuery,
        ...(signal === undefined ? {} : { signal }),
      }),
    queryKey: categorySearchQueryKey("kick", remoteQuery),
    retry: false,
  });
  return {
    async setLanguage(next: LanguageFilter) {
      setLanguage(next);
      await input.preferences.writeLanguage(next);
    },
    retry(platform: Platform) {
      void queryClient.invalidateQueries({
        queryKey: ["discovery", "categories", platform],
      });
    },
    view: composeCategoryCatalog({
      language,
      loading: enabled && (twitch.isPending || kick.isPending),
      query: input.query,
      ...(kick.data === undefined ? {} : { kick: kick.data }),
      ...(twitch.data === undefined ? {} : { twitch: twitch.data }),
      ...(remoteKick.data === undefined ? {} : { remoteKick: remoteKick.data }),
      ...(remoteTwitch.data === undefined
        ? {}
        : { remoteTwitch: remoteTwitch.data }),
    }),
  };
}
