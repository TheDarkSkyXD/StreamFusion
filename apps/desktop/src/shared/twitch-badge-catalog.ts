import type { TwitchBadgeCatalogSection, TwitchBadgeCatalogSource } from "./chat-types";
import type { ChatBadge } from "@streamfusion/core/chat";

export interface TwitchBadgeVersionShape {
  id: string;
  image_url_1x: string;
  image_url_2x: string;
  image_url_4x: string;
  title: string;
  description: string;
  click_action: string | null;
  click_url: string | null;
}

export interface TwitchBadgeSetShape {
  set_id: string;
  versions: TwitchBadgeVersionShape[];
}

export interface TwitchFlatBadgeShape {
  setId?: string | null;
  version?: string | null;
  imageUrl1x?: string | null;
  imageUrl2x?: string | null;
  imageUrl4x?: string | null;
  title?: string | null;
}

export function isValidTwitchBadgeImageUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function toTwitchBadgeSets(
  badges: readonly (TwitchFlatBadgeShape | null)[]
): TwitchBadgeSetShape[] {
  const sets = new Map<string, TwitchBadgeVersionShape[]>();
  for (const badge of badges) {
    if (!badge?.setId || !badge.version || !badge.imageUrl4x || !isValidTwitchBadgeImageUrl(badge.imageUrl4x)) continue;
    const versions = sets.get(badge.setId) ?? [];
    versions.push({
      id: badge.version,
      image_url_1x: badge.imageUrl1x ?? badge.imageUrl4x,
      image_url_2x: badge.imageUrl2x ?? badge.imageUrl4x,
      image_url_4x: badge.imageUrl4x,
      title: badge.title ?? badge.setId,
      description: badge.title ?? badge.setId,
      click_action: null,
      click_url: null,
    });
    sets.set(badge.setId, versions);
  }
  return Array.from(sets, ([set_id, versions]) => ({ set_id, versions }));
}

export function hasValidTwitchBadgeSets(sets: readonly TwitchBadgeSetShape[]): boolean {
  return sets.some(
    (set) =>
      Boolean(set?.set_id) &&
      Array.isArray(set.versions) &&
      set.versions.some(
        (version) => Boolean(version?.id) && isValidTwitchBadgeImageUrl(version.image_url_4x)
      )
  );
}

export function toTwitchBadgeCatalogSection(
  sets: readonly TwitchBadgeSetShape[],
  source: TwitchBadgeCatalogSource
): TwitchBadgeCatalogSection {
  const badges: ChatBadge[] = [];
  for (const set of sets) {
    for (const version of set.versions) {
      if (!set.set_id || !version.id || !isValidTwitchBadgeImageUrl(version.image_url_4x)) continue;
      badges.push({
        setId: set.set_id,
        version: version.id,
        imageUrl: version.image_url_4x,
        title: version.title || set.set_id,
      });
    }
  }
  return { badges, source };
}
