import type { UnifiedCategory } from "../../../../../shared/platform-types";

import { rankAndDeduplicateCategories, rankCategoryMatch } from "@streamfusion/core/discovery";
import { normalizeSearchTokens } from "./search-normalization";
import { normalizeUnifiedCategory } from "./search-result-validation";

export type { CategorySearchMatchRank } from "@streamfusion/core/discovery";

function normalizedPhrase(value: string): string {
  return normalizeSearchTokens(value).join(" ");
}

export { rankCategoryMatch };

export function filterRankAndDeduplicateCategories(
  values: readonly unknown[],
  query: string
): UnifiedCategory[] {
  const byIdentity = new Map<string, UnifiedCategory>();
  for (const value of values) {
    const category = normalizeUnifiedCategory(value);
    if (category) byIdentity.set(`${category.platform}:${category.id}`, category);
  }
  return rankAndDeduplicateCategories([...byIdentity.values()], query);
}

export function mergeExactCrossPlatformCategories(
  ranked: readonly UnifiedCategory[]
): UnifiedCategory[] {
  const merged: UnifiedCategory[] = [];
  const unmatched = new Map<string, number>();
  for (const category of ranked) {
    const name = normalizedPhrase(category.name);
    const existingIndex = unmatched.get(name);
    if (existingIndex === undefined) {
      unmatched.set(name, merged.length);
      merged.push(category);
      continue;
    }
    const existing = merged[existingIndex];
    if (existing.platform === category.platform || existing.crossPlatformId) {
      unmatched.set(name, merged.length);
      merged.push(category);
      continue;
    }
    const preferred =
      (category.viewerCount ?? 0) > (existing.viewerCount ?? 0) ? category : existing;
    const alternate = preferred === category ? existing : category;
    merged[existingIndex] = {
      ...preferred,
      crossPlatformId: alternate.id,
      crossPlatformName: alternate.name,
    };
    unmatched.delete(name);
  }
  return merged;
}
