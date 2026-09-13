import type { Category } from "@streamfusion/core/content";
import type { ClipTimeRange } from "@streamfusion/core/discovery";
import type { Platform } from "@streamfusion/core/platform";

import type { LanguageFilter } from "./broadcast-languages";

export type CategoryTab = "live" | "clips" | "videos";
export type PlatformScope = "all" | Platform;
export type TagFilter = "all" | string;
export type LiveSort = "viewers-desc" | "viewers-asc";
export type ClipSort = "views";
export type VideoSort = "views" | "recent";

export type CategoryFollowState = {
  readonly kind: "unavailable";
  readonly reason: "guest-category-follow-requires-account";
};

export const GUEST_CATEGORY_FOLLOW: CategoryFollowState = {
  kind: "unavailable",
  reason: "guest-category-follow-requires-account",
};

export type CategoryIdentity = {
  readonly id: string;
  readonly name: string;
  readonly platform: Platform;
  readonly boxArtUrl: string;
  readonly otherId?: string;
};

export type CategoryRequestIdentity = {
  readonly tab: CategoryTab;
  readonly platformScope: PlatformScope;
  readonly category: CategoryIdentity;
  readonly language: LanguageFilter;
  readonly tag: TagFilter;
  readonly liveSort: LiveSort;
  readonly clipSort: ClipSort;
  readonly videoSort: VideoSort;
  readonly clipTimeRange: ClipTimeRange;
  readonly cursor?: string;
};

export type CatalogCategory = Category & {
  readonly otherId?: string;
};

export function identityFromCategory(
  category: CatalogCategory,
): CategoryIdentity {
  return {
    boxArtUrl: category.boxArtUrl,
    id: category.id,
    name: category.name,
    platform: category.platform,
    ...(category.otherId === undefined ? {} : { otherId: category.otherId }),
  };
}

export function defaultCategoryRequest(
  category: CategoryIdentity,
  language: LanguageFilter,
  clipTimeRange: ClipTimeRange,
): CategoryRequestIdentity {
  return {
    category,
    clipSort: "views",
    clipTimeRange,
    language,
    liveSort: "viewers-desc",
    platformScope: "all",
    tab: "live",
    tag: "all",
    videoSort: "recent",
  };
}

export function platformsForScope(
  scope: PlatformScope,
  category: CategoryIdentity,
): readonly Platform[] {
  if (scope !== "all") return [scope];
  if (category.otherId === undefined) return [category.platform];
  return ["twitch", "kick"];
}

export function categoryIdForPlatform(
  category: CategoryIdentity,
  platform: Platform,
): string | null {
  if (category.platform === platform) return category.id;
  if (category.otherId === undefined) return null;
  return category.otherId;
}
