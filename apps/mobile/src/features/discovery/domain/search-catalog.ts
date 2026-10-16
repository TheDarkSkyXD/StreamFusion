import type { SearchCatalogPage } from "../capabilities/platform-reads";
import type { Channel } from "@streamfusion/core/content";
import { rankSearchChannels } from "@streamfusion/core/discovery";

export function emptySearchCatalog(): SearchCatalogPage {
  return {
    categories: [],
    channels: [],
    clips: [],
    streams: [],
    videos: [],
  };
}

export function dedupeByIdentity<
  TItem extends { readonly id: string; readonly platform: string },
>(items: readonly TItem[]): readonly TItem[] {
  const seen = new Set<string>();
  const next: TItem[] = [];
  for (const item of items) {
    const key = `${item.platform}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(item);
  }
  return next;
}

export function rankProviderChannels(
  channels: readonly Channel[],
  query: string,
): readonly Channel[] {
  const ranked = rankSearchChannels(channels, query);
  return dedupeByIdentity([...ranked, ...channels]);
}

export function dedupeChannelsByLogin(
  channels: readonly Channel[],
): readonly Channel[] {
  const seen = new Set<string>();
  return channels.filter((channel) => {
    const key = `${channel.platform}:${channel.username.trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
