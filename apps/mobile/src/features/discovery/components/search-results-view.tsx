import { memo, useCallback, type ReactElement } from "react";
import {
  FlatList,
  StyleSheet,
  Text,
  type ListRenderItemInfo,
} from "react-native";
import type {
  Category,
  Channel,
  Clip,
  Stream,
  Video,
} from "@streamfusion/core/content";

import { MobileButton } from "@mobile/design/button";
import { mobileColors, mobileSpacing } from "@mobile/design/tokens";
import type {
  MobileSearchKind,
  UnifiedSearchView,
} from "../capabilities/platform-reads";
import { searchResultRows, type SearchRow } from "../domain/search-result-rows";

import { HomeStreamCard } from "./home-stream-card";
import {
  SearchCategoryCard,
  SearchChannelCard,
  SearchClipCard,
  SearchVideoCard,
} from "./search-cards";

export function SearchResultsView({
  header,
  onLoadMore,
  onOpenCategory,
  onOpenChannel,
  onRefresh,
  onWatchClip,
  onWatchStream,
  onWatchVideo,
  refreshing = false,
  view,
}: {
  readonly header?: ReactElement;
  readonly onLoadMore?: (kind: MobileSearchKind) => void;
  readonly onOpenCategory?: (category: Category) => void;
  readonly onOpenChannel?: (channel: Channel) => void;
  readonly onRefresh?: () => void | Promise<void>;
  readonly onWatchClip?: (clip: Clip) => void;
  readonly onWatchStream?: (stream: Stream) => void;
  readonly onWatchVideo?: (video: Video) => void;
  readonly refreshing?: boolean;
  readonly view: UnifiedSearchView;
}) {
  const rows = searchResultRows(view);
  const tab = view.intent?.resultType;
  const loadAtEnd =
    (tab === "channels" || tab === "streams" || tab === "categories") &&
    view.canLoadMore?.[tab];
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<SearchRow>) => (
      <SearchRowView
        row={item}
        loadingMore={view.loadingMore}
        onLoadMore={onLoadMore}
        onOpenCategory={onOpenCategory}
        onOpenChannel={onOpenChannel}
        onWatchClip={onWatchClip}
        onWatchStream={onWatchStream}
        onWatchVideo={onWatchVideo}
      />
    ),
    [
      onLoadMore,
      onOpenCategory,
      onOpenChannel,
      onWatchClip,
      onWatchStream,
      onWatchVideo,
      view.loadingMore,
    ],
  );
  return (
    <FlatList<SearchRow>
      contentContainerStyle={styles.content}
      data={rows}
      key={JSON.stringify([
        view.intent?.query,
        view.intent?.resultType,
        view.intent?.platform ?? "all",
        view.intent?.liveOnly,
      ])}
      keyExtractor={(row) => row.key}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={header}
      onEndReached={() => {
        if (loadAtEnd && tab && onLoadMore) onLoadMore(tab);
      }}
      onEndReachedThreshold={0.5}
      onRefresh={onRefresh}
      refreshing={refreshing}
      renderItem={renderItem}
      style={styles.list}
      testID="search-results-list"
    />
  );
}

const SearchRowView = memo(function SearchRowView({
  row,
  loadingMore,
  onLoadMore,
  onOpenCategory,
  onOpenChannel,
  onWatchClip,
  onWatchStream,
  onWatchVideo,
}: {
  readonly row: SearchRow;
  readonly loadingMore?: UnifiedSearchView["loadingMore"];
  readonly onLoadMore?: ((kind: MobileSearchKind) => void) | undefined;
  readonly onOpenCategory?: ((category: Category) => void) | undefined;
  readonly onOpenChannel?: ((channel: Channel) => void) | undefined;
  readonly onWatchClip?: ((clip: Clip) => void) | undefined;
  readonly onWatchStream?: ((stream: Stream) => void) | undefined;
  readonly onWatchVideo?: ((video: Video) => void) | undefined;
}) {
  switch (row.kind) {
    case "heading":
      return (
        <Text selectable style={styles.label}>
          {row.title}
        </Text>
      );
    case "channel":
      return (
        <SearchChannelCard
          channel={row.item}
          {...(onOpenChannel ? { onOpen: () => onOpenChannel(row.item) } : {})}
        />
      );
    case "stream":
      return (
        <HomeStreamCard
          stream={row.item}
          {...(onWatchStream ? { onOpen: () => onWatchStream(row.item) } : {})}
        />
      );
    case "category":
      return (
        <SearchCategoryCard
          category={row.item}
          {...(onOpenCategory
            ? { onOpen: () => onOpenCategory(row.item) }
            : {})}
        />
      );
    case "video":
      return (
        <SearchVideoCard
          video={row.item}
          {...(onWatchVideo ? { onWatch: onWatchVideo } : {})}
        />
      );
    case "clip":
      return (
        <SearchClipCard
          clip={row.item}
          {...(onWatchClip ? { onWatch: onWatchClip } : {})}
        />
      );
    case "more":
      return (
        <MobileButton
          accessibilityLabel={`Load more ${row.resultKind}`}
          busy={loadingMore?.[row.resultKind] === true}
          onPress={() => onLoadMore?.(row.resultKind)}
          testID={`search-more-${row.resultKind}`}
          variant="secondary"
        >{`Load more ${row.resultKind}`}</MobileButton>
      );
  }
});

const styles = StyleSheet.create({
  list: { flex: 1, minHeight: 0 },
  content: {
    gap: mobileSpacing.medium,
    padding: mobileSpacing.medium,
    paddingBottom: mobileSpacing.xLarge,
  },
  label: {
    color: mobileColors.textCategory,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    lineHeight: 16,
  },
});
