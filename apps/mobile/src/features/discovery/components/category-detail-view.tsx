import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Platform } from "@streamfusion/core/platform";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import type { DiscoveryFixtureMode } from "../capabilities/platform-reads";
import type { CategoryDetailView as CategoryDetailModel } from "../domain/category-detail";
import {
  defaultCategoryRequest,
  type CategoryRequestIdentity,
} from "../domain/category-identity";

import { CategoryDiscoveryProofControls } from "./category-discovery-proof-controls";
import { CategoryFilterBar } from "./category-filter-bar";
import { CategoryFollowControl } from "./category-follow-control";
import { CategoryRecordedRow } from "./category-recorded-row";
import { DiscoverySearchDock } from "./discovery-search-dock";
import { HomeProviderBanner } from "./home-provider-banner";
import { HomeStreamCard } from "./home-stream-card";

export function CategoryDetailView({
  onChangeIdentity,
  onChangeQuery,
  onOpenAccounts,
  onRetry,
  onSelectProofMode,
  proofMode,
  query,
  view,
}: {
  readonly onChangeIdentity: (identity: CategoryRequestIdentity) => void;
  readonly onChangeQuery: (query: string) => void;
  readonly onOpenAccounts: () => void;
  readonly onRetry: (platform: Platform) => void;
  readonly onSelectProofMode?: (mode: DiscoveryFixtureMode) => void;
  readonly proofMode?: DiscoveryFixtureMode;
  readonly query: string;
  readonly view: CategoryDetailModel;
}) {
  const media = filterMedia(view, query);
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      style={styles.scroll}
      testID="category-detail-screen"
    >
      <Header view={view} />
      <CategoryFollowControl follow={view.follow} />
      <TabRow identity={view.identity} onChangeIdentity={onChangeIdentity} />
      <CategoryFilterBar identity={view.identity} onChange={onChangeIdentity} />
      <Text selectable style={styles.summary} testID="category-detail-phase">
        {phaseCopy(view)}
      </Text>
      {proofMode && onSelectProofMode ? (
        <CategoryDiscoveryProofControls
          mode={proofMode}
          onSelect={onSelectProofMode}
        />
      ) : null}
      <HomeProviderBanner
        onOpenAccounts={onOpenAccounts}
        onRetry={onRetry}
        outcome={view.providers.twitch}
      />
      <HomeProviderBanner
        onOpenAccounts={onOpenAccounts}
        onRetry={onRetry}
        outcome={view.providers.kick}
      />
      <MediaList media={media} />
      <DiscoverySearchDock
        onChangeQuery={onChangeQuery}
        placeholder={`Search in ${view.header.name}`}
        query={query}
        testID="category-detail-search"
      />
    </ScrollView>
  );
}

