import type { Category } from "@streamfusion/core/content";
import { PLATFORMS, type Platform } from "@streamfusion/core/platform";

import type {
  HomeLiveDiscoveryPhase,
  PlatformReadOutcome,
} from "../capabilities/platform-reads";
import type { LanguageFilter } from "./broadcast-languages";
import type { CatalogCategory } from "./category-identity";
import { normalizeCategoryName, preferredMergePlatform } from "./category-name";

export type CategoryCatalogView = {
  readonly phase: HomeLiveDiscoveryPhase;
  readonly categories: readonly CatalogCategory[];
  readonly language: LanguageFilter;
  readonly query: string;
  readonly providers: Readonly<Record<Platform, PlatformReadOutcome<Category>>>;
  readonly retryablePlatforms: readonly Platform[];
};

const emptyOutcome = (
  platform: Platform,
): PlatformReadOutcome<Category> => ({
  cache: { kind: "miss" },
  items: [],
  path: { kind: "unavailable", platform, reason: "cancelled" },
  platform,
  status: "failed",
});

export function composeCategoryCatalog(input: {
  readonly kick?: PlatformReadOutcome<Category>;
  readonly language: LanguageFilter;
  readonly loading: boolean;
  readonly query: string;
  readonly remoteKick?: PlatformReadOutcome<Category>;
  readonly remoteTwitch?: PlatformReadOutcome<Category>;
  readonly twitch?: PlatformReadOutcome<Category>;
}): CategoryCatalogView {
  const twitch = input.twitch ?? emptyOutcome("twitch");
  const kick = input.kick ?? emptyOutcome("kick");
  const providers = { kick, twitch };
  const merged = mergeCategories([
    ...twitch.items,
    ...kick.items,
    ...(input.remoteTwitch?.items ?? []),
    ...(input.remoteKick?.items ?? []),
  ]);
  const query = input.query.trim().toLowerCase();
  const categories =
    query === ""
      ? merged
      : merged.filter((category) =>
          category.name.toLowerCase().includes(query),
        );
  return {
    categories,
    language: input.language,
    phase: catalogPhase({
      categories,
      kick,
      loading: input.loading,
      twitch,
    }),
    providers,
    query: input.query,
    retryablePlatforms: retryablePlatforms(providers),
  };
}

export function mergeCategories(
  categories: readonly Category[],
): readonly CatalogCategory[] {
  const groups = new Map<string, Category[]>();
  for (const category of categories) {
    const key = normalizeCategoryName(category.name);
    const group = groups.get(key) ?? [];
    group.push(category);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, group]) => mergeGroup(key, group))
    .toSorted(
      (left, right) => (right.viewerCount ?? 0) - (left.viewerCount ?? 0),
    );
}

function mergeGroup(key: string, group: readonly Category[]): CatalogCategory {
  const first = group[0];
  if (first === undefined) {
    throw new Error("category merge received an empty group");
  }
  const winnerPlatform = preferredMergePlatform(key);
  const winner =
    group.find((category) => category.platform === winnerPlatform) ?? first;
  const other = group.find((category) => category.platform !== winner.platform);
  const viewerCount = group.reduce(
    (sum, category) => sum + (category.viewerCount ?? 0),
    0,
  );
  return {
    ...winner,
    ...(viewerCount > 0 ? { viewerCount } : {}),
    ...(other === undefined ? {} : { otherId: other.id }),
  };
}

function catalogPhase(input: {
  readonly categories: readonly CatalogCategory[];
  readonly kick: PlatformReadOutcome<Category>;
  readonly loading: boolean;
  readonly twitch: PlatformReadOutcome<Category>;
}): HomeLiveDiscoveryPhase {
  if (input.loading && input.categories.length === 0) return "loading";
  const usable = [input.twitch, input.kick].filter(
    (outcome) => outcome.status !== "failed",
  );
  if (usable.length === 0) {
    return [input.twitch, input.kick].some(
      (outcome) => outcome.cache.kind === "hit",
    )
      ? "offline-cache"
      : "failed";
  }
  if (input.categories.length === 0) return "empty";
  if (
    [input.twitch, input.kick].some(
      (outcome) =>
        outcome.status === "stale" ||
        (outcome.cache.kind === "hit" && outcome.cache.stale),
    )
  ) {
    return "offline-cache";
  }
  return "ready";
}

function retryablePlatforms(providers: {
  readonly kick: PlatformReadOutcome<Category>;
  readonly twitch: PlatformReadOutcome<Category>;
}): readonly Platform[] {
  return PLATFORMS.filter((platform) => {
    const outcome = providers[platform];
    if (outcome.error?.retry === "none") return false;
    return (
      outcome.error?.retry === "manual" ||
      outcome.error?.retry === "after" ||
      outcome.status === "failed" ||
      outcome.status === "partial"
    );
  });
}
