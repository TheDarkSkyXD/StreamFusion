import type { UnifiedCategory } from "../../../../../shared/platform-types";

import { normalizeSearchTokens } from "./search-normalization";
import { normalizeUnifiedCategory } from "./search-result-validation";

export interface CategorySearchMatchRank {
  tier: number;
  editDistance: number;
}

function normalizedPhrase(value: string): string {
  return normalizeSearchTokens(value).join(" ");
}

function oneEditApart(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false;
  if (left.length === right.length) {
    const differences = Array.from(left).flatMap((value, index) =>
      value === right[index] ? [] : [index]
    );
    return (
      differences.length === 1 ||
      (differences.length === 2 &&
        differences[1] === differences[0] + 1 &&
        left[differences[0]] === right[differences[1]] &&
        left[differences[1]] === right[differences[0]])
    );
  }
  const longer = left.length > right.length ? left : right;
  const shorter = left.length > right.length ? right : left;
  let longerIndex = 0;
  let shorterIndex = 0;
  let skipped = false;
  while (longerIndex < longer.length && shorterIndex < shorter.length) {
    if (longer[longerIndex] === shorter[shorterIndex]) {
      longerIndex += 1;
      shorterIndex += 1;
    } else {
      if (skipped) return false;
      skipped = true;
      longerIndex += 1;
    }
  }
  return true;
}

function tokenDistance(token: string, fields: readonly string[]): number | null {
  let fuzzy = false;
  for (const field of fields) {
    for (const candidate of normalizeSearchTokens(field)) {
      if (candidate.includes(token)) return 0;
      if (token.length >= 5 && oneEditApart(token, candidate)) fuzzy = true;
    }
  }
  return fuzzy ? 1 : null;
}

export function rankCategoryMatch(
  category: Pick<UnifiedCategory, "name" | "tags">,
  query: string
): CategorySearchMatchRank | null {
  const tokens = normalizeSearchTokens(query);
  if (tokens.length === 0 || (tokens.length === 1 && Array.from(tokens[0]).length === 1)) {
    return null;
  }
  const phrase = tokens.join(" ");
  const name = normalizedPhrase(category.name);
  if (name === phrase) return { tier: 0, editDistance: 0 };
  if (name.startsWith(phrase)) return { tier: 1, editDistance: 0 };

  let tier = 0;
  let editDistance = 0;
  for (const token of tokens) {
    const nameDistance = tokenDistance(token, [category.name]);
    const tagDistance = nameDistance === null ? tokenDistance(token, category.tags ?? []) : null;
    const distance = nameDistance ?? tagDistance;
    if (distance === null) return null;
    tier = Math.max(tier, nameDistance === null ? 3 : 2);
    editDistance = Math.max(editDistance, distance);
  }
  return { tier, editDistance };
}

export function filterRankAndDeduplicateCategories(
  values: readonly unknown[],
  query: string
): UnifiedCategory[] {
  const byIdentity = new Map<string, UnifiedCategory>();
  for (const value of values) {
    const category = normalizeUnifiedCategory(value);
    if (category) byIdentity.set(`${category.platform}:${category.id}`, category);
  }
  return Array.from(byIdentity.values())
    .flatMap((category) => {
      const match = rankCategoryMatch(category, query);
      return match ? [{ category, ...match }] : [];
    })
    .sort(
      (left, right) =>
        left.tier - right.tier ||
        left.editDistance - right.editDistance ||
        (right.category.viewerCount ?? 0) - (left.category.viewerCount ?? 0) ||
        `${normalizedPhrase(left.category.name)}:${left.category.platform}:${left.category.id}`.localeCompare(
          `${normalizedPhrase(right.category.name)}:${right.category.platform}:${right.category.id}`
        )
    )
    .map((entry) => entry.category);
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
