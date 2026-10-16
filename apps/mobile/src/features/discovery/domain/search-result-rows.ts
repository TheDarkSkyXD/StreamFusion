import type {
  Category,
  Channel,
  Clip,
  Stream,
  Video,
} from "@streamfusion/core/content";

import type {
  MobileSearchKind,
  UnifiedSearchView,
} from "../capabilities/platform-reads";

export type SearchRow =
  | { readonly kind: "heading"; readonly key: string; readonly title: string }
  | { readonly kind: "channel"; readonly key: string; readonly item: Channel }
  | { readonly kind: "stream"; readonly key: string; readonly item: Stream }
  | { readonly kind: "category"; readonly key: string; readonly item: Category }
  | { readonly kind: "video"; readonly key: string; readonly item: Video }
  | { readonly kind: "clip"; readonly key: string; readonly item: Clip }
  | {
      readonly kind: "more";
      readonly key: string;
      readonly resultKind: MobileSearchKind;
    };

export function searchResultRows(
  view: UnifiedSearchView,
): readonly SearchRow[] {
  const rows: SearchRow[] = [];
  const tab = view.intent?.resultType ?? "all";
  const collection = view.collection;
  const append = <TItem extends Channel | Stream | Category | Video | Clip>(
    kind: "channel" | "stream" | "category" | "video" | "clip",
    title: string,
    items: readonly TItem[],
    resultKind?: MobileSearchKind,
  ) => {
    if (items.length > 0)
      rows.push({ kind: "heading", key: `heading:${kind}`, title });
    for (const item of items) {
      rows.push({
        kind,
        key: `${kind}:${item.platform}:${item.id}`,
        item,
      } as SearchRow);
    }
    if (resultKind && view.canLoadMore?.[resultKind]) {
      rows.push({ kind: "more", key: `more:${resultKind}`, resultKind });
    }
  };
  if (tab === "all") {
    if (view.bestMatch) {
      rows.push({ kind: "heading", key: "heading:best", title: "Best match" });
      rows.push({
        kind: "channel",
        key: `best:${view.bestMatch.platform}:${view.bestMatch.id}`,
        item: view.bestMatch,
      });
    }
    append(
      "channel",
      "Channels",
      collection.channels.filter(
        (channel) =>
          !view.bestMatch ||
          channel.platform !== view.bestMatch.platform ||
          channel.id !== view.bestMatch.id,
      ),
      "channels",
    );
    append("stream", "Live streams", collection.streams, "streams");
    append("video", "Videos", collection.videos);
    append("clip", "Clips", collection.clips);
    append("category", "Categories", collection.categories, "categories");
    return rows;
  }
  if (tab === "channels")
    append("channel", "Channels", collection.channels, "channels");
  if (tab === "streams")
    append("stream", "Streams", collection.streams, "streams");
  if (tab === "categories")
    append("category", "Categories", collection.categories, "categories");
  if (tab === "videos") append("video", "Videos", collection.videos);
  if (tab === "clips") append("clip", "Clips", collection.clips);
  return rows;
}
