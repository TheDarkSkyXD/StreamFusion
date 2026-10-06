import type { SearchCatalogPage } from "../capabilities/platform-reads";

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