function Header({ view }: { readonly view: CategoryDetailModel }) {
  return (
    <View style={styles.header}>
      <View style={styles.artWrap}>
        {view.header.boxArtUrl ? (
          <Image
            accessibilityIgnoresInvertColors
            source={{ uri: view.header.boxArtUrl }}
            style={styles.art}
          />
        ) : (
          <View style={styles.artFallback}>
            <Text selectable style={styles.fallback}>
              {view.header.name}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.headerCopy}>
        <Text accessibilityRole="header" selectable style={styles.title}>
          {view.header.name}
        </Text>
        <Text selectable style={styles.viewers}>
          {view.viewerSummary > 0
            ? `${view.viewerSummary} live viewers`
            : "Live viewer count updates on the Live tab"}
        </Text>
      </View>
    </View>
  );
}

function TabRow({
  identity,
  onChangeIdentity,
}: {
  readonly identity: CategoryRequestIdentity;
  readonly onChangeIdentity: (identity: CategoryRequestIdentity) => void;
}) {
  return (
    <View style={styles.tabs}>
      {(["live", "clips", "videos"] as const).map((tab) => (
        <Pressable
          accessibilityLabel={`${tab} tab`}
          accessibilityRole="tab"
          accessibilityState={{ selected: identity.tab === tab }}
          key={tab}
          onPress={() =>
            onChangeIdentity({
              ...defaultCategoryRequest(
                identity.category,
                identity.language,
                identity.clipTimeRange,
              ),
              platformScope: identity.platformScope,
              tab,
              tag: identity.tag,
              videoSort: tab === "videos" ? "recent" : identity.videoSort,
            })
          }
          style={[styles.tab, identity.tab === tab ? styles.tabSelected : null]}
          testID={`category-tab-${tab}`}
        >
          <Text selectable style={styles.tabLabel}>
            {tab.toUpperCase()}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function MediaList({
  media,
}: {
  readonly media: CategoryDetailModel["media"];
}) {
  if (media.kind === "unavailable") {
    return (
      <Text selectable style={styles.unsupported} testID="category-unsupported">
        {media.reason === "kick-clips-unsupported"
          ? "Kick clips are not available on the official guest catalog."
          : "Kick videos are not available. Videos are Twitch VODs only."}
      </Text>
    );
  }
  if (media.kind === "live") {
    return (
      <>
        {media.items.map((stream) => (
          <HomeStreamCard
            key={`${stream.platform}:${stream.id}`}
            stream={stream}
          />
        ))}
      </>
    );
  }
  return (
    <>
      {media.items.map((item) => (
        <CategoryRecordedRow
          item={item}
          key={`${item.platform}:${item.id}`}
        />
      ))}
    </>
  );
}

function filterMedia(
  view: CategoryDetailModel,
  query: string,
): CategoryDetailModel["media"] {
  const needle = query.trim().toLowerCase();
  if (needle === "" || view.media.kind === "unavailable") return view.media;
  return {
    ...view.media,
    items: view.media.items.filter((item) =>
      item.title.toLowerCase().includes(needle),
    ),
  } as CategoryDetailModel["media"];
}

function phaseCopy(view: CategoryDetailModel): string {
  if (view.media.kind === "unavailable") {
    return view.media.reason === "kick-clips-unsupported"
      ? "Kick clips are explained unavailable."
      : "Kick videos are explained unavailable. Showing Twitch VODs when Twitch is selected.";
  }
  switch (view.phase) {
    case "loading":
      return "Loading category media.";
    case "ready":
      return view.identity.tab === "videos"
        ? "Twitch videos only. Live streams stay on the Live tab."
        : "Category media from the guest catalog.";
    case "offline-cache":
      return "Showing cached category media.";
    case "empty":
      return "No category media matches these filters.";
    case "failed":
      return "Category media could not be loaded.";
  }
}

const styles = StyleSheet.create({
  scroll: { flex: 1, minHeight: 0 },
  content: {
    gap: mobileSpacing.medium,
    padding: mobileSpacing.medium,
    paddingBottom: mobileSpacing.xLarge,
  },
  header: { flexDirection: "row", gap: mobileSpacing.medium },
  artWrap: {
    aspectRatio: 3 / 4,
    backgroundColor: mobileColors.surfaceMuted,
    borderRadius: mobileRadii.medium,
    overflow: "hidden",
    width: 96,
  },
  art: { height: "100%", width: "100%" },
  artFallback: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: mobileSpacing.xSmall,
  },
  fallback: {
    color: mobileColors.textPrimary,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  headerCopy: { flex: 1, gap: mobileSpacing.small, justifyContent: "center" },
  title: {
    color: mobileColors.textPrimary,
    fontSize: 28,
    fontWeight: "700",
    lineHeight: 34,
  },
  viewers: { color: mobileColors.textSecondary, fontSize: 14, lineHeight: 20 },
  summary: {
    color: mobileColors.textCategory,
    fontSize: 16,
    fontWeight: "500",
    lineHeight: 24,
  },
  tabs: { flexDirection: "row", gap: mobileSpacing.small },
  tab: {
    backgroundColor: mobileColors.surfaceMuted,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  tabSelected: { backgroundColor: mobileColors.navigationSelected },
  tabLabel: { color: mobileColors.textPrimary, fontSize: 14, fontWeight: "700" },
  unsupported: { color: mobileColors.textSecondary, fontSize: 15, lineHeight: 22 },
});
