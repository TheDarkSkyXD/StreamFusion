import type { UnifiedCategory } from "@shared/platform-types";
import type { Platform } from "@shared/auth-types";

import { savePersistedSnapshot } from "./persisted-snapshot";

const MAX_CATEGORIES = 5_000;
const MAX_BYTES = 2_000_000;
const encoder = new TextEncoder();

function slotFor(platform?: Platform): string {
  return `categories:${platform ?? "all"}`;
}

function identityFor(platform?: Platform): string {
  return platform ?? "all";
}

function publicCategory(value: unknown): UnifiedCategory | null {
  if (!value || typeof value !== "object") return null;
  const category = value as Partial<UnifiedCategory>;
  if (
    typeof category.id !== "string" ||
    category.id.length === 0 ||
    (category.platform !== "twitch" && category.platform !== "kick") ||
    typeof category.name !== "string" ||
    category.name.length === 0
  ) {
    return null;
  }

  return {
    id: category.id,
    platform: category.platform,
    name: category.name,
    boxArtUrl: typeof category.boxArtUrl === "string" ? category.boxArtUrl : "",
    ...(typeof category.igdbId === "string" ? { igdbId: category.igdbId } : {}),
    ...(typeof category.viewerCount === "number" && Number.isFinite(category.viewerCount)
      ? { viewerCount: category.viewerCount }
      : {}),
    ...(Array.isArray(category.tags) && category.tags.every((tag) => typeof tag === "string")
      ? { tags: category.tags }
      : {}),
    ...(typeof category.slug === "string" ? { slug: category.slug } : {}),
    ...(typeof category.crossPlatformId === "string"
      ? { crossPlatformId: category.crossPlatformId }
      : {}),
    ...(typeof category.crossPlatformName === "string"
      ? { crossPlatformName: category.crossPlatformName }
      : {}),
  };
}

function boundedPublicCatalog(
  categories: UnifiedCategory[],
  platform?: Platform
): UnifiedCategory[] | undefined {
  const bounded: UnifiedCategory[] = [];
  let serializedBytes = 2;
  for (const value of categories) {
    if (bounded.length === MAX_CATEGORIES) break;
    const category = publicCategory(value);
    if (!category || (platform && category.platform !== platform)) return undefined;
    const itemBytes = encoder.encode(JSON.stringify(category)).byteLength;
    const nextBytes = serializedBytes + itemBytes + (bounded.length > 0 ? 1 : 0);
    if (nextBytes > MAX_BYTES) break;
    bounded.push(category);
    serializedBytes = nextBytes;
  }
  return bounded.length > 0 ? bounded : undefined;
}

export function sanitizePersistedCategoryCatalog(
  value: unknown,
  platform?: Platform
): UnifiedCategory[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CATEGORIES)
    return undefined;
  const categories = value.map(publicCategory);
  if (categories.some((category) => category === null)) return undefined;
  const sanitized = categories as UnifiedCategory[];
  if (platform && sanitized.some((category) => category.platform !== platform)) return undefined;
  if (encoder.encode(JSON.stringify(sanitized)).byteLength > MAX_BYTES) return undefined;
  return sanitized;
}

export async function savePersistedCategoryCatalog(
  platform: Platform | undefined,
  categories: UnifiedCategory[],
  shouldPersist: () => boolean = () => true
): Promise<boolean> {
  const bounded = boundedPublicCatalog(categories, platform);
  if (!bounded || !shouldPersist()) return false;
  await savePersistedSnapshot(slotFor(platform), identityFor(platform), bounded);
  return true;
}
